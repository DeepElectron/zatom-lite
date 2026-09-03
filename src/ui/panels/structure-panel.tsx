"use client"

import { Suspense, lazy, useEffect, useRef, useState } from "react"
import {
  Upload, ChevronDown, AlertCircle, CheckCircle, Loader2, Hexagon, Download, Box, Puzzle, Trash2, Save, Pencil, Sparkles, type LucideIcon,
} from "lucide-react"
import * as THREE from "three"
import { SlidingSegmented } from "./panel-ui"
import { getActiveViewportStoreApi, useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useViewportManager } from "../../orchestration/viewportManager"
import { exportViewportPng, VIEWPORT_PNG_MAX_DIMENSION } from "../../orchestration/viewportPngExport"
import { useInstalledTemplatesStore } from "../../orchestration/installedTemplatesStore"
import { FRAGMENT_TEMPLATES } from "../../lib/molecule/templates"
import { getCustomFragments, saveCustomFragment, deleteCustomFragment, type CustomFragment } from "../../lib/molecule/custom-fragments"
import { quickOptimizeGeometry } from "../../lib/molecule/quick-optimize"
import { generateFragmentFromSmiles } from "../../lib/molecule/smiles-fragment"
import { createStructureTextExport } from "../../services/structure-text-export"
import { useStructureAssetRecorder } from "../structure-asset-context"
import { ConfirmDeleteDialog } from "./confirm-delete-dialog"
import {
  StructureFileImportDropzone,
  StructureImportWorkspace,
} from "./structure-import-workspace"
import { STRUCTURE_IMPORT_CATEGORIES } from "./structure-import-categories"
import { panelStatusTone } from "./panel-status"

const STRUCTURE_ERROR_TONE = panelStatusTone("error")

const FragmentDrawer = lazy(() =>
  import("./fragment-2d-drawer").then((module) => ({ default: module.FragmentDrawer }))
)


// --- Fragments ---

// Fragment attachment uses Cordero covalent radii and an outward direction.
const COVALENT_R: Record<string, number> = {
  H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39,
}
function bondLengthFor(e1: string, e2: string): number {
  return (COVALENT_R[e1] ?? 0.76) + (COVALENT_R[e2] ?? 0.76)
}
type V3 = [number, number, number]
function normV(v: V3): V3 { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
/**
 * Choose an outward attachment direction: +X with no neighbors, opposite one
 * neighbor, or opposite the mean direction. Symmetric degeneracies choose the
 * candidate axis or bond-plane normal farthest from every existing bond.
 */
function chooseOffsetDir(usedDirs: V3[], bl: number): V3 {
  if (usedDirs.length === 0) return [bl, 0, 0]
  if (usedDirs.length === 1) { const u = usedDirs[0]; return [-u[0] * bl, -u[1] * bl, -u[2] * bl] }
  const avg: V3 = [0, 0, 0]
  usedDirs.forEach(d => { avg[0] += d[0]; avg[1] += d[1]; avg[2] += d[2] })
  const am = Math.hypot(avg[0], avg[1], avg[2])
  if (am > 0.1) { const u = normV([-avg[0], -avg[1], -avg[2]]); return [u[0] * bl, u[1] * bl, u[2] * bl] }
  const cands: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const a = usedDirs[0], b = usedDirs[1]
  const cr: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  if (Math.hypot(cr[0], cr[1], cr[2]) > 0.1) { const c = normV(cr); cands.push(c, [-c[0], -c[1], -c[2]]) }
  let best = normV(cands[0]); let bestScore = Infinity
  for (const c of cands) {
    const cn = normV(c)
    let maxdot = -Infinity
    for (const d of usedDirs) { const dot = cn[0] * d[0] + cn[1] * d[1] + cn[2] * d[2]; if (dot > maxdot) maxdot = dot }
    if (maxdot < bestScore) { bestScore = maxdot; best = cn }
  }
  return [best[0] * bl, best[1] * bl, best[2] * bl]
}

function FragmentContent() {
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const recordStructureAsset = useStructureAssetRecorder()

  const [customFragments, setCustomFragments] = useState<CustomFragment[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [tab, setTab] = useState<'builtin' | 'custom'>('builtin')
  const installedTemplates = useInstalledTemplatesStore((s) => s.installed)
// 2D drawing window and SMILES-to-fragment workflow.
  const [show2DDrawer, setShow2DDrawer] = useState(false)
  const [showSmiles, setShowSmiles] = useState(false)
  const [smilesInput, setSmilesInput] = useState("")
  const [smilesName, setSmilesName] = useState("")
  const [smilesError, setSmilesError] = useState<string | null>(null)
  // Quick empirical geometry clean-up (pure front-end)
  const [optimizing, setOptimizing] = useState(false)
  const [optFlash, setOptFlash] = useState<string | null>(null)
  const [fragmentNotice, setFragmentNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null)

  useEffect(() => { setCustomFragments(getCustomFragments()) }, [])

  const builtinFragments = Object.entries(FRAGMENT_TEMPLATES).filter(([key]) => installedTemplates.has(`fragment:${key}`))

  // Save the current structure or selection as a custom fragment.
  const handleSaveFragment = () => {
    if (!saveName.trim()) return
    let atomsToSave = atoms ?? []
    let bondsToSave = bonds ?? []
    if (selectedAtomIds.size > 1) {
      const ids = Array.from(selectedAtomIds)
      atomsToSave = atomsToSave.filter(a => ids.includes(a.id))
      bondsToSave = bondsToSave.filter(b => ids.includes(b.atom1Id) && ids.includes(b.atom2Id))
    }
    if (atomsToSave.length === 0) return
    const idxMap = new Map(atomsToSave.map((a, i) => [a.id, i]))
    saveCustomFragment({
      name: saveName.trim(),
      atoms: atomsToSave.map(a => ({
        element: a.element,
        position: (a.cartesian ?? a.position ?? [0, 0, 0]) as [number, number, number],
      })),
      bonds: bondsToSave
        .filter(b => idxMap.has(b.atom1Id) && idxMap.has(b.atom2Id))
        .map(b => ({ from: idxMap.get(b.atom1Id)!, to: idxMap.get(b.atom2Id)!, type: b.type })),
      attachmentIndex: 0,
    })
    setCustomFragments(getCustomFragments())
    setShowSaveDialog(false)
    setSaveName("")
  }

  // Quick empirical geometry clean-up: spring/distance-geometry force field +
  // steepest descent, pure front-end (no backend / DFT / RDKit). Fixes bond
  // lengths/angles, removes clashes, and puckers planar (z=0) structures into 3D.
  const handleQuickOptimize = () => {
    const s = useCrystalStore.getState()
    const currentAtoms = s.atoms ?? []
    const currentBonds = s.bonds ?? []
    if (currentAtoms.length === 0) return
    setOptimizing(true)
    setOptFlash(null)
    // defer to next frame so the busy state can paint before the (fast) compute
    requestAnimationFrame(() => {
      try {
        const lv = s.latticeVectors
        const latticeMatrix = (s.periodic && lv)
          ? ([lv.a, lv.b, lv.c] as [[number, number, number], [number, number, number], [number, number, number]])
          : undefined
        const { positions, stats } = quickOptimizeGeometry(
          currentAtoms.map(a => ({ id: a.id, element: a.element, cartesian: a.cartesian, position: a.position })),
          currentBonds.map(b => ({ atom1Id: b.atom1Id, atom2Id: b.atom2Id, type: b.type })),
          latticeMatrix ? { latticeMatrix } : undefined,
        )
        const newAtoms = currentAtoms.map(a => {
          const p = positions[a.id]
          if (!p) return a
          return { ...a, cartesian: p, position: p as [number, number, number] }
        })
        s.setAtomsDirectly(newAtoms)
        setOptFlash(`Optimized · max move ${stats.maxMove.toFixed(2)}Å · clashes ${stats.clashesBefore}→${stats.clashesAfter}`)
        setTimeout(() => setOptFlash(null), 4000)
      } catch {
        setOptFlash('Optimization failed')
        setTimeout(() => setOptFlash(null), 4000)
      } finally {
        setOptimizing(false)
      }
    })
  }

  // Create a standalone molecule in an empty workspace; otherwise require one attachment atom.
  const attachOrLoad = (
    fragAtoms: Array<{ element: string; position: [number, number, number] }>,
    fragBonds: Array<{ from: number; to: number; type: string }>,
    attachIdx = 0,
    label = 'Fragment',
  ) => {
    const ts = Date.now()
    const store = useCrystalStore.getState()
    const currentAtoms = store.atoms ?? []
    const currentBonds = store.bonds ?? []
    const selIds = store.selectedAtomIds

    if (currentAtoms.length > 0 && selIds.size !== 1) {
      setFragmentNotice({ type: 'error', message: `Select exactly one atom to attach ${label}.` })
      return
    }

    // A single selected atom activates attachment mode.
    if (selIds.size === 1 && currentAtoms.length > 0) {
      const selId = Array.from(selIds)[0]
      const selAtom = currentAtoms.find(a => a.id === selId)
      if (!selAtom) return

      const attachPos: [number, number, number] = selAtom.cartesian ?? selAtom.position ?? [0, 0, 0]
      const fragAttachPos = fragAtoms[attachIdx]?.position ?? fragAtoms[0].position

      // Measure existing bond directions for VSEPR placement.
      const existingBonds = currentBonds.filter(b => b.atom1Id === selId || b.atom2Id === selId)
      const usedDirs: [number, number, number][] = []
      existingBonds.forEach(bond => {
        const otherId = bond.atom1Id === selId ? bond.atom2Id : bond.atom1Id
        const other = currentAtoms.find(a => a.id === otherId)
        if (other) {
          const op: [number, number, number] = other.cartesian ?? other.position ?? [0, 0, 0]
          const d: [number, number, number] = [op[0] - attachPos[0], op[1] - attachPos[1], op[2] - attachPos[2]]
          const m = Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
          if (m > 0) usedDirs.push([d[0] / m, d[1] / m, d[2] / m])
        }
      })

      // Use covalent radii for bond length and chooseOffsetDir for a stable outward direction.
      const bl = bondLengthFor(selAtom.element, fragAtoms[attachIdx]?.element ?? 'C')
      const offsetDir = chooseOffsetDir(usedDirs, bl)

      // Rotate the fragment before translation rather than preserving its authored orientation.
      // Align the attachment-to-centroid growth vector with the outward direction.
      // Then place the attachment atom at the bond endpoint.
      const bodyC: [number, number, number] = [0, 0, 0]
      let bodyN = 0
      fragAtoms.forEach((a, i) => {
        if (i === attachIdx) return
        bodyC[0] += a.position[0] - fragAttachPos[0]; bodyC[1] += a.position[1] - fragAttachPos[1]; bodyC[2] += a.position[2] - fragAttachPos[2]; bodyN++
      })
      const fragMag = Math.sqrt(bodyC[0] ** 2 + bodyC[1] ** 2 + bodyC[2] ** 2)
      const offMag = Math.sqrt(offsetDir[0] ** 2 + offsetDir[1] ** 2 + offsetDir[2] ** 2)
      let quat: THREE.Quaternion | null = null
      if (bodyN > 0 && fragMag > 1e-6 && offMag > 1e-6) {
        quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(bodyC[0], bodyC[1], bodyC[2]).normalize(),
          new THREE.Vector3(offsetDir[0], offsetDir[1], offsetDir[2]).normalize(),
        )
      }
      // Create rotated atoms with the attachment atom at the bond endpoint.
      const newAtoms = fragAtoms.map((a, i) => {
        const rel = new THREE.Vector3(a.position[0] - fragAttachPos[0], a.position[1] - fragAttachPos[1], a.position[2] - fragAttachPos[2])
        if (quat) rel.applyQuaternion(quat)
        const pos: [number, number, number] = [attachPos[0] + offsetDir[0] + rel.x, attachPos[1] + offsetDir[1] + rel.y, attachPos[2] + offsetDir[2] + rel.z]
        return { id: `frag-${i}-${ts}`, element: a.element, position: pos, cartesian: pos }
      })
      const newBonds = fragBonds.map((b, i) => ({
        id: `frag-bond-${i}-${ts}`,
        atom1Id: newAtoms[b.from]?.id ?? '',
        atom2Id: newAtoms[b.to]?.id ?? '',
        type: b.type as 'single' | 'double' | 'triple',
      }))
      // Create the connecting bond.
      const connectBond = {
        id: `connect-${ts}`,
        atom1Id: selId,
        atom2Id: newAtoms[attachIdx]?.id ?? newAtoms[0]?.id ?? '',
        type: 'single' as const,
      }
      // Push the fragment outward in up to three steps when non-anchor atoms clash below 0.9 Å.
      {
        const offN = normV(offsetDir as V3)
        for (let iter = 0; iter < 3; iter++) {
          let minD = Infinity
          for (let i = 0; i < newAtoms.length; i++) {
            if (i === attachIdx) continue
            const p = newAtoms[i].position
            for (const ca of currentAtoms) {
              const cp = ca.cartesian ?? ca.position ?? [0, 0, 0]
              const dd = Math.hypot(p[0] - cp[0], p[1] - cp[1], p[2] - cp[2])
              if (dd < minD) minD = dd
            }
          }
          if (minD >= 0.9) break
          newAtoms.forEach(a => {
            const np: [number, number, number] = [a.position[0] + offN[0] * 0.5, a.position[1] + offN[1] * 0.5, a.position[2] + offN[2] * 0.5]
            a.position = np; a.cartesian = np
          })
        }
      }
      store.pushHistory()
      // Adding topology that is not represented by the active PDB metadata
      // turns this into an ordinary modeled structure. Keep one canonical
      // document truth instead of leaving stale residue/layer annotations.
      store.clearBiomolecule()
      store.clearTrajectory()
      const userAddedAtomIds = new Set(store.userAddedAtomIds)
      if (store.periodic) {
        newAtoms.forEach((atom) => userAddedAtomIds.add(atom.id))
      }
      useCrystalStore.setState({
        atoms: [...currentAtoms, ...newAtoms],
        bonds: [...currentBonds, ...newBonds, connectBond],
        selectedAtomIds: new Set(),
        userAddedAtomIds,
      })
      setFragmentNotice({ type: 'info', message: `${label} attached · Unsaved changes in Assets.` })
    } else {
      // An empty workspace creates an independent nonperiodic molecular Asset.
      const newAtoms = fragAtoms.map((a, i) => ({
        id: `frag-${i}-${ts}`,
        element: a.element,
        position: a.position as [number, number, number],
        cartesian: a.position as [number, number, number],
      }))
      const newBonds = fragBonds.map((b, i) => ({
        id: `bond-${i}-${ts}`,
        atom1Id: newAtoms[b.from]?.id ?? '',
        atom2Id: newAtoms[b.to]?.id ?? '',
        type: b.type as 'single' | 'double' | 'triple',
      }))
      store.unbindFrame()
      store.pushHistory()
      store.clearBiomolecule()
      store.clearCrystalLayers()
      store.clearTrajectory()
      store.resetPresentationTimeline()
      useCrystalStore.setState({
        builderMode: 'structure',
        periodic: false,
        atoms: newAtoms,
        unitCellAtoms: [],
        bonds: newBonds,
        selectedAtomIds: new Set(),
        selectedBondIds: new Set(),
        focusedAtomIds: new Set(),
        userAddedAtomIds: new Set(),
        userDeletedPositions: new Set(),
        compactStructure: null,
        focusAtoms: [],
        supercellParams: { nx: 1, ny: 1, nz: 1 },
      })
      store.beginCameraDocument()
      if (newBonds.length === 0) store.autoDetectBonds()
      recordStructureAsset(label, 'template')
      setFragmentNotice({ type: 'info', message: `${label} created as a molecular Asset.` })
    }
  }

  // Load the built-in fragment.
  const handleLoadFragment = (key: string) => {
    const tpl = FRAGMENT_TEMPLATES[key]
    if (!tpl) return
    attachOrLoad(
      tpl.atoms.map(a => ({ element: a.element, position: [...a.position] as [number, number, number] })),
      (tpl.bonds ?? []).map(b => ({ from: b.from, to: b.to, type: b.type })),
      0,
      tpl.name,
    )
  }

  // Load a custom fragment.
  const handleLoadCustom = (frag: CustomFragment) => {
    if (!frag.atoms?.length) return
    attachOrLoad(frag.atoms, frag.bonds ?? [], frag.attachmentIndex ?? 0, frag.name)
  }

  // An asterisk marks the attachment endpoint in SMILES.
  // Examples include ethanol, carboxyl, and phenyl attachment groups.
  // Replace the marker with sentinel Xe before parsing and adding hydrogens.
  // Its neighbor becomes attachmentIndex before Xe and its bond are removed.
  // Remove orphan hydrogens; without a marker, fall back to a terminal non-hydrogen single bond.
  const handleSmilesToFragment = () => {
    const smi = smilesInput.trim()
    const generated = generateFragmentFromSmiles(smi)
    if (!generated.success) { setSmilesError(generated.error); return }
    saveCustomFragment({
      name: smilesName.trim() || smi,
      smiles: smi,
      atoms: generated.data.atoms,
      bonds: generated.data.bonds,
      attachmentIndex: generated.data.attachmentIndex,
    })
    setCustomFragments(getCustomFragments())
    setSmilesInput(""); setSmilesName(""); setSmilesError(null); setTab('custom')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tab switcher */}
      <SlidingSegmented
        options={[
          { value: 'builtin', label: 'Presets' },
          { value: 'custom', label: 'My Fragments' },
        ] as const}
        value={tab}
        onChange={setTab}
        ariaLabel="Fragment libraries"
        semantics="tabs"
        getOptionId={(value) => `fragment-${value}-tab`}
        getPanelId={(value) => `fragment-${value}-panel`}
      />

      {/* 2D drawing and SMILES-to-fragment tools. */}
      <div className="flex gap-2">
        <button onClick={() => { setShow2DDrawer(true);  }}
          className="zatom-choice zatom-pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px]"
        >
          <Pencil className="w-3.5 h-3.5" /> 2D Editor
        </button>
        <button onClick={() => { setShowSmiles(v => !v); setSmilesError(null) }}
          data-selected={showSmiles}
          className="zatom-choice zatom-pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px]"
        >
          <Hexagon className="w-3.5 h-3.5" /> SMILES
        </button>
      </div>

      <button
        onClick={handleQuickOptimize}
        disabled={(atoms ?? []).length === 0 || optimizing}
        className="zatom-choice zatom-pressable flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left"
        title="Local spring and distance-geometry cleanup. Adjusts molecular coordinates only; it does not run a backend calculation or relax the cell."
      >
        {optimizing
          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          : <Sparkles className="h-4 w-4 shrink-0" />}
        <span className="min-w-0">
          <span className="block text-[12px] font-medium" style={{ color: 'var(--panel-text)' }}>
            {optimizing ? 'Optimizing…' : 'Quick Optimize'}
          </span>
          <span className="mt-0.5 block text-[10px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
            Local empirical geometry cleanup
          </span>
        </span>
      </button>
      {optFlash && (
        <div role="status" style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', textAlign: 'center' }}>{optFlash}</div>
      )}

      {fragmentNotice && (
        <div
          role={fragmentNotice.type === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4"
          style={fragmentNotice.type === 'error'
            ? { color: 'var(--panel-text-secondary)', borderColor: 'color-mix(in srgb, #FF9F0A 34%, var(--panel-border))', backgroundColor: 'color-mix(in srgb, #FF9F0A 8%, var(--panel-elevated))' }
            : { color: 'var(--panel-text-secondary)', borderColor: 'var(--panel-border)', backgroundColor: 'var(--panel-elevated)' }}
        >
          {fragmentNotice.type === 'error'
            ? <AlertCircle className="status-amber mt-0.5 h-3.5 w-3.5 shrink-0" />
            : <CheckCircle className="status-green mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{fragmentNotice.message}</span>
        </div>
      )}

      {/* SMILES-to-fragment input. */}
      {showSmiles && (
        <div className="flex flex-col gap-1.5 p-2 rounded-lg" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <input type="text" value={smilesInput}
            onChange={e => { setSmilesInput(e.target.value); setSmilesError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleSmilesToFragment() }}
            placeholder="SMILES — mark attach point with *, e.g. *CCO, *C(=O)O, *c1ccccc1"
            className="zatom-field rounded px-2 py-1.5 text-[11px]"
          />
          <div className="flex gap-1.5">
            <input type="text" value={smilesName} onChange={e => setSmilesName(e.target.value)}
              placeholder="Fragment name (optional)"
              className="zatom-field flex-1 rounded px-2 py-1.5 text-[11px]"
            />
            <button onClick={handleSmilesToFragment} disabled={!smilesInput.trim()}
              className="zatom-primary zatom-pressable rounded px-3 py-1.5 text-[11px] font-medium"
            >Parse &amp; Save</button>
          </div>
          {smilesError && (
            <div
              role="alert"
              className="rounded-md px-2 py-1.5 text-[10px]"
              style={{
                color: STRUCTURE_ERROR_TONE.foreground,
                backgroundColor: STRUCTURE_ERROR_TONE.background,
                border: `1px solid ${STRUCTURE_ERROR_TONE.border}`,
              }}
            >
              {smilesError}
            </div>
          )}
        </div>
      )}

      {/* Preset fragments */}
      {tab === 'builtin' && (
        <div id="fragment-builtin-panel" role="tabpanel" aria-labelledby="fragment-builtin-tab" className="grid grid-cols-2 gap-2">
          {builtinFragments.map(([key, f]) => (
            <button key={key} onClick={() => handleLoadFragment(key)}
              className="zatom-choice zatom-pressable flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              <span className="text-[12px] font-medium" style={{ color: 'var(--panel-text)' }}>{f.name}</span>
              <span className="rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--panel-text-secondary)' }}>{f.formula}</span>
            </button>
          ))}
        </div>
      )}

      {/* Custom fragments */}
      {tab === 'custom' && (
        <div id="fragment-custom-panel" role="tabpanel" aria-labelledby="fragment-custom-tab" className="flex flex-col gap-2">
          {customFragments.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>
              No saved fragments. Select atoms and save below.
            </p>
          ) : (
            customFragments.map(frag => (
              <div key={frag.id} className="flex items-center gap-2 px-3 py-2.5 rounded-lg group"
                style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
              >
                <Puzzle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} />
                <button onClick={() => handleLoadCustom(frag)} className="flex-1 text-left min-w-0">
                  <div style={{ fontSize: 12, color: 'var(--panel-text)' }} className="truncate">{frag.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>{frag.atoms?.length ?? 0} atoms</div>
                </button>
                <ConfirmDeleteDialog
                  title={`Delete “${frag.name}”?`}
                  description="This permanently removes the saved fragment from My Fragments."
                  confirmLabel="Delete Fragment"
                  onConfirm={() => { deleteCustomFragment(frag.id); setCustomFragments(getCustomFragments());  }}
                >
                  <button
                    type="button"
                    aria-label={`Delete ${frag.name}`}
                    title="Delete saved fragment"
                    className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    style={{ color: 'var(--panel-text-tertiary)' }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </ConfirmDeleteDialog>
              </div>
            ))
          )}
        </div>
      )}

      {/* Save fragment button */}
      {!showSaveDialog ? (
        <button onClick={() => setShowSaveDialog(true)}
          disabled={(atoms ?? []).length === 0}
          className="zatom-pressable flex items-center justify-center gap-2 rounded-lg py-2.5 hover:bg-[var(--panel-elevated)]"
          style={{ border: '1px dashed var(--panel-border-focus)', color: 'var(--panel-text-tertiary)', fontSize: 12 }}
        >
          <Save className="w-3.5 h-3.5" />
          {selectedAtomIds.size > 1 ? `Save ${selectedAtomIds.size} atoms as fragment` : 'Save as fragment'}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveFragment()}
            placeholder="Fragment name..."
            className="zatom-field flex-1 rounded-lg px-3 py-2 text-[12px]"
            autoFocus
          />
          <button onClick={handleSaveFragment} disabled={!saveName.trim()}
            className="zatom-primary zatom-pressable rounded-lg px-3 py-2 text-[11px] font-medium"
          >Save</button>
          <button onClick={() => { setShowSaveDialog(false); setSaveName("") }}
            className="px-2 py-2 rounded-lg text-[11px]"
            style={{ color: 'var(--panel-text-tertiary)' }}
          >×</button>
        </div>
      )}

      {/* 2D molecule drawing window. */}
      {show2DDrawer && (
        <Suspense fallback={null}>
          <FragmentDrawer onClose={() => setShow2DDrawer(false)} />
        </Suspense>
      )}
    </div>
  )
}

// --- Export & Assembly ---

function ExportContent() {
  const atoms = useCrystalStore((s) => s.atoms)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const compactAtomCount = useCrystalStore((s) => s.compactStructure?.count ?? 0)
  const periodic = useCrystalStore((s) => s.periodic)
  const addBuildingBlock = useCrystalStore((s) => s.addBuildingBlock)
  const [blockName, setBlockName] = useState("")
  const [pngStatus, setPngStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error'
    message?: string
  }>({ type: 'idle' })

  const atomCount = (atoms ?? []).length
  const renderedAtomCount = Math.max(atomCount, compactAtomCount, bioStructure?.atoms.length ?? 0)
  const textExportFormat = bioStructure ? 'pdb' : periodic ? 'cif' : 'xyz'
  if (renderedAtomCount === 0) {
    return <p style={{ fontSize: 12, color: 'var(--panel-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>Build a structure first</p>
  }

  const handleExportPng = async () => {
    setPngStatus({ type: 'loading', message: 'Rendering the active viewport…' })
    // Resolve the key and label from one manager snapshot. Even if the user
    // activates another pane while capture is rendering, the registry remains
    // pinned to the pane that owned this click.
    const manager = useViewportManager.getState()
    const viewportId = manager.activeViewportId
    const slot = manager.viewports[viewportId]
    const registryKey = manager.getActiveStore()
    const state = registryKey.getState()
    const sourceName = slot?.kind === 'crystal' && slot.structureName
      ? slot.structureName
      : state.bioStructure?.title || state.bioStructure?.id || (state.periodic ? 'crystal' : 'molecule')
    try {
      const result = await exportViewportPng({ registryKey, sourceName })
      setPngStatus({
        type: 'success',
        message: `${result.fileName} · ${result.width}×${result.height}px`,
      })
    } catch (error) {
      setPngStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'PNG export failed',
      })
    }
  }

  const handleExportStructure = () => {
    const exported = createStructureTextExport(getActiveViewportStoreApi().getState())
    downloadFile(exported.content, exported.suggestedName)
  }

  const handleSaveToAssembly = () => {
    if (!blockName.trim()) return
    addBuildingBlock(blockName.trim())
    setBlockName("")
    // Do not switch modes automatically; saved blocks remain available in Assembly.
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => { void handleExportPng() }}
          disabled={pngStatus.type === 'loading'}
          className="zatom-primary zatom-pressable flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-medium"
        >
          {pngStatus.type === 'loading'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            : <Download className="h-3.5 w-3.5" />}
          {pngStatus.type === 'loading' ? 'Rendering PNG…' : 'Export 3D scene as PNG'}
        </button>
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">
          Active WebGL scene · current aspect ratio · up to {VIEWPORT_PNG_MAX_DIMENSION}px
        </p>
        {pngStatus.type !== 'idle' && pngStatus.type !== 'loading' && (
          <p
            role={pngStatus.type === 'error' ? 'alert' : 'status'}
            className="rounded-lg px-2.5 py-2 text-[10px]"
            style={{
              color: pngStatus.type === 'error' ? 'var(--status-red)' : 'var(--status-green)',
              backgroundColor: pngStatus.type === 'error' ? 'var(--status-red-bg)' : 'var(--status-green-bg)',
            }}
          >
            {pngStatus.message}
          </p>
        )}
      </div>

      {/* Export buttons */}
      {(atomCount > 0 || Boolean(bioStructure?.atoms.length)) && <div className="grid grid-cols-1 gap-2">
        <button onClick={handleExportStructure}
          className="zatom-pressable flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-medium transition-[background-color,color,border-color] duration-150 ease-out hover:bg-[var(--panel-elevated)]"
          style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}
        >
          <Download className="w-3.5 h-3.5" />
          {`Export .${textExportFormat}`}
        </button>
      </div>}

      {/* Save to Assembly */}
      {atomCount > 0 && <div className="flex gap-2">
        <input
          type="text"
          value={blockName}
          onChange={e => setBlockName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSaveToAssembly()}
          placeholder="Block name..."
          className="zatom-field flex-1 rounded-lg px-3 py-2 text-[12px]"
        />
        <button
          onClick={handleSaveToAssembly}
          disabled={!blockName.trim()}
          className="zatom-choice zatom-pressable flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium"
        >
          <Box className="w-3.5 h-3.5" />
          Assembly
        </button>
      </div>}

      <p style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>{renderedAtomCount} atoms</p>
    </div>
  )
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.style.display = 'none'
  document.body.appendChild(a); a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 100)
}

function FixedStructureSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-[var(--panel-border)] pb-4 last:border-b-0">
      <div className="flex min-h-8 items-center gap-2.5 px-1 text-[var(--panel-text-secondary)]">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-[12px] font-semibold">{title}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function StructurePanel() {
  const ensureTemplatesHydrated = useInstalledTemplatesStore((state) => state.ensureHydrated)
  const [importOpen, setImportOpen] = useState(false)
  // Mount the workspace on first expansion to avoid initial cost, then retain it
  // so later disclosure uses the same measurement-free CSS transition.
  const [importMounted, setImportMounted] = useState(false)
  const importOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { ensureTemplatesHydrated() }, [ensureTemplatesHydrated])

  const clearImportOpenTimer = () => {
    if (importOpenTimer.current) clearTimeout(importOpenTimer.current)
    importOpenTimer.current = null
  }
  const clearImportCloseTimer = () => {
    if (importCloseTimer.current) clearTimeout(importCloseTimer.current)
    importCloseTimer.current = null
  }
  const revealImport = () => {
    setImportMounted(true)
    setImportOpen(true)
  }
  const scheduleImportOpen = () => {
    clearImportCloseTimer()
    if (importOpen || importOpenTimer.current) return
    importOpenTimer.current = setTimeout(() => {
      importOpenTimer.current = null
      revealImport()
    }, 180)
  }
  const openImportNow = () => {
    clearImportOpenTimer()
    clearImportCloseTimer()
    revealImport()
  }
  // Pointer focus occurs before click; unconditional focus expansion would
  // open and immediately close the disclosure, so distinguish pointer and keyboard focus.
  const importPointerSession = useRef(false)
  const toggleImport = () => {
    clearImportOpenTimer()
    clearImportCloseTimer()
    if (importOpen) setImportOpen(false)
    else revealImport()
  }
  const scheduleImportClose = () => {
    clearImportOpenTimer()
    if (!importOpen || importCloseTimer.current) return
    importCloseTimer.current = setTimeout(() => {
      importCloseTimer.current = null
      setImportOpen(false)
    }, 420)
  }

  useEffect(() => () => {
    clearImportOpenTimer()
    clearImportCloseTimer()
  }, [])

  return (
    <div className="flex h-full w-full flex-col">
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <section
          className="border-b border-[var(--panel-border)] pb-4"
          onPointerEnter={clearImportCloseTimer}
          onPointerLeave={scheduleImportClose}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleImportClose()
          }}
        >
          <button
            type="button"
            aria-expanded={importOpen}
            aria-controls="structure-import-workspace"
            onPointerEnter={scheduleImportOpen}
            onPointerDown={() => { importPointerSession.current = true }}
            onFocus={() => { if (!importPointerSession.current) openImportNow() }}
            onClick={() => { importPointerSession.current = false; toggleImport() }}
            className="zatom-pressable flex min-h-8 w-full items-center gap-2.5 rounded-lg px-1 text-left text-[var(--panel-text-secondary)]"
          >
            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-[12px] font-semibold">Import</span>
            {/* Derive counts from the registry so source additions cannot stale a constant. */}
            <span className="text-[10px] text-[var(--panel-text-tertiary)]">
              {STRUCTURE_IMPORT_CATEGORIES.length} sources
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none"
              style={{
                transform: importOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                // Use the same curve and duration as panel height so arrow and panel feel unified.
                transitionDuration: importOpen ? '700ms' : '540ms',
                transitionTimingFunction: importOpen
                  ? 'cubic-bezier(0.36, 0.04, 0.2, 1)'
                  : 'cubic-bezier(0.4, 0.02, 0.3, 1)',
              }}
              aria-hidden="true"
            />
          </button>

          <div className="mt-3"><StructureFileImportDropzone /></div>

          {/* Animate intrinsic height with grid rows instead of measuring auto height during mount. */}
          <div
            id="structure-import-workspace"
            aria-hidden={!importOpen}
            {...(!importOpen ? { inert: "" } : {})}
            className="grid transition-[grid-template-rows] motion-reduce:transition-none"
            style={{
              gridTemplateRows: importOpen ? "1fr" : "0fr",
              // Use a gentle S-curve for expansion rather than an abrupt exponential start.
              // The middle stays fluid and the tail settles slowly.
              // Collapse slightly faster to avoid a sluggish close.
              transitionDuration: importOpen ? "700ms" : "540ms",
              transitionTimingFunction: importOpen
                ? "cubic-bezier(0.36, 0.04, 0.2, 1)"
                : "cubic-bezier(0.4, 0.02, 0.3, 1)",
            }}
          >
            <div
              className="min-h-0 overflow-hidden transition-[opacity,transform] motion-reduce:transition-none"
              style={{
                opacity: importOpen ? 1 : 0,
                transform: importOpen ? "translateY(0)" : "translateY(-8px)",
                // Delay content opacity until height has started moving.
                transitionDuration: importOpen ? "520ms" : "240ms",
                transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: importOpen ? "140ms" : "0ms",
              }}
            >
              <div className="mt-3">{importMounted ? <StructureImportWorkspace /> : null}</div>
            </div>
          </div>
        </section>

        <FixedStructureSection title="Export" icon={Save}>
          <ExportContent />
        </FixedStructureSection>

        <FixedStructureSection title="Fragments" icon={Puzzle}>
          <FragmentContent />
        </FixedStructureSection>
      </div>
    </div>
  )
}
