"use client"

/**
 * FragmentDrawer —— 2D molecule editor floating window.
 *
 * Opened from the FRAGMENTS panel "2D Editor" button. The self-built SVG canvas
 * has been replaced by EPAM Ketcher (open-source, the closest analog to
 * ChemDraw: ring / template library, bond / charge editing, canonical rendering,
 * SMILES / MOLfile I-O — produces correct, valence-aware structures).
 *
 * Ketcher is heavy, so it is lazy-loaded (React.lazy + dynamic import of
 * ./ketcher-editor) — it only enters the bundle once this window is opened.
 *
 * Chrome (header / SMILES bar / action bar) uses the app design-system CSS
 * variables (var(--panel-*)), is draggable AND freely resizable (corner handle).
 *
 * Workflows kept from the previous implementation:
 *  - Add to 3D    → MOLfile → parseMolfile → replaceAtomsDirectly / setBondsDirectly
 *  - Save fragment→ MOLfile → Molecule2D → saveCustomFragment
 *  - Export       → MOL / XYZ download, PNG via Ketcher
 */

import { useState, useRef, useCallback, useEffect, Suspense, lazy } from "react"
import { createPortal } from "react-dom"
import { X, Box, Save, Download, Hexagon, Loader2, LayoutGrid } from "lucide-react"
import type { Ketcher } from "ketcher-core"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useViewportManager, type GridLayout } from "../../orchestration/viewportManager"
import { parseMolfile } from "../../lib/molecule/molfile"
import type { Molecule2D, Atom2D, Bond2D } from "../../lib/molecule/smiles-parser"
import { computeMolecularFormula, addHydrogensToMolecule, convert2Dto3D } from "../../lib/molecule/smiles-parser"
import { moleculeToMolfile, moleculeToXYZ, downloadTextFile } from "../../lib/molecule/molecule-export"
import { saveCustomFragment } from "../../lib/molecule/custom-fragments"
import { KetcherLoading } from "./KetcherLoading"
import { installKetcherBrowserRuntime } from "./ketcher-browser-runtime"
import { useStructureAssetRecorder } from "../structure-asset-context"
import "./ketcher-theme.css"

// Lazy: Ketcher (+ its CSS) only loads when the drawer is mounted.
const KetcherEditor = lazy(() => {
  installKetcherBrowserRuntime()
  return import("./ketcher-editor")
})

interface FragmentDrawerProps {
  onClose: () => void
}

/** Convert parsed MOLfile coordinates into the shared Molecule2D shape so the
 *  existing export / fragment helpers keep working unchanged. */
function molfileToMolecule2D(mol: string): Molecule2D | null {
  let parsed
  try {
    parsed = parseMolfile(mol)
  } catch {
    return null
  }
  if (!parsed.atoms.length) return null
  const atoms: Atom2D[] = parsed.atoms.map((a, i) => ({
    id: `k-a-${i}`,
    element: a.element,
    x: a.x,
    y: a.y,
  }))
  const bondType = (order: number): Bond2D["type"] =>
    order === 2 ? "double" : order === 3 ? "triple" : order === 4 ? "aromatic" : "single"
  const bonds: Bond2D[] = parsed.bonds
    .filter((b) => atoms[b.from] && atoms[b.to])
    .map((b, i) => ({
      id: `k-b-${i}`,
      atom1Id: atoms[b.from].id,
      atom2Id: atoms[b.to].id,
      type: bondType(b.order),
    }))
  return { atoms, bonds, width: 0, height: 0 }
}

/** Shape written into a crystal store via replaceAtomsDirectly / setBondsDirectly. */
interface Molecule3D {
  atoms: { id: string; element: string; position: [number, number, number]; cartesian: [number, number, number] }[]
  bonds: { id: string; atom1Id: string; atom2Id: string; type: "single" | "double" | "triple" }[]
}

/**
 * Shared Ketcher → 3D pipeline used by BOTH "Add to 3D" and "New View":
 *   MOLfile → molfileToMolecule2D → addHydrogensToMolecule → convert2Dto3D
 *   → bond-length normalisation (~1.5Å) → centroid → origin → {atoms,bonds}.
 * Returns null when the canvas is empty / unparseable.
 */
function buildMolecule3DFromKetcher(mol: string): Molecule3D | null {
  const mol2d = molfileToMolecule2D(mol)
  if (!mol2d) return null
  const conv = convert2Dto3D(addHydrogensToMolecule(mol2d))
  if (!conv.atoms.length) return null

  // Normalize bond length to roughly 1.5 Å before 2D-to-3D conversion.
  const idIdx = new Map(conv.atoms.map((a, i) => [a.id, i]))
  let sum = 0, n = 0
  for (const b of conv.bonds) {
    const p = conv.atoms[idIdx.get(b.atom1Id) ?? -1]?.position
    const q = conv.atoms[idIdx.get(b.atom2Id) ?? -1]?.position
    if (p && q) { sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); n++ }
  }
  const scale = n && sum > 1e-6 ? 1.5 / (sum / n) : 1
  // Move the centroid to the origin.
  const c = conv.atoms.reduce((s, a) => [s[0] + a.position[0], s[1] + a.position[1], s[2] + a.position[2]], [0, 0, 0])
  const cx = c[0] / conv.atoms.length, cy = c[1] / conv.atoms.length, cz = c[2] / conv.atoms.length

  const ts = Date.now()
  const idMap = new Map<string, string>()
  const atoms = conv.atoms.map((a, i) => {
    const id = `k3d-${ts}-${i}`; idMap.set(a.id, id)
    const pos: [number, number, number] = [(a.position[0] - cx) * scale, (a.position[1] - cy) * scale, (a.position[2] - cz) * scale]
    return { id, element: a.element, position: pos, cartesian: pos }
  })
  const bonds = conv.bonds
    .filter((b) => idMap.has(b.atom1Id) && idMap.has(b.atom2Id))
    .map((b, i) => ({
      id: `k3db-${ts}-${i}`,
      atom1Id: idMap.get(b.atom1Id)!,
      atom2Id: idMap.get(b.atom2Id)!,
      type: (b.type === "double" ? "double" : b.type === "triple" ? "triple" : "single") as "single" | "double" | "triple",
    }))
  return { atoms, bonds }
}

/** Apply a built molecule into a crystal store's state (molecule mode, centered). */
function writeMoleculeToStore(
  store: {
    replaceAtomsDirectly: (a: Molecule3D["atoms"]) => void
    setBondsDirectly: (b: Molecule3D["bonds"]) => void
    setPeriodic?: (p: boolean) => void
    setShowLattice?: (s: boolean) => void
  },
  built: Molecule3D,
) {
  store.replaceAtomsDirectly(built.atoms)
  store.setBondsDirectly(built.bonds)
  store.setPeriodic?.(false)      // Molecules disable periodicity and lattice display.
  store.setShowLattice?.(false)
}

// Grow layouts through this order when no empty viewport exists.
const LAYOUT_ORDER: GridLayout[] = ['1x1', '1x2', '2x2', '2x3', '2x4', '3x4', '4x4']

export function FragmentDrawer({ onClose }: FragmentDrawerProps) {
  const recordStructureAsset = useStructureAssetRecorder()
  // ——— 3D viewport store (Add to 3D) ———
  const replaceAtomsDirectly = useCrystalStore((s) => s.replaceAtomsDirectly)
  const setBondsDirectly = useCrystalStore((s) => s.setBondsDirectly)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)
  const setShowLattice = useCrystalStore((s) => s.setShowLattice)

  // ——— Ketcher instance ref ———
  const ketcherRef = useRef<Ketcher | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  // ——— Window position (drag) + size (resize) ———
  const [position, setPosition] = useState({ x: 100, y: 80 })
  const [size, setSize] = useState({ w: 640, h: 560 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleInit = useCallback((k: Ketcher) => {
    ketcherRef.current = k
    setReady(true)
  }, [])

  // ——— Drag (header) ———
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
    const onUp = () => setIsDragging(false)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [isDragging])

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    setStatus({ kind, text })
    window.setTimeout(() => setStatus(null), 3200)
  }, [])

  /** Pull the current structure from Ketcher as a MOLfile (throws if empty). */
  const readMolfile = useCallback(async (): Promise<string | null> => {
    const k = ketcherRef.current
    if (!k) return null
    const mol = await k.getMolfile()
    // Empty canvas → still a valid (0-atom) molfile; reject those.
    const parsed = molfileToMolecule2D(mol)
    if (!parsed) return null
    return mol
  }, [])

  // ——— Add to 3D ———
  // Add implicit hydrogens when the MOLfile contains only heavy atoms.
  // Disable lattice display and normalize geometry.
  // The drawn molecule becomes the centered 3D structure.
  const handleAddTo3D = useCallback(async () => {
    setBusy(true)
    try {
      const mol = await readMolfile()
      if (!mol) {
        flash("err", "Canvas is empty — draw a structure first")
        return
      }
      const built = buildMolecule3DFromKetcher(mol)
      if (!built) { flash("err", "Failed to read structure"); return }

      // Replace the active viewport in molecule mode and reset its camera.
      writeMoleculeToStore(
        { replaceAtomsDirectly, setBondsDirectly, setPeriodic, setShowLattice },
        built,
      )
      const label = computeMolecularFormula(built.atoms) || "2D Molecule"
      recordStructureAsset(label, "editor")
      flash("ok", `Added ${built.atoms.length} atoms to 3D (with H)`)
    } catch (err) {
      console.error("[FragmentDrawer] Add to 3D failed", err)
      flash("err", "Failed to read structure")
    } finally {
      setBusy(false)
    }
  }, [readMolfile, replaceAtomsDirectly, setBondsDirectly, setPeriodic, setShowLattice, recordStructureAsset, flash])

  // ——— New View ———
  // Allocate and activate a separate empty crystal viewport.
  // Viewport allocation strategy:
  // Upgrade 1x1 to 1x2 and use vp-2.
  // Otherwise reuse an empty non-active crystal viewport.
  // If none exists, grow to the next layout.
  // Report full capacity when a populated 4x4 grid has no slot.
  const handleNewView = useCallback(async () => {
    setBusy(true)
    try {
      const mol = await readMolfile()
      if (!mol) {
        flash("err", "Canvas is empty — draw a structure first")
        return
      }
      const built = buildMolecule3DFromKetcher(mol)
      if (!built) { flash("err", "Failed to read structure"); return }

      const mgr = useViewportManager.getState()

      const findEmptyCrystalId = (): string | null => {
        const { viewports, activeViewportId } = useViewportManager.getState()
        for (const slot of Object.values(viewports)) {
          if (slot.kind !== "crystal") continue
          if (slot.id === activeViewportId) continue // Reserve the active viewport for Add to 3D.
          const store = useViewportManager.getState().getViewportStore(slot.id)
          if (store && store.getState().atoms.length === 0) return slot.id
        }
        return null
      }

      let targetId: string | null = null

      if (mgr.layout === "1x1") {
        // Upgrade 1x1 to 1x2 and place the molecule in the new slot.
        mgr.setLayout("1x2")
        targetId = findEmptyCrystalId()
      } else {
        // Prefer an existing empty crystal viewport.
        targetId = findEmptyCrystalId()
        // Otherwise grow one layout step.
        while (!targetId) {
          const cur = useViewportManager.getState().layout
          const idx = LAYOUT_ORDER.indexOf(cur)
          if (idx < 0 || idx >= LAYOUT_ORDER.length - 1) {
            // The 4x4 layout cannot grow further.
            flash("err", "All views are full")
            return
          }
          useViewportManager.getState().setLayout(LAYOUT_ORDER[idx + 1])
          targetId = findEmptyCrystalId()
        }
      }

      if (!targetId) {
        // No destination exists at maximum capacity.
        flash("err", "All views are full")
        return
      }

      const targetStore = useViewportManager.getState().getViewportStore(targetId)
      if (!targetStore) { flash("err", "Failed to open a new view"); return }

      const s = targetStore.getState()
      writeMoleculeToStore(
        {
          replaceAtomsDirectly: s.replaceAtomsDirectly,
          setBondsDirectly: s.setBondsDirectly,
          setPeriodic: s.setPeriodic,
          setShowLattice: s.setShowLattice,
        },
        built,
      )

      const name = computeMolecularFormula(built.atoms) || "molecule"
      useViewportManager.getState().setStructureName(targetId, name)
      useViewportManager.getState().setActive(targetId)
      recordStructureAsset(name, "editor")

      flash("ok", "Opened in a new view")
    } catch (err) {
      console.error("[FragmentDrawer] New View failed", err)
      flash("err", "Failed to open a new view")
    } finally {
      setBusy(false)
    }
  }, [readMolfile, recordStructureAsset, flash])

  // ——— Save as fragment ———
  const handleSaveFragment = useCallback(async () => {
    setBusy(true)
    try {
      const mol = await readMolfile()
      if (!mol) {
        flash("err", "Canvas is empty — draw a structure first")
        return
      }
      const parsed = parseMolfile(mol)
      let smiles = ""
      try {
        smiles = (await ketcherRef.current?.getSmiles()) ?? ""
      } catch {
        /* SMILES optional */
      }
      const formula = computeMolecularFormula(parsed.atoms.map((a) => ({ element: a.element })))
      const atomsF = parsed.atoms.map((a) => ({
        element: a.element,
        position: [a.x, a.y, a.z] as [number, number, number],
      }))
      const bondsF = parsed.bonds
        .filter((b) => atomsF[b.from] && atomsF[b.to])
        .map((b) => ({ from: b.from, to: b.to, type: b.order === 2 ? "double" : b.order === 3 ? "triple" : "single" }))
      // attachment point = first terminal heavy atom
      const deg = new Array(atomsF.length).fill(0)
      for (const b of bondsF) {
        deg[b.from]++
        deg[b.to]++
      }
      let attach = atomsF.findIndex((a, i) => a.element !== "H" && deg[i] === 1)
      if (attach < 0) attach = 0
      saveCustomFragment({
        name: smiles || formula || "fragment",
        smiles: smiles || undefined,
        atoms: atomsF,
        bonds: bondsF,
        attachmentIndex: attach,
      })
      flash("ok", `Saved fragment "${smiles || formula}"`)
    } catch (err) {
      console.error("[FragmentDrawer] Save fragment failed", err)
      flash("err", "Failed to save fragment")
    } finally {
      setBusy(false)
    }
  }, [readMolfile, flash])

  // ——— Export: MOL / XYZ download ———
  const exportFile = useCallback(
    async (format: ".mol" | ".xyz") => {
      setBusy(true)
      try {
        const mol = await readMolfile()
        if (!mol) {
          flash("err", "Canvas is empty — draw a structure first")
          return
        }
        const m2d = molfileToMolecule2D(mol)!
        const name = computeMolecularFormula(m2d.atoms.map((a) => ({ element: a.element }))) || "molecule"
        const content = format === ".mol" ? moleculeToMolfile(m2d, name) : moleculeToXYZ(m2d, name)
        downloadTextFile(`${name}${format}`, content, format === ".mol" ? "chemical/x-mdl-molfile" : "chemical/x-xyz")
        flash("ok", `Exported ${name}${format}`)
      } catch (err) {
        console.error("[FragmentDrawer] Export failed", err)
        flash("err", "Export failed")
      } finally {
        setBusy(false)
      }
    },
    [readMolfile, flash],
  )

  const btnBase =
    "zatom-pressable flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium"

  // Portal to document.body to escape the sidebar stacking context.
  // Keep the editor above every viewport in multi-view layouts.
  return createPortal(
    <div
      className="fixed z-[9999] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        minWidth: 460,
        minHeight: 420,
        // Native corner resize handle in the bottom-right.
        resize: "both",
        background: "var(--panel-bg)",
        backdropFilter: "blur(24px)",
        border: "1px solid var(--panel-border)",
      }}
      onMouseUp={(e) => {
        // sync the resized box back into state so re-renders keep the new size
        const el = e.currentTarget
        if (el.offsetWidth !== size.w || el.offsetHeight !== size.h) {
          setSize({ w: el.offsetWidth, h: el.offsetHeight })
        }
      }}
    >
      {/* Header (drag + close) */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move select-none shrink-0"
        style={{
          borderBottom: "1px solid var(--panel-border)",
          background: "var(--control-selected-bg)",
        }}
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex items-center gap-2">
          <Hexagon className="w-4 h-4" style={{ color: "var(--control-selected-text)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--panel-text)" }}>
            2D Molecule Editor
          </span>
          <span className="text-[10px]" style={{ color: "var(--panel-text-tertiary)" }}>
            Ketcher
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "var(--panel-text-secondary)" }}
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Editor body (fills, scroll-safe). `ketcher-host` carries the dark-mode
          Ketcher theme overrides (see ketcher-theme.css); bg comes from that class. */}
      <div className="relative flex-1 min-h-0 ketcher-host">
        {/* fallback={null}: the single KetcherLoading layer below already covers the
            lazy-chunk load, so we don't want a second spinner here. */}
        <Suspense fallback={null}>
          <KetcherEditor onInit={handleInit} />
        </Suspense>
        {/* One opaque loading layer for the whole load — the lazy chunk AND Ketcher's
            own Indigo engine init — so the previously-stacked Suspense fallback +
            translucent overlay + Ketcher's internal spinner no longer pile up. */}
        {!ready && <KetcherLoading />}
      </div>

      {/* Status line */}
      {status && (
        <div
          className="px-3 py-1 text-[11px] shrink-0"
          style={{
            color: status.kind === "ok" ? "var(--status-green)" : "var(--status-red)",
            borderTop: "1px solid var(--panel-border)",
          }}
        >
          {status.text}
        </div>
      )}

      {/* Action bar */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-3 py-2 shrink-0"
        style={{ borderTop: "1px solid var(--panel-border)" }}
      >
        <button
          onClick={handleAddTo3D}
          disabled={!ready || busy}
          className={`${btnBase} zatom-primary`}
          title="Convert the drawn structure to 3D atoms in the modeler"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
          Add to 3D
        </button>
        <button
          onClick={handleNewView}
          disabled={!ready || busy}
          className={`${btnBase} zatom-choice`}
          title="Send the drawn structure to a new viewport (keeps the current one)"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          New View
        </button>
        <button
          onClick={handleSaveFragment}
          disabled={!ready || busy}
          className={`${btnBase} zatom-choice`}
          title="Save as a reusable custom fragment"
        >
          <Save className="w-3.5 h-3.5" />
          Save as fragment
        </button>
        <div className="flex-1" />
        <button
          onClick={() => exportFile(".mol")}
          disabled={!ready || busy}
          className={`${btnBase} zatom-choice`}
          title="Download MOLfile"
        >
          <Download className="w-3 h-3" />
          MOL
        </button>
        <button
          onClick={() => exportFile(".xyz")}
          disabled={!ready || busy}
          className={`${btnBase} zatom-choice`}
          title="Download XYZ"
        >
          <Download className="w-3 h-3" />
          XYZ
        </button>
      </div>
    </div>,
    document.body,
  )
}
