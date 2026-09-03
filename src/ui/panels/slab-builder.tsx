/**
 * Three-step slab cutter and surface passivation workflow. Unlike PlaneBuilder,
 * it replaces the structure with the generated slab.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildSlabFromMiller, buildSlabFromPlane, formatHillFormula, interplanarSpacing } from "../../lib/analysis/builders/slab"
import { passivateSlab } from "../../lib/analysis/builders/passivation"
import type { BuilderResult } from "../../lib/analysis/builders/types"
import type { Atom, LatticeVectors } from "../../lib/crystal/types"
import { atomicNumberToSymbol } from "../../chemistry/periodic-table"
import type { BackendService } from "../../host"
import { getGlobalBackendClient } from "../../host"
import { panelStatusTone } from "./panel-status"

const SUCCESS_TONE = panelStatusTone("success")
const WARNING_TONE = panelStatusTone("warning")
const ERROR_TONE = panelStatusTone("error")

/** Serialize current scene atoms + lattice to extended-XYZ. Used as a snapshot
 *  so we can restore on "Back" when the slab preview replaces the scene. */
function serializeToXyz(atoms: Atom[], lattice: LatticeVectors | null): string {
  const lines: string[] = [String(atoms.length)]
  let header = 'Properties=species:S:1:pos:R:3'
  if (lattice) {
    const rows = [lattice.a, lattice.b, lattice.c]
    const latStr = rows.flatMap((v) => v.map((x) => x.toFixed(6))).join(' ')
    header = `Lattice="${latStr}" ${header}`
  }
  lines.push(header)
  for (const a of atoms) {
    let cart: [number, number, number]
    if (a.cartesian) {
      cart = a.cartesian
    } else if (lattice && a.position) {
      const [fx, fy, fz] = a.position
      cart = [
        fx * lattice.a[0] + fy * lattice.b[0] + fz * lattice.c[0],
        fx * lattice.a[1] + fy * lattice.b[1] + fz * lattice.c[1],
        fx * lattice.a[2] + fy * lattice.b[2] + fz * lattice.c[2],
      ]
    } else {
      cart = (a.position ?? [0, 0, 0]) as [number, number, number]
    }
    lines.push(`${a.element} ${cart[0].toFixed(6)} ${cart[1].toFixed(6)} ${cart[2].toFixed(6)}`)
  }
  return lines.join('\n')
}

type Step = 1 | 2 | 3
type CutMethod = 'miller' | 'three-atoms'
type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

interface BuildSlabInvokeResponse {
  atoms: { element: number; x: number; y: number; z: number }[]
  latticeMatrix: number[][]
  label?: string
}

function getSlabBuilderBackend(): Pick<BackendService, 'invokeComputeBuilder'> {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error('BackendService unavailable for slab builder')
  }
  return backend
}

export function SlabBuilder() {
  // Cut creates a Miller surface from the loaded periodic bulk.
  // From scratch asks the backend to build a slab from element and lattice inputs.
  // The two paths are mutually exclusive; Cut requires periodic bulk.
  // From scratch can replace an empty or populated scene.
  const atoms = useCrystalStore((s) => s.atoms)
  const periodic = useCrystalStore((s) => s.periodic)
  const hasBulkLoaded = periodic && atoms && atoms.length > 0
  const hasBackend = getGlobalBackendClient() !== null
  const [mode, setMode] = useState<'cut' | 'from-scratch'>(hasBulkLoaded || !hasBackend ? 'cut' : 'from-scratch')

  // Axis-menu cleave requests use Cut and are cleared after consumption.
  const axisCleaveRequest = useCrystalStore((s) => s.axisCleaveRequest)
  useEffect(() => {
    if (axisCleaveRequest && hasBulkLoaded) setMode('cut')
  }, [axisCleaveRequest, hasBulkLoaded])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Mode tabs */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => { setMode('cut');  }}
          disabled={!hasBulkLoaded}
          title={hasBulkLoaded ? 'Cleave Miller surface from the loaded bulk' : 'Load a bulk crystal first to enable surface cleavage'}
          data-selected={mode === 'cut'}
          className="zatom-choice zatom-pressable flex-1 rounded py-1.5 text-[11px] font-medium"
        >
          Cut from bulk
        </button>
        {hasBackend && (
          <button
            onClick={() => { setMode('from-scratch');  }}
            data-selected={mode === 'from-scratch'}
            className="zatom-choice zatom-pressable flex-1 rounded py-1.5 text-[11px] font-medium"
          >
            From scratch
          </button>
        )}
      </div>

      {mode === 'cut' ? (
        <>
          {hasBulkLoaded ? (
            <>
              <CutWizard />
              <PassivateSection />
            </>
          ) : (
            <div className="rounded-lg p-3 text-[11px]" style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}>
              Load a periodic bulk structure before cutting a slab.
            </div>
          )}
        </>
      ) : (
        <FromScratchSection />
      )}
    </div>
  )
}

// ── 3-step wizard ──────────────────────────────────────────────────────────

function CutWizard() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[] | null
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  // Wizard state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [method, setMethod] = useState<CutMethod>('miller')
  // Step 1 — Miller
  const [h, setH] = useState('1')
  const [k, setK] = useState('1')
  const [l, setL] = useState('1')

  // Prefill Miller values from an axis-menu cleave request, then clear it.
  const axisCleaveRequest = useCrystalStore((s) => s.axisCleaveRequest)
  useEffect(() => {
    if (!axisCleaveRequest) return
    setMethod('miller')
    setStep(1)
    setH(String(axisCleaveRequest.h))
    setK(String(axisCleaveRequest.k))
    setL(String(axisCleaveRequest.l))
    useCrystalStore.getState().clearAxisCleaveRequest()
  }, [axisCleaveRequest])
  const [reverse, setReverse] = useState(false)
  // Step 1 — 3-atom
  const [keepSide, setKeepSide] = useState<'positive' | 'negative'>('positive')
  // Step 2
  const [layers, setLayers] = useState('4')
  const [vacuum, setVacuum] = useState('10')
  const [centerInCell, setCenterInCell] = useState(true)
  // Step 3 preview + final status
  const [preview, setPreview] = useState<BuilderResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [generateStatus, setGenerateStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [generated, setGenerated] = useState(false)  // After generation, replace the wizard with the done card.

  // Snapshot of the structure as it was before entering step 3. Used to restore
  // the scene on Back / unmount when a 3D preview is active. We freeze the
  // snapshot in a ref so re-renders triggered by loadFromXYZ (during preview)
  // don't overwrite it with the new (preview) atoms.
  const snapshotXyzRef = useRef<string | null>(null)
  const previewActiveRef = useRef(false)

  // Derived ─────────────────────────────────────────────────────────────
  const hN = parseInt(h) || 0
  const kN = parseInt(k) || 0
  const lN = parseInt(l) || 0
  const layersN = Math.max(1, Math.min(20, parseInt(layers) || 4))
  const vacuumN = Math.max(5, Math.min(30, parseFloat(vacuum) || 10))
  const millerValid = !(hN === 0 && kN === 0 && lN === 0)
  const threeAtomValid = selectedAtomIds.size >= 3

  const dSpacing = useMemo(() => {
    if (method !== 'miller' || !latticeVectors || !millerValid) return null
    const mat: Mat3 = [latticeVectors.a, latticeVectors.b, latticeVectors.c]
    return interplanarSpacing(mat, hN, kN, lN)
  }, [method, latticeVectors, millerValid, hN, kN, lN])

  const canAdvanceFromStep1 = !!latticeVectors && (method === 'miller' ? millerValid : threeAtomValid)

  // Step 3 preview: run the actual builder against the SNAPSHOT (or, if no
  // snapshot yet, the current scene). The result is the slab we'd commit.
  // We use a ref to avoid re-running when atoms change due to our own preview
  // load (otherwise we'd recursively rebuild the slab from the slab).
  const previewInputAtoms = useMemo(() => {
    // Once a preview is active, the store's `atoms` are the SLAB, not the
    // original. We must build off the snapshot instead. Parse the snapshot
    // back to atoms+lattice for this purpose? Simpler: capture original atoms
    // + lattice on step 1/2 → use those for step 3 compute.
    return atoms
  }, [atoms])

  useEffect(() => {
    if (step !== 3) return
    if (previewActiveRef.current) return  // already previewing; don't recompute from slab
    setPreviewError(null)
    setPreview(null)
    if (!latticeVectors || !previewInputAtoms) {
      setPreviewError('No structure loaded')
      return
    }
    const lattice: Mat3 = [latticeVectors.a, latticeVectors.b, latticeVectors.c]
    const atomInputs = previewInputAtoms.map((a) => ({
      element: a.element,
      cartesian: (a.cartesian ?? a.position) as Vec3,
    }))
    try {
      let result: BuilderResult
      if (method === 'miller') {
        result = buildSlabFromMiller({
          lattice,
          atoms: atomInputs,
          h: hN, k: kN, l: lN,
          layers: layersN,
          vacuum: vacuumN,
          reverse,
          center: centerInCell,
        })
      } else {
        const ids = Array.from(selectedAtomIds).slice(0, 3)
        const pts = ids.map((id) => previewInputAtoms.find((a) => a.id === id))
        if (pts.some((p) => !p)) throw new Error('Selected atoms not found')
        const c = pts.map((p) => (p!.cartesian ?? p!.position) as Vec3)
        const v1: Vec3 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]]
        const v2: Vec3 = [c[2][0] - c[0][0], c[2][1] - c[0][1], c[2][2] - c[0][2]]
        const normal: Vec3 = [
          v1[1] * v2[2] - v1[2] * v2[1],
          v1[2] * v2[0] - v1[0] * v2[2],
          v1[0] * v2[1] - v1[1] * v2[0],
        ]
        if (Math.hypot(...normal) < 1e-6) throw new Error('Selected atoms are collinear')
        result = buildSlabFromPlane({
          lattice,
          atoms: atomInputs,
          normal,
          point_on_plane: c[0],
          keep_side: keepSide,
          vacuum: vacuumN,
          center: centerInCell,
        })
      }
      setPreview(result)
      // Load the 3D preview after saving a snapshot that Back can restore.
      if (!snapshotXyzRef.current) {
        snapshotXyzRef.current = serializeToXyz(previewInputAtoms, latticeVectors)
      }
      previewActiveRef.current = true
      // fire-and-forget; failure doesn't block UI (still have text summary)
      void loadFromXYZ(result.xyz, { documentMode: 'preview' }).then((r) => {
        if (r.success) setPeriodic(true)
      })
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, method, hN, kN, lN, layersN, vacuumN, reverse, centerInCell, keepSide])

  // Restore original scene when leaving step 3 without committing.
  const restoreSnapshot = async () => {
    const xyz = snapshotXyzRef.current
    if (!xyz) return
    snapshotXyzRef.current = null
    previewActiveRef.current = false
    await loadFromXYZ(xyz, { documentMode: 'preview' })
    if (latticeVectors) setPeriodic(true)
  }

  // Unmount or wizard reset → restore if a preview is still pending commit.
  useEffect(() => {
    return () => {
      if (snapshotXyzRef.current && previewActiveRef.current) {
        const xyz = snapshotXyzRef.current
        snapshotXyzRef.current = null
        previewActiveRef.current = false
        void loadFromXYZ(xyz, { documentMode: 'preview' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actions ─────────────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 1 && canAdvanceFromStep1) { setStep(2);  }
    else if (step === 2) { setStep(3);  }
  }
  const goBack = async () => {
    if (step === 2) { setStep(1);  }
    else if (step === 3) {
      // Restore original structure before going back to slab params.
      await restoreSnapshot()
      setStep(2); 
    }
  }
  const reset = async () => {
    if (snapshotXyzRef.current && previewActiveRef.current) {
      await restoreSnapshot()
    }
    setStep(1)
    setGenerateStatus(null)
    setPreview(null)
    setPreviewError(null)
    setGenerated(false)
  }
  /** Generate = "confirm" the preview. The slab is already loaded as preview;
   *  we just lock state and clear the snapshot so Back won't restore. */
  const handleGenerate = () => {
    if (!preview) return
    snapshotXyzRef.current = null
    previewActiveRef.current = false
    setGenerateStatus({ ok: true, message: preview.description })
    setGenerated(true)
  }

  // Render ──────────────────────────────────────────────────────────────
  if (!latticeVectors) {
    return (
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)' }}>
          Slab cutting requires a periodic structure (cell lattice).
        </p>
      </div>
    )
  }

  if (generated) {
    return (
      <div className="rounded-lg p-3"
           style={{ backgroundColor: SUCCESS_TONE.background, border: `1px solid ${SUCCESS_TONE.border}` }}>
        <div className="flex items-center gap-2 mb-1.5">
          <span aria-hidden className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold"
                style={{ backgroundColor: SUCCESS_TONE.foreground, color: 'var(--control-primary-text)' }}>✓</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--panel-text)' }}>Slab generated</span>
        </div>
        {generateStatus && (
          <p className="text-[10px] mb-2" style={{ color: 'var(--panel-text-secondary)' }}>
            {generateStatus.message}
          </p>
        )}
        <button
          onClick={reset}
          className="zatom-choice zatom-pressable w-full rounded px-2.5 py-1.5 text-[11px] font-medium"
        >
          Cut another slab
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg p-3 flex flex-col gap-3"
         style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      {/* Workflow header */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--panel-text)', fontWeight: 500, marginBottom: 2 }}>Cut into slab</div>
        <p style={{ fontSize: 10, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
          Three-step wizard: define the cut, set thickness &amp; vacuum, then generate the slab.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Step body */}
      {step === 1 && (
        <Step1Cut
          method={method} setMethod={setMethod}
          h={h} setH={setH} k={k} setK={setK} l={l} setL={setL}
          reverse={reverse} setReverse={setReverse}
          keepSide={keepSide} setKeepSide={setKeepSide}
          dSpacing={dSpacing}
          selectedAtomCount={selectedAtomIds.size}
        />
      )}
      {step === 2 && (
        <Step2Slab
          layers={layers} setLayers={setLayers}
          vacuum={vacuum} setVacuum={setVacuum}
          centerInCell={centerInCell} setCenterInCell={setCenterInCell}
        />
      )}
      {step === 3 && (
        <Step3Confirm
          method={method}
          h={hN} k={kN} l={lN} reverse={reverse} keepSide={keepSide}
          layers={layersN} vacuum={vacuumN} centerInCell={centerInCell}
          preview={preview} previewError={previewError}
          previewActive={previewActiveRef.current}
        />
      )}

      {/* Generate status (when on step 3 and tried) */}
      {generateStatus && !generateStatus.ok && (
        <div className="px-2 py-1.5 rounded text-[10px]"
             style={{ backgroundColor: ERROR_TONE.background, color: ERROR_TONE.foreground, border: `1px solid ${ERROR_TONE.border}` }}>
          {generateStatus.message}
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={goBack}
          disabled={step === 1}
          className="zatom-choice zatom-pressable rounded px-2.5 py-1.5 text-[11px] font-medium"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--panel-text-secondary)',
            border: '1px solid var(--panel-border)',
          }}
        >
          ← Back
        </button>
        <div className="flex-1" />
        {step < 3 && (
          <button
            onClick={goNext}
            disabled={step === 1 && !canAdvanceFromStep1}
            className="zatom-primary zatom-pressable rounded px-3 py-1.5 text-[11px] font-medium"
          >
            {step === 1
              ? (canAdvanceFromStep1 ? 'Next: thickness →' : (method === 'miller' ? 'Set indices' : `Select 3 atoms (${selectedAtomIds.size}/3)`))
              : 'Next: preview →'}
          </button>
        )}
        {step === 3 && (
          <button
            onClick={handleGenerate}
            disabled={!preview}
            className="zatom-primary zatom-pressable rounded px-3 py-1.5 text-[11px] font-semibold"
          >
            ✓ Confirm slab
          </button>
        )}
      </div>
    </div>
  )
}

// ── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const STEPS: { n: Step; label: string }[] = [
    { n: 1, label: 'Cut' },
    { n: 2, label: 'Slab' },
    { n: 3, label: 'Generate' },
  ]
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const isDone = s.n < current
        const isCurrent = s.n === current
        const dotBg = isDone || isCurrent ? 'var(--control-primary-bg)' : 'var(--panel-bg)'
        const dotBorder = isDone || isCurrent ? 'var(--control-primary-bg)' : 'var(--panel-border-focus)'
        const dotColor = isDone || isCurrent ? '#fff' : 'var(--panel-text-tertiary)'
        const labelColor = isCurrent ? 'var(--panel-text)' : 'var(--panel-text-tertiary)'
        return (
          <div key={s.n} className="flex items-center gap-1 flex-1 min-w-0">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold transition-colors"
              style={{ backgroundColor: dotBg, border: `1px solid ${dotBorder}`, color: dotColor }}
              aria-hidden
            >
              {isDone ? '✓' : s.n}
            </span>
            <span className="text-[10px] truncate" style={{ color: labelColor, fontWeight: isCurrent ? 500 : 400 }}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="text-[10px] shrink-0 mx-0.5" style={{ color: 'var(--panel-text-tertiary)' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1 · Cut definition ────────────────────────────────────────────────

function Step1Cut({
  method, setMethod,
  h, setH, k, setK, l, setL,
  reverse, setReverse,
  keepSide, setKeepSide,
  dSpacing,
  selectedAtomCount,
}: {
  method: CutMethod
  setMethod: (m: CutMethod) => void
  h: string; setH: (v: string) => void
  k: string; setK: (v: string) => void
  l: string; setL: (v: string) => void
  reverse: boolean; setReverse: (v: boolean) => void
  keepSide: 'positive' | 'negative'; setKeepSide: (v: 'positive' | 'negative') => void
  dSpacing: number | null
  selectedAtomCount: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)' }}>How to define the cut:</div>
      {/* Method tabs */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => { setMethod('miller');  }}
          data-selected={method === 'miller'}
          className="zatom-choice zatom-pressable flex-1 rounded py-1 text-[10px] font-medium"
        >
          Miller (h k l)
        </button>
        <button
          onClick={() => { setMethod('three-atoms');  }}
          data-selected={method === 'three-atoms'}
          className="zatom-choice zatom-pressable flex-1 rounded py-1 text-[10px] font-medium"
        >
          3 atoms
        </button>
      </div>

      {method === 'miller' && (
        <>
          <div className="flex items-center gap-1.5">
            {([['h', h, setH], ['k', k, setK], ['l', l, setL]] as const).map(([label, val, set]) => (
              <div key={label} className="flex-1">
                <label className="text-[9px] text-[var(--panel-text-tertiary)] block mb-1">{label}</label>
                <input
                  type="number"
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  className="zatom-field w-full rounded px-2 py-1 text-xs tabular-nums"
                />
              </div>
            ))}
          </div>

          {/* Reverse direction */}
          <button
            onClick={() => { setReverse(!reverse);  }}
            data-selected={reverse}
            className="zatom-choice zatom-pressable flex w-full items-center justify-between rounded px-2.5 py-1.5"
          >
            <div className="flex flex-col text-left">
              <span className="text-[10px] font-medium">Reverse cut direction</span>
              <span className="text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                Flip which side of (hkl) becomes the top
              </span>
            </div>
            <span className="text-[10px] font-mono">{reverse ? 'ON' : 'off'}</span>
          </button>

          {dSpacing && (
            <p className="text-[9px] font-mono" style={{ color: 'var(--panel-text-tertiary)' }}>
              d-spacing ≈ {dSpacing.toFixed(3)} Å (one (hkl) layer thickness)
            </p>
          )}
        </>
      )}

      {method === 'three-atoms' && (
        <>
          <p className="text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
            Selected: {selectedAtomCount}/3 atoms — pick 3 non-collinear atoms in the 3D viewport to define the cutting plane.
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setKeepSide('positive');  }}
              data-selected={keepSide === 'positive'}
              className="zatom-choice zatom-pressable flex-1 rounded py-1 text-[10px] font-medium"
            >
              Keep above
            </button>
            <button
              onClick={() => { setKeepSide('negative');  }}
              data-selected={keepSide === 'negative'}
              className="zatom-choice zatom-pressable flex-1 rounded py-1 text-[10px] font-medium"
            >
              Keep below
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Step 2 · Slab parameters ───────────────────────────────────────────────

function Step2Slab({
  layers, setLayers, vacuum, setVacuum, centerInCell, setCenterInCell,
}: {
  layers: string; setLayers: (v: string) => void
  vacuum: string; setVacuum: (v: string) => void
  centerInCell: boolean; setCenterInCell: (v: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <div className="flex-1">
          <label className="text-[9px] text-[var(--panel-text-tertiary)] block mb-1">Layers (1–20)</label>
          <input
            type="number"
            value={layers}
            min={1}
            max={20}
            onChange={(e) => setLayers(e.target.value)}
            className="zatom-field w-full rounded px-2 py-1 text-xs tabular-nums"
          />
          <p className="text-[9px] mt-1" style={{ color: 'var(--panel-text-tertiary)' }}>
            Out-of-plane repetitions of the unit-cell slab.
          </p>
        </div>
        <div className="flex-1">
          <label className="text-[9px] text-[var(--panel-text-tertiary)] block mb-1">Vacuum (Å)</label>
          <input
            type="number"
            value={vacuum}
            min={5}
            max={30}
            step={0.5}
            onChange={(e) => setVacuum(e.target.value)}
            className="zatom-field w-full rounded px-2 py-1 text-xs tabular-nums"
          />
          <p className="text-[9px] mt-1" style={{ color: 'var(--panel-text-tertiary)' }}>
            Empty padding above &amp; below the slab.
          </p>
        </div>
      </div>

      <button
        onClick={() => { setCenterInCell(!centerInCell);  }}
        data-selected={centerInCell}
        className="zatom-choice zatom-pressable flex w-full items-center justify-between rounded px-2.5 py-1.5"
      >
        <div className="flex flex-col text-left">
          <span className="text-[10px] font-medium">Center slab in cell</span>
          <span className="text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
            Vacuum split equally above and below (recommended for DFT)
          </span>
        </div>
        <span className="text-[10px] font-mono">{centerInCell ? 'ON' : 'off'}</span>
      </button>
    </div>
  )
}

// ── Step 3 · Preview + confirm ─────────────────────────────────────────────

function Step3Confirm({
  method,
  h, k, l, reverse, keepSide,
  layers, vacuum, centerInCell,
  preview, previewError, previewActive,
}: {
  method: CutMethod
  h: number; k: number; l: number
  reverse: boolean
  keepSide: 'positive' | 'negative'
  layers: number; vacuum: number; centerInCell: boolean
  preview: BuilderResult | null
  previewError: string | null
  previewActive: boolean
}) {
  const formula = preview?.composition ? formatHillFormula(preview.composition) : null
  const cp = preview?.cellParams
  const bbox = preview?.atomBBox

  // Sanity: check if atom bbox is way bigger than cell (warning sign).
  const bboxOutOfCell = useMemo(() => {
    if (!bbox || !cp) return false
    const span: [number, number, number] = [
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2],
    ]
    // Compare span to longest cell edge. If atom bbox exceeds 1.2× longest
    // cell vector, something is off.
    const maxEdge = Math.max(cp.aLen, cp.bLen, cp.cLen)
    const maxSpan = Math.max(...span)
    return maxSpan > maxEdge * 1.2
  }, [bbox, cp])

  return (
    <div className="flex flex-col gap-2">
      <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)', marginBottom: 2 }}>
        {previewActive
          ? 'Slab loaded into the 3D viewport — review, then confirm or go back.'
          : 'Review the cut, then confirm:'}
      </div>

      {/* Cut summary */}
      <div className="rounded p-2.5 flex flex-col gap-1"
           style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}>
        <SummaryRow k="Method" v={method === 'miller' ? `Miller (${h} ${k} ${l})` : '3-atom plane'} />
        {method === 'miller' && reverse && <SummaryRow k="Direction" v="reversed" />}
        {method === 'three-atoms' && <SummaryRow k="Keep side" v={keepSide === 'positive' ? 'above' : 'below'} />}
        <SummaryRow k="Layers" v={String(layers)} />
        <SummaryRow k="Vacuum" v={`${vacuum.toFixed(1)} Å`} />
        <SummaryRow k="Centered" v={centerInCell ? 'yes' : 'no (anchored at z=0)'} />
      </div>

      {/* Preview output */}
      {previewError && (
        <div className="px-2 py-1.5 rounded text-[10px]"
             style={{ backgroundColor: ERROR_TONE.background, color: ERROR_TONE.foreground, border: `1px solid ${ERROR_TONE.border}` }}>
          Preview failed: {previewError}
        </div>
      )}
      {preview && !previewError && (
        <>
          <div className="rounded p-2.5 flex flex-col gap-1"
               style={{ backgroundColor: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}>
            <SummaryRow k="Atoms" v={String(preview.n_atoms)} accent />
            {formula && <SummaryRow k="Formula" v={formula} accent mono />}
          </div>

          {/* Cell parameters of the resulting slab (sanity check). */}
          {cp && (
            <div className="rounded p-2.5 flex flex-col gap-1"
                 style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--panel-text-tertiary)' }}>Slab cell</div>
              <SummaryRow k="|a|" v={`${cp.aLen.toFixed(3)} Å`} mono />
              <SummaryRow k="|b|" v={`${cp.bLen.toFixed(3)} Å`} mono />
              <SummaryRow k="|c|" v={`${cp.cLen.toFixed(3)} Å`} mono />
              <SummaryRow k="α β γ" v={`${cp.alphaDeg.toFixed(1)}° ${cp.betaDeg.toFixed(1)}° ${cp.gammaDeg.toFixed(1)}°`} mono />
            </div>
          )}

          {/* Bounding box vs cell sanity warning */}
          {bboxOutOfCell && (
            <div className="px-2 py-1.5 rounded text-[10px]"
                 style={{ backgroundColor: WARNING_TONE.background, color: WARNING_TONE.foreground, border: `1px solid ${WARNING_TONE.border}` }}>
              ⚠ Atom bounding box larger than the slab cell — atoms may extend
              outside the cell box. Try different Miller indices or fewer layers.
            </div>
          )}
        </>
      )}
      {!preview && !previewError && (
        <p className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Computing preview…</p>
      )}
    </div>
  )
}

function SummaryRow({ k, v, accent, mono }: { k: string; v: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span style={{ color: accent ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)' }}>{k}</span>
      <span style={{
        color: accent ? 'var(--control-selected-text)' : 'var(--panel-text)',
        fontFamily: mono ? 'monospace' : 'inherit',
        fontWeight: accent ? 500 : 400,
      }}>
        {v}
      </span>
    </div>
  )
}

// ── Passivate (kept as standalone post-processing) ─────────────────────────

function PassivateSection() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [side, setSide] = useState<'top' | 'bottom' | 'both'>('both')
  const [surfaceTol, setSurfaceTol] = useState('0.5')
  const [bondCutoffFactor, setBondCutoffFactor] = useState('1.2')
  const [hBondLen, setHBondLen] = useState('1.0')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const surfaceTolN = Math.max(0.05, Math.min(2.0, parseFloat(surfaceTol) || 0.5))
  const bondCutoffN = Math.max(1.0, Math.min(2.0, parseFloat(bondCutoffFactor) || 1.2))
  const hBondLenN = Math.max(0.4, Math.min(2.0, parseFloat(hBondLen) || 1.0))
  const canRun = (atoms?.length ?? 0) > 0

  const handlePassivate = async () => {
    setStatus(null)
    if (!canRun) return
    try {
      const atomInputs = (atoms ?? []).map((a) => ({
        element: a.element,
        cartesian: (a.cartesian ?? a.position) as Vec3,
      }))
      const result = passivateSlab({
        atoms: atomInputs,
        lattice: latticeVectors
          ? [
              [...latticeVectors.a] as Vec3,
              [...latticeVectors.b] as Vec3,
              [...latticeVectors.c] as Vec3,
            ]
          : undefined,
        side,
        surface_tol: surfaceTolN,
        bond_cutoff_factor: bondCutoffN,
        pseudo_h_bond_length: hBondLenN,
      })
      const loadRes = await loadFromXYZ(result.xyz, { documentMode: 'edit' })
      if (loadRes.success) {
        if (latticeVectors) setPeriodic(true)
        setStatus({ ok: true, message: `${result.description} · +${result.added_count} pseudo-H` })
      } else {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>Passivate slab</div>
      <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', marginBottom: 8 }}>
        Add pseudo-H atoms to surface dangling bonds (Si / Ge / C / III-V semiconductor slabs).
        Run after generating a slab above.
      </p>

      <div className="flex gap-1 mb-2">
        {(['top', 'bottom', 'both'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s);  }}
            data-selected={side === s}
            className="zatom-choice zatom-pressable flex-1 rounded px-2 py-1 text-[10px] font-medium capitalize"
          >
            {s}
          </button>
        ))}
      </div>

      <PassivateRow label="Surf tol (Å)" value={surfaceTol} onChange={setSurfaceTol} step="0.05" />
      <PassivateRow label="Bond × Σr_cov" value={bondCutoffFactor} onChange={setBondCutoffFactor} step="0.05" />
      <PassivateRow label="H bond (Å)" value={hBondLen} onChange={setHBondLen} step="0.05" />

      <button
        onClick={handlePassivate}
        disabled={!canRun}
        className="zatom-primary zatom-pressable mt-2 w-full rounded py-1.5 text-[11px] font-medium"
      >
        {canRun ? `Passivate ${side}` : 'Load a slab first'}
      </button>

      {status && (
        <div
          className="mt-2 px-2 py-1.5 rounded text-[10px]"
          style={{
            backgroundColor: status.ok ? SUCCESS_TONE.background : ERROR_TONE.background,
            color: status.ok ? SUCCESS_TONE.foreground : ERROR_TONE.foreground,
            border: `1px solid ${status.ok ? SUCCESS_TONE.border : ERROR_TONE.border}`,
          }}
        >
          {status.message}
        </div>
      )}
    </div>
  )
}

function PassivateRow({ label, value, onChange, step }: {
  label: string
  value: string
  onChange: (v: string) => void
  step: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[10px] tabular-nums"
      />
    </div>
  )
}


// From-scratch panel.
// Build a slab through the ASE-backed builder.
// Load the generated extended XYZ as the new scene.

const ELEMENT_DEFAULTS: Record<string, { a: number; crystal: 'fcc' | 'bcc' }> = {
  Pt: { a: 3.9239, crystal: 'fcc' },
  Cu: { a: 3.615,  crystal: 'fcc' },
  Au: { a: 4.078,  crystal: 'fcc' },
  Ag: { a: 4.085,  crystal: 'fcc' },
  Ir: { a: 3.839,  crystal: 'fcc' },
  Pd: { a: 3.891,  crystal: 'fcc' },
  Ni: { a: 3.524,  crystal: 'fcc' },
  Rh: { a: 3.803,  crystal: 'fcc' },
  Al: { a: 4.050,  crystal: 'fcc' },
  Fe: { a: 2.866,  crystal: 'bcc' },
  W:  { a: 3.165,  crystal: 'bcc' },
  Mo: { a: 3.147,  crystal: 'bcc' },
}

const COMMON_MILLERS: { label: string; value: [number, number, number] }[] = [
  { label: '(111)', value: [1, 1, 1] },
  { label: '(100)', value: [1, 0, 0] },
  { label: '(110)', value: [1, 1, 0] },
]

function FromScratchSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)

  const [element, setElement] = useState<string>('Pt')
  const [crystalType, setCrystalType] = useState<'fcc' | 'bcc'>('fcc')
  const [latticeA, setLatticeA] = useState<number>(ELEMENT_DEFAULTS.Pt.a)
  const [miller, setMiller] = useState<[number, number, number]>([1, 1, 1])
  const [nA, setNA] = useState<number>(5)
  const [nB, setNB] = useState<number>(5)
  const [nLayers, setNLayers] = useState<number>(4)
  const [vacuum, setVacuum] = useState<number>(15)

  const [preview, setPreview] = useState<{ atoms: number; cell: [number, number, number] } | null>(null)
  const [building, setBuilding] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const buildSlabParams = useMemo(() => ({
    element,
    crystal_type: crystalType,
    lattice_a: latticeA,
    miller,
    n_a: nA,
    n_b: nB,
    n_layers: nLayers,
    vacuum,
  }), [element, crystalType, latticeA, miller, nA, nB, nLayers, vacuum])

  // Update default lattice and type when the element changes; users may override them.
  useEffect(() => {
    const d = ELEMENT_DEFAULTS[element]
    if (d) {
      setLatticeA(d.a)
      setCrystalType(d.crystal)
    }
  }, [element])

  // Debounce parameter previews by 300ms and request only atom and cell summaries.
  // The inspector is too narrow for a full 3D preview, so show a textual confirmation.
  // Write to the viewport only after Generate.
  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(async () => {
      setBuilding(true)
      setError(null)
      try {
        const data = await getSlabBuilderBackend().invokeComputeBuilder<BuildSlabInvokeResponse>(
          'build-slab',
          { params: buildSlabParams },
        )
        if (!cancelled && data?.latticeMatrix?.length === 3) {
          const lm = data.latticeMatrix
          setPreview({
            atoms: data.atoms.length,
            cell: [
              Math.hypot(lm[0][0], lm[0][1], lm[0][2]),
              Math.hypot(lm[1][0], lm[1][1], lm[1][2]),
              Math.hypot(lm[2][0], lm[2][1], lm[2][2]),
            ],
          })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBuilding(false)
      }
    }, 300)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [buildSlabParams])

  const handleGenerate = async () => {
    setApplying(true)
    setError(null)
    try {
      const data = await getSlabBuilderBackend().invokeComputeBuilder<BuildSlabInvokeResponse>(
        'build-slab',
        { params: buildSlabParams },
      )
      // Use extended XYZ so the standard loader handles the generated slab.
      // Use the complete shared periodic table rather than a narrow local map.
      const lat = data.latticeMatrix
      const latStr = [lat[0], lat[1], lat[2]].flat().map((v) => v.toFixed(6)).join(' ')
      const lines = [
        String(data.atoms.length),
        `Lattice="${latStr}" Properties=species:S:1:pos:R:3 ${data.label ? `label="${data.label}"` : ''}`,
        ...data.atoms.map((a) => `${atomicNumberToSymbol(a.element)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`),
      ]
      const xyz = lines.join('\n')
      await loadFromXYZ(xyz)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--panel-text-secondary)' }}>
        Generate a metal slab from scratch using ASE — no bulk required. Slab replaces the current viewport on Generate.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Param label="Element">
          <select
            value={element}
            onChange={(e) => setElement(e.target.value)}
            className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
          >
            {Object.keys(ELEMENT_DEFAULTS).map((el) => (
              <option key={el} value={el}>{el}</option>
            ))}
          </select>
        </Param>
        <Param label="Crystal">
          <select
            value={crystalType}
            onChange={(e) => setCrystalType(e.target.value as 'fcc' | 'bcc')}
            className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
          >
            <option value="fcc">fcc</option>
            <option value="bcc">bcc</option>
          </select>
        </Param>
      </div>

      <Param label="Lattice a (Å)">
        <input
          type="number" step={0.001} min={1.5} max={10} value={latticeA}
          onChange={(e) => setLatticeA(Math.max(1.5, Math.min(10, Number(e.target.value) || 3.9)))}
          className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
        />
      </Param>

      <Param label="Miller index">
        <div style={{ display: 'flex', gap: 4 }}>
          {COMMON_MILLERS.map((m) => {
            const active = miller[0] === m.value[0] && miller[1] === m.value[1] && miller[2] === m.value[2]
            return (
              <button
                key={m.label}
                onClick={() => setMiller(m.value)}
                data-selected={active}
                className="zatom-choice zatom-pressable flex-1 rounded px-1.5 py-1 font-mono text-[11px]"
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </Param>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <Param label="n_a">
          <input
            type="number" min={1} max={20} value={nA}
            onChange={(e) => setNA(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
            className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
          />
        </Param>
        <Param label="n_b">
          <input
            type="number" min={1} max={20} value={nB}
            onChange={(e) => setNB(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
            className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
          />
        </Param>
        <Param label="Layers">
          <input
            type="number" min={2} max={20} value={nLayers}
            onChange={(e) => setNLayers(Math.max(2, Math.min(20, parseInt(e.target.value) || 4)))}
            className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
          />
        </Param>
      </div>

      <Param label="Vacuum (Å)">
        <input
          type="number" step={0.5} min={5} max={50} value={vacuum}
          onChange={(e) => setVacuum(Math.max(5, Math.min(50, Number(e.target.value) || 15)))}
          className="zatom-field w-full rounded px-1.5 py-1 text-[11px]"
        />
      </Param>

      {preview && !error && (
        <div style={{
          padding: '6px 8px', borderRadius: 4,
          border: '1px solid var(--panel-border)',
          backgroundColor: 'var(--panel-elevated)',
          fontSize: 11, color: 'var(--panel-text-secondary)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{preview.atoms} atoms</span>
          <span>{preview.cell[0].toFixed(1)}×{preview.cell[1].toFixed(1)}×{preview.cell[2].toFixed(1)} Å</span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '6px 8px', borderRadius: 4,
          border: '1px solid #fca5a5',
          backgroundColor: '#fef2f2',
          fontSize: 11, color: '#dc2626',
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={applying || building}
        className="zatom-primary zatom-pressable rounded-md px-3 py-2 text-[12px] font-medium"
        style={{ cursor: applying || building ? 'wait' : 'pointer' }}
      >
        {applying ? 'Generating...' : `Generate ${element}(${miller.join('')}) slab`}
      </button>
    </div>
  )
}


function Param({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--panel-text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}
