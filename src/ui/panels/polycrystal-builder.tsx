"use client"

import { useRef, useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { BuilderRow, NumInput, BuildButton, StatusLine } from "./builder-controls"
import { STRUCTURE_TEMPLATE_CIFS, getCrystalTemplateNames } from "../../lib/crystal/crystal-template-cifs"
import { parseCIF } from "../../lib/crystal/cif-parser"
import { calculateLatticeVectors } from "../../lib/crystal/lattice"
import { generateAtomId } from "../../lib/crystal/supercell-utils"
import { generatePolycrystal } from "../../lib/polycrystal/polycrystal-generator"
import { polycrystalToXYZ } from "../../lib/polycrystal/polycrystal-to-xyz"
import type { BaseCell, PolycrystalOptions, PolycrystalResult } from "../../lib/polycrystal/types"
import type {
  PolycrystalWorkerRequest,
  PolycrystalWorkerResponse,
} from "../../lib/polycrystal/polycrystal-worker-types"
import type { Atom } from "../../lib/crystal/types"
import { CompactSelectionTools } from "./compact-selection-tools"

/** Above this displayed-atom count we stride-downsample for interactivity (full set kept for export). */
const DISPLAY_MAX_ATOMS = 150000

/** Above this count we render via the compact impostor path (full count to the GPU)
 *  instead of materializing Atom[]. Below it, the normal Atom[] path keeps full
 *  interaction (select / box-select / measure / edit); the impostor path defers
 *  bulk selection to Phase B3, so we only switch when normal mode can't cope. */
const COMPACT_THRESHOLD = 150000

function buildBaseCell(templateKey: string): BaseCell {
  const entry = STRUCTURE_TEMPLATE_CIFS[templateKey]
  const parsed = parseCIF(entry.cif)
  if (!parsed.success) throw new Error(`Failed to parse base crystal: ${parsed.error.message}`)
  const latticeVectors = calculateLatticeVectors(parsed.data.latticeParams)
  const basis = parsed.data.atoms.map((a) => ({ element: a.element, frac: a.position as [number, number, number] }))
  return { latticeVectors, basis }
}

function resultToAtoms(result: PolycrystalResult): Atom[] {
  const stride = result.count > DISPLAY_MAX_ATOMS ? Math.ceil(result.count / DISPLAY_MAX_ATOMS) : 1
  const atoms: Atom[] = []
  for (let i = 0; i < result.count; i += stride) {
    const x = result.positions[i * 3], y = result.positions[i * 3 + 1], z = result.positions[i * 3 + 2]
    atoms.push({
      id: generateAtomId(),
      element: result.elements[result.elementIndex[i]],
      position: [x, y, z],
      cartesian: [x, y, z],
      props: { grain_id: { kind: "scalar", value: result.grainId[i] } },
    })
  }
  return atoms
}

export function PolycrystalBuilderSection() {
  const replaceAtomsDirectly = useCrystalStore((s) => s.replaceAtomsDirectly)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)
  const setShowGrainColoring = useCrystalStore((s) => s.setShowGrainColoring)
  const showGrainColoring = useCrystalStore((s) => s.showGrainColoring)
  const replaceCompactStructure = useCrystalStore((s) => s.replaceCompactStructure)
  const setRegionSeeds = useCrystalStore((s) => s.setRegionSeeds)
  const compactStructure = useCrystalStore((s) => s.compactStructure)
  const compactTrajectory = useCrystalStore((s) => s.compactTrajectory)
  const compactTrajectoryPlaying = useCrystalStore((s) => s.compactTrajectoryPlaying)
  const compactTrajectoryDisplayFrame = useCrystalStore((s) => s.compactTrajectoryDisplayFrame)
  const setCompactTrajectory = useCrystalStore((s) => s.setCompactTrajectory)
  const loadCompactTrajectoryFile = useCrystalStore((s) => s.loadCompactTrajectoryFile)
  const setCompactTrajectoryPlaying = useCrystalStore((s) => s.setCompactTrajectoryPlaying)
  const requestCompactTrajectorySeek = useCrystalStore((s) => s.requestCompactTrajectorySeek)
  const showRegionSolids = useCrystalStore((s) => s.showRegionSolids)
  const hideAtomsInRegionView = useCrystalStore((s) => s.hideAtomsInRegionView)
  const regionOpacity = useCrystalStore((s) => s.regionOpacity)
  const setShowRegionSolids = useCrystalStore((s) => s.setShowRegionSolids)
  const setHideAtomsInRegionView = useCrystalStore((s) => s.setHideAtomsInRegionView)
  const setRegionOpacity = useCrystalStore((s) => s.setRegionOpacity)
  const regionGeometryMode = useCrystalStore((s) => s.regionGeometryMode)
  const setRegionGeometryMode = useCrystalStore((s) => s.setRegionGeometryMode)
  const regionHideMajority = useCrystalStore((s) => s.regionHideMajority)
  const setRegionHideMajority = useCrystalStore((s) => s.setRegionHideMajority)
  const compactSpeciesSource = useCrystalStore((s) => s.compactSpeciesSource)

  const [templateKey, setTemplateKey] = useState("fcc")
  const [boxSize, setBoxSize] = useState("40")
  const [grains, setGrains] = useState("12")
  const [minDist, setMinDist] = useState("0")
  const [overlap, setOverlap] = useState("1.5")
  const [seed, setSeed] = useState("2024")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [trajFrames, setTrajFrames] = useState("10000")
  const [trajFps, setTrajFps] = useState("30")
  const [trajAmp, setTrajAmp] = useState("1.0")
  const [trajLoadStatus, setTrajLoadStatus] = useState<string | null>(null)
  const trajFileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const fullResultRef = useRef<PolycrystalResult | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const latestRequestIdRef = useRef<string | null>(null)
  const [hasResult, setHasResult] = useState(false)

  // B2 v2: stream a real multi-frame extXYZ file through the compact playback path.
  // The file is byte-indexed (never fully resident); frames decode into a sliding window.
  const onTrajectoryFile = async (file: File) => {
    try {
      setTrajLoadStatus("Indexing 0%…")
      const { frameCount, atomCount } = await loadCompactTrajectoryFile(file, {
        trajFps: Math.max(1, parseFloat(trajFps) || 30),
        onProgress: (f) => setTrajLoadStatus(`Indexing ${Math.round(f * 100)}%…`),
      })
      setTrajLoadStatus(`${file.name}: ${frameCount.toLocaleString()} frames × ${atomCount.toLocaleString()} atoms (streamed)`)
    } catch (err) {
      setTrajLoadStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const ingest = (result: PolycrystalResult) => {
    fullResultRef.current = result
    setHasResult(true)
    // Large structures render the FULL count via the compact impostor path
    // (no 80k Atom[] downsample). PolycrystalResult already has the CompactStructure shape.
    if (result.count > COMPACT_THRESHOLD) {
      replaceCompactStructure({
        positions: result.positions,
        elementIndex: result.elementIndex,
        elements: result.elements,
        grainId: result.grainId,
        count: result.count,
        bbox: result.bbox,
      })
      setRegionSeeds(result.seeds)
      setShowGrainColoring(true)
      setStatus({ ok: true, message: `Generated ${result.count.toLocaleString()} atoms across ${grains} grains (compact render).` })
      return
    }
    // Small: existing Atom[] path (full editing/overlays). replaceAtomsDirectly clears
    // any prior compactStructure, exiting compact mode.
    const atoms = resultToAtoms(result)
    setPeriodic(false)
    replaceAtomsDirectly(atoms)
    setRegionSeeds(result.seeds)
    setShowGrainColoring(true)
    setStatus({ ok: true, message: `Generated ${result.count.toLocaleString()} atoms across ${grains} grains.` })
  }

  const handleBuild = () => {
    setStatus(null)
    setProgress(0)
    let base: BaseCell
    try {
      base = buildBaseCell(templateKey)
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) })
      return
    }
    const options: PolycrystalOptions = {
      baseTemplateKey: templateKey,
      boxSize: Math.max(4, parseFloat(boxSize) || 40),
      grainCount: Math.max(1, parseInt(grains) || 12),
      minSeedDistance: Math.max(0, parseFloat(minDist) || 0),
      overlapDmin: Math.max(0, parseFloat(overlap) || 0),
      maxAtoms: 10_000_000,
      seed: parseInt(seed) || 0,
    }
    const requestId = `poly:${Date.now().toString(36)}`
    latestRequestIdRef.current = requestId
    setBusy(true)

    // Fallback: no worker (SSR/test) → run synchronously on the main thread.
    if (typeof Worker === "undefined") {
      try {
        ingest(generatePolycrystal(options, base))
      } catch (e) {
        setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) })
      } finally {
        setBusy(false)
      }
      return
    }

    const worker =
      workerRef.current ??
      new Worker(new URL("../../lib/polycrystal/polycrystal.worker.ts", import.meta.url), { type: "module" })
    workerRef.current = worker

    const cleanup = () => {
      worker.removeEventListener("message", handleMessage)
      worker.removeEventListener("error", handleError)
    }
    const handleMessage = (event: MessageEvent<PolycrystalWorkerResponse>) => {
      const data = event.data
      if (data.requestId !== latestRequestIdRef.current) return
      if (data.kind === "progress") { setProgress(data.fraction); return }
      cleanup()
      setBusy(false)
      if (data.kind === "error") {
        setStatus({ ok: false, message: data.error })
        return
      }
      ingest({
        positions: data.positions, elementIndex: data.elementIndex, grainId: data.grainId,
        basisIndex: data.basisIndex,
        elements: data.elements, count: data.count, bbox: data.bbox, seeds: data.seeds,
        rotations: data.rotations,
      })
    }
    const handleError = () => {
      cleanup()
      // fall back to main-thread compute
      try { ingest(generatePolycrystal(options, base)) }
      catch (e) { setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) }) }
      finally { setBusy(false) }
    }
    worker.addEventListener("message", handleMessage)
    worker.addEventListener("error", handleError)
    const request: PolycrystalWorkerRequest = { requestId, options, base }
    worker.postMessage(request)
  }

  const handleExport = () => {
    const r = fullResultRef.current
    if (!r) return
    const xyz = polycrystalToXYZ(r)
    const blob = new Blob([xyz], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `polycrystal-${templateKey}-${r.count}.xyz`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Polycrystal generator</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Voronoi tessellation filled with randomly-oriented grains of a base crystal. No bonds drawn.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Base crystal">
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            className="px-1.5 py-0.5 rounded text-[11px] bg-transparent"
            style={{ border: "1px solid var(--panel-border)", color: "var(--panel-text)" }}
          >
            {getCrystalTemplateNames().map((k) => (
              <option key={k} value={k} style={{ color: "#000" }}>{STRUCTURE_TEMPLATE_CIFS[k].name}</option>
            ))}
          </select>
        </BuilderRow>
        <BuilderRow label="Box (Å)"><NumInput value={boxSize} onChange={setBoxSize} step="5" /></BuilderRow>
        <BuilderRow label="Grains"><NumInput value={grains} onChange={setGrains} step="1" /></BuilderRow>
        <BuilderRow label="Min seed dist (Å)"><NumInput value={minDist} onChange={setMinDist} step="0.5" /></BuilderRow>
        <BuilderRow label="Overlap cut (Å)"><NumInput value={overlap} onChange={setOverlap} step="0.1" /></BuilderRow>
        <BuilderRow label="Seed"><NumInput value={seed} onChange={setSeed} step="1" /></BuilderRow>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--panel-text-secondary)", cursor: "pointer" }}>
        <input type="checkbox" checked={showGrainColoring} onChange={(e) => setShowGrainColoring(e.target.checked)} />
        Color by grain
      </label>

      <BuildButton label={busy ? `Generating… ${Math.round(progress * 100)}%` : "Generate polycrystal"} onClick={handleBuild} disabled={busy} />
      {hasResult && !busy && fullResultRef.current && (
        <button
          onClick={handleExport}
          className="w-full py-2 rounded-lg text-[11px]"
          style={{ border: "1px solid var(--panel-border)", color: "var(--panel-text-secondary)" }}
        >
          Export full XYZ ({fullResultRef.current.count.toLocaleString()} atoms)
        </button>
      )}
      {status && <StatusLine status={status} />}
      <CompactSelectionTools />

      {/* Phase C: region solids — per-grain/layer translucent hulls (boundary view).
          Flows with the trajectory when one is playing. Shown as soon as a result exists
          (hasResult) — small results use the detail Atom[] path and never set
          compactStructure, so gating on compactStructure alone hid the options until a
          trajectory forced compact mode. */}
      {(compactStructure || hasResult) && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
          <div style={{ fontSize: 12, color: "var(--panel-text)", marginBottom: 6 }}>Region view</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--panel-text-secondary)", cursor: "pointer", marginBottom: 4 }}>
            <input type="checkbox" checked={showRegionSolids} onChange={(e) => setShowRegionSolids(e.target.checked)} />
            Show region solids
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--panel-text-secondary)", cursor: "pointer", marginBottom: 6 }}>
            <input type="checkbox" checked={hideAtomsInRegionView} onChange={(e) => setHideAtomsInRegionView(e.target.checked)} disabled={!showRegionSolids} />
            Hide atoms (regions only)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "var(--panel-text-tertiary)" }}>Opacity</span>
            <input
              type="range" min={0.1} max={0.9} step={0.05} value={regionOpacity}
              onChange={(e) => setRegionOpacity(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--panel-text-tertiary)" }}>Geometry</span>
            <select
              value={regionGeometryMode}
              onChange={(e) => setRegionGeometryMode(e.target.value as 'auto' | 'hull' | 'voxel')}
              style={{ flex: 1, fontSize: 11, background: "var(--panel-elevated)", color: "var(--panel-text)", border: "1px solid var(--panel-border)", borderRadius: 6, padding: "2px 4px" }}
            >
              <option value="auto">Auto</option>
              <option value="hull">Convex hull</option>
              <option value="voxel">Voxel surface</option>
            </select>
          </div>
          {/* dynamic (per-frame species) regions: hide the background phase so the
              minority phase plays as solid blocks */}
          {compactSpeciesSource && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--panel-text-secondary)", cursor: "pointer", marginTop: 6 }}>
              <input type="checkbox" checked={regionHideMajority} onChange={(e) => setRegionHideMajority(e.target.checked)} />
              Hide majority phase
            </label>
          )}
        </div>
      )}

      {/* B2: trajectory — synthetic demo frames (zero-storage stress test) or a real
          multi-frame extXYZ file streamed through the same compact playback path. */}
      {(
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
          <div style={{ fontSize: 12, color: "var(--panel-text)", marginBottom: 6 }}>Trajectory</div>
          {!compactTrajectory ? (
            <>
              <BuilderRow label="Frames"><NumInput value={trajFrames} onChange={setTrajFrames} step="1000" /></BuilderRow>
              <BuilderRow label="Traj FPS"><NumInput value={trajFps} onChange={setTrajFps} step="5" /></BuilderRow>
              <BuilderRow label="Amplitude (Å)"><NumInput value={trajAmp} onChange={setTrajAmp} step="0.1" /></BuilderRow>
              <button
                className="zatom-primary zatom-pressable mt-1 w-full rounded-lg py-2 text-[11px]"
                onClick={() => {
                  const r = fullResultRef.current
                  if (!r) return
                  if (!compactStructure) {
                    replaceCompactStructure({
                      positions: r.positions, elementIndex: r.elementIndex, elements: r.elements,
                      grainId: r.grainId, count: r.count, bbox: r.bbox,
                    })
                    setShowGrainColoring(true)
                  }
                  setCompactTrajectory({
                    frameCount: Math.max(2, parseInt(trajFrames) || 10000),
                    trajFps: Math.max(1, parseFloat(trajFps) || 30),
                    amplitude: Math.max(0.05, parseFloat(trajAmp) || 1.0),
                  })
                }}
              >
                ▶ Start demo trajectory
              </button>
              <div style={{ borderTop: "1px solid var(--panel-border)", margin: "8px 0" }} />
              <input
                ref={trajFileRef}
                type="file"
                accept=".xyz,.extxyz"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onTrajectoryFile(f); e.target.value = "" }}
              />
              <button
                className="w-full py-2 rounded-lg text-[11px]"
                style={{ border: "1px solid var(--panel-border)", color: "var(--panel-text)" }}
                onClick={() => trajFileRef.current?.click()}
              >
                Load trajectory file (.xyz / .extxyz)
              </button>
              {trajLoadStatus && (
                <div style={{ fontSize: 10, color: "var(--panel-text-tertiary)", marginTop: 4 }}>{trajLoadStatus}</div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px]"
                  style={{ border: "1px solid var(--panel-border)", color: "var(--panel-text)" }}
                  onClick={() => { setCompactTrajectoryPlaying(!compactTrajectoryPlaying);  }}
                >
                  {compactTrajectoryPlaying ? "Pause" : "Play"}
                </button>
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px]"
                  style={{ border: "1px solid var(--panel-border)", color: "var(--panel-text-secondary)" }}
                  onClick={() => { setCompactTrajectory(null);  }}
                >
                  Stop
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={compactTrajectory.frameCount - 1}
                value={compactTrajectoryDisplayFrame}
                onChange={(e) => requestCompactTrajectorySeek(parseInt(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 10, color: "var(--panel-text-tertiary)", textAlign: "right" }}>
                frame {compactTrajectoryDisplayFrame.toLocaleString()} / {compactTrajectory.frameCount.toLocaleString()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
