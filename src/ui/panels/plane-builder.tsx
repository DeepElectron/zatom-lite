import { useEffect, useRef, useState } from "react"
import { useIsMobile } from "../../ui-kit/use-mobile"
import { shouldDisableGeometrySelection } from "../../lib/performance/adaptive-performance"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { FaceSelectionInfo } from "./face-selection-info"
import { Toggle, Segmented, SliderRow } from "./panel-ui"

/**
 * Virtual reference plane for 2D editing and geometry markers. It never cuts
 * atoms; define it from three non-collinear atoms or Miller indices.
 */
export function PlaneBuilder() {
  const isMobile = useIsMobile()
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectedEdgeIds = useCrystalStore((s) => s.selectedEdgeIds)
  const selectedFaceIds = useCrystalStore((s) => s.selectedFaceIds)
  const constructPlaneFromAtoms = useCrystalStore((s) => s.constructPlaneFromAtoms)
  const constructedPlane = useCrystalStore((s) => s.constructedPlane)
  const colorField = useCrystalStore((s) => s.molecularOrbital.colorField)
  const fieldSlice = useCrystalStore((s) => s.molecularOrbital.fieldSlice)
  const setFieldSlice = useCrystalStore((s) => s.setFieldSlice)
  const clearConstructedPlane = useCrystalStore((s) => s.clearConstructedPlane)
  const show2DPlaneView = useCrystalStore((s) => s.show2DPlaneView)
  const setShow2DPlaneView = useCrystalStore((s) => s.setShow2DPlaneView)
  const selectAtomsOnPlaneSide = useCrystalStore((s) => s.selectAtomsOnPlaneSide)
  const selectMode = useCrystalStore((s) => s.selectMode)
  const setSelectMode = useCrystalStore((s) => s.setSelectMode)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const setToolMode = useCrystalStore((s) => s.setToolMode)
  const setBoxSelectModeEnabled = useCrystalStore((s) => s.setBoxSelectModeEnabled)
  const stickyMultiSelect = useCrystalStore((s) => s.stickyMultiSelect)
  const setStickyMultiSelect = useCrystalStore((s) => s.setStickyMultiSelect)
  const clearSelection = useCrystalStore((s) => s.clearSelection)
  const atoms = useCrystalStore((s) => s.atoms)
  const geometryEnabled = !shouldDisableGeometrySelection((atoms ?? []).length, { mobileLike: isMobile })

  const selectedCount = selectedAtomIds.size
  const canBuild = selectedCount >= 3

  const selectedAtomLabels = Array.from(selectedAtomIds).slice(0, 3).map(id => {
    const atom = (atoms ?? []).find(a => a.id === id)
    return atom ? `${atom.element}` : '?'
  })

  const handleBuild = () => {
    if (!canBuild) return
    constructPlaneFromAtoms(Array.from(selectedAtomIds).slice(0, 3))
    // The pick step is over: leave sticky multi-select so later clicks in the
    // viewport behave normally again (single-select).
    setStickyMultiSelect(false)
  }

  // Pick mode = sticky multi-select, scoped to plain atom picking in the select
  // tool. Shift-click still works, but it is awkward on a trackpad and used to
  // be swallowed by the ad-hoc box drag, so this is the explicit affordance for
  // "click 3 atoms one after another".
  const togglePickMode = () => {
    if (stickyMultiSelect) {
      setStickyMultiSelect(false)
      return
    }
    // setSelectMode resets sticky + clears selections, so run it first.
    if (selectMode !== 'atom') setSelectMode('atom')
    setBoxSelectModeEnabled(false)
    if (toolMode !== 'select') setToolMode('select')
    setStickyMultiSelect(true)
  }

  // 3-step workflow state:
  // Step 1 defines a plane.
  // Step 2 inspects an existing plane and exposes 2D/reference actions.
  // Clear ends step 2 and returns to definition.
  const currentStep: 1 | 2 = constructedPlane ? 2 : 1

  // Scroll the active-plane card into view after a build.
  // Trigger only when constructedPlane.id changes.
  const activePlaneRef = useRef<HTMLDivElement | null>(null)
  const prevPlaneIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = constructedPlane?.id ?? null
    if (id && id !== prevPlaneIdRef.current) {
      activePlaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    prevPlaneIdRef.current = id
  }, [constructedPlane?.id])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Workflow progress and reset action. */}
      <PlaneWorkflowHeader currentStep={currentStep} />

      {/* Primary controls for the active plane. */}
      {constructedPlane && (
        <div
          ref={activePlaneRef}
          className="rounded-lg p-3"
          style={{
            backgroundColor: 'var(--control-selected-bg)',
            border: '1px solid var(--control-selected-border)',
          }}
        >
          {/* Header row: ✓ Active Plane + Clear */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold"
                style={{ backgroundColor: 'var(--control-primary-bg)', color: 'var(--control-primary-text)' }}
              >
                ✓
              </span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--panel-text)' }}>Active Plane</span>
            </div>
            <button
              onClick={() => { clearConstructedPlane();  }}
              className="px-2 py-1 rounded text-[10px] transition-colors"
              style={{ color: 'var(--panel-text-tertiary)' }}
              title="Clear plane and return to default 3D view"
            >
              Clear ✕
            </button>
          </div>
          <div className="text-[10px] font-mono mb-2" style={{ color: 'var(--panel-text-tertiary)' }}>
            Normal: [{constructedPlane.normal.map(n => n.toFixed(2)).join(', ')}]
          </div>

          {/* List non-destructive ways to use the reference plane. */}
          <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--panel-text-tertiary)' }}>
            Step 2 · Ways to use this plane
          </div>
          <div className="flex flex-col gap-1.5">
            {colorField && (
              <ActionRow
                label={fieldSlice.enabled ? 'Field map on' : 'Map attached field'}
                hint={`${colorField.sourceName ?? 'Attached cube'} · real sampled values`}
                active={fieldSlice.enabled}
                onClick={() => {
                  setFieldSlice({ enabled: !fieldSlice.enabled })
                }}
              />
            )}
            <ActionRow
              label={show2DPlaneView ? 'Close 2D View' : 'Open 2D View'}
              hint="2D workspace: draw molecules / edit atoms on the plane"
              active={show2DPlaneView}
              onClick={() => { setShow2DPlaneView(!show2DPlaneView);  }}
            />
            <ActionRow
              label="Select atoms on +side"
              hint="Mark atoms above the plane (for any next action)"
              onClick={() => { selectAtomsOnPlaneSide('positive');  }}
            />
            <ActionRow
              label="Select atoms on −side"
              hint="Mark atoms below the plane (for any next action)"
              onClick={() => { selectAtomsOnPlaneSide('negative');  }}
            />
          </div>
          <p className="text-[9px] mt-2 leading-snug" style={{ color: 'var(--panel-text-tertiary)' }}>
            The plane is a geometry reference — selecting a side doesn&apos;t modify
            atoms. Use the selection with edit / move / color / measure tools.
            For a real cut producing a slab, use the <strong>Slab</strong> module.
          </p>

          {/* Step 3 reminder */}
          <p className="text-[9px] mt-2 pt-2 leading-snug"
             style={{ color: 'var(--panel-text-tertiary)', borderTop: '1px solid var(--panel-accent-border)' }}>
            Step 3 · When done, click <strong>Clear ✕</strong> above to return to
            the default 3D view.
          </p>
        </div>
      )}

      {/* Cross-section clip —— moved here from the bottom bar; can clip along the
          defined plane's normal (combine) or a quick x/y/z axis. */}
      <ClipSection planeNormal={constructedPlane ? (constructedPlane.normal as [number, number, number]) : null} />

      {/* Face selection method (only when geometry selection available) */}
      {geometryEnabled && selectMode === 'face' && (
        <FaceSelectionInfo
          faceCount={selectedFaceIds.size}
          edgeCount={selectedEdgeIds.size}
          atomCount={selectedCount}
          embeddedInPlaneBuilder
        />
      )}

      {/* Collapse definition when a plane exists; expanding reveals both methods. */}
      <DefineSection
        defaultOpen={!constructedPlane}
        hasActive={!!constructedPlane}
      >
        <p className="text-[10px] leading-snug" style={{ color: 'var(--panel-text-tertiary)' }}>
          Pick one of the two methods below. Both produce a virtual reference
          plane — atoms are not modified.
        </p>

        {/* Method A: 3 atoms */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--panel-text)', marginBottom: 4, fontWeight: 500 }}>
            A · Build from 3 Atoms
          </div>
          <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
            {geometryEnabled
              ? 'Use face selection above or pick 3 atoms in the viewport.'
              : 'Pick 3 atoms in the viewport to define a plane for 2D editing.'}
          </p>
        </div>

        {/* Multi-pick affordance —— without it the only way to collect 3 atoms is
            Shift-click, which is easy to miss and awkward on a trackpad. */}
        <div>
          <button
            onClick={togglePickMode}
            aria-pressed={stickyMultiSelect}
            className={`zatom-pressable flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left ${stickyMultiSelect ? 'zatom-primary' : 'zatom-choice'}`}
          >
            <span className="text-[11px] font-medium">
              {stickyMultiSelect ? `Picking atoms · ${selectedCount}/3` : 'Pick multiple atoms'}
            </span>
            <span className="text-[10px] opacity-70">{stickyMultiSelect ? 'On' : 'Off'}</span>
          </button>
          <p className="mt-1 text-[9px] leading-snug" style={{ color: 'var(--panel-text-tertiary)' }}>
            {stickyMultiSelect
              ? 'Every atom click adds to the selection (click again to remove). Shift is not needed.'
              : 'Turn on to add atoms with plain clicks, or hold Shift while clicking atoms.'}
          </p>
          {selectedCount > 0 && (
            <button
              onClick={() => { clearSelection();  }}
              className="mt-1 text-[10px] underline"
              style={{ color: 'var(--panel-text-tertiary)' }}
            >
              Clear picked atoms
            </button>
          )}
        </div>

        {/* Selected atoms indicator */}
        <div className="flex items-center gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex-1 py-2 rounded-lg text-center text-[11px] font-medium"
              style={{
                backgroundColor: i < selectedCount ? 'var(--control-selected-bg)' : 'var(--panel-elevated)',
                color: i < selectedCount ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)',
                border: `1px solid ${i < selectedCount ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
              }}
            >
              {i < selectedCount ? selectedAtomLabels[i] : `Atom ${i + 1}`}
            </div>
          ))}
        </div>

        {/* Build button */}
        <button
          onClick={handleBuild}
          disabled={!canBuild}
          className="zatom-primary zatom-pressable w-full rounded-lg py-2.5 text-[12px] font-medium"
        >
          {canBuild ? 'Build Plane from 3 Atoms' : `Select ${3 - selectedCount} more atom${3 - selectedCount > 1 ? 's' : ''}`}
        </button>

        {/* Method B: Miller (hkl) */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--panel-text)', marginBottom: 4, fontWeight: 500 }}>
            B · From Miller Indices
          </div>
        </div>
        <MillerPlaneSection />
      </DefineSection>
    </div>
  )
}

/** Collapse to one action when a plane is active. */
function DefineSection({ defaultOpen, hasActive, children }: {
  defaultOpen: boolean
  hasActive: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Reset expansion when active-plane state changes.
  useEffect(() => { setOpen(!hasActive) }, [hasActive])

  if (!open && hasActive) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-1.5 rounded text-[10px] transition-colors text-left px-2.5 flex items-center justify-between"
        style={{
          backgroundColor: 'transparent',
          color: 'var(--panel-text-tertiary)',
          border: '1px dashed var(--panel-border)',
        }}
      >
        <span>Build a different plane?</span>
        <span aria-hidden>›</span>
      </button>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--panel-text-tertiary)' }}>
          Step 1 · Define the plane
        </span>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--panel-border)' }} />
        {hasActive && (
          <button
            onClick={() => setOpen(false)}
            className="text-[9px] transition-colors"
            style={{ color: 'var(--panel-text-tertiary)' }}
          >
            collapse
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </>
  )
}

/** Cross-section clip control. Clips the 3D view along the defined plane's
 *  normal (when one exists) or a quick x/y/z axis; offset pushes it in/out. */
function ClipSection({ planeNormal }: { planeNormal: [number, number, number] | null }) {
  const enabled = useCrystalStore((s) => s.clippingEnabled)
  const axis = useCrystalStore((s) => s.clippingAxis)
  const offset = useCrystalStore((s) => s.clippingOffset)
  const normal = useCrystalStore((s) => s.clippingNormal)
  const setEnabled = useCrystalStore((s) => s.setClippingEnabled)
  const setAxis = useCrystalStore((s) => s.setClippingAxis)
  const setOffset = useCrystalStore((s) => s.setClippingOffset)
  const setNormal = useCrystalStore((s) => s.setClippingNormal)

  const value = normal ? 'Plane' : axis.toUpperCase()
  const options = planeNormal ? ['Plane', 'X', 'Y', 'Z'] : ['X', 'Y', 'Z']

  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      <label className="flex items-center justify-between cursor-pointer">
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--panel-text)' }}>Cross-section (Clip)</span>
        <Toggle checked={enabled} onChange={(v) => { setEnabled(v);  }} />
      </label>
      {enabled && (
        <div className="flex flex-col gap-2.5 mt-2.5">
          <Segmented
            options={options}
            value={value}
            onChange={(v) => {
              if (v === 'Plane' && planeNormal) setNormal(planeNormal)
              else setAxis(v.toLowerCase() as 'x' | 'y' | 'z')
            }}
          />
          <SliderRow
            label="Offset" value={offset} min={-30} max={30} step={0.5}
            display={`${offset.toFixed(1)} Å`} onChange={setOffset}
          />
          <p className="text-[9px] leading-snug" style={{ color: 'var(--panel-text-tertiary)' }}>
            {normal
              ? 'Cutting along the defined plane normal.'
              : `Cutting along the ${axis.toUpperCase()} axis. Define a plane above to clip along (hkl).`}
          </p>
        </div>
      )}
    </div>
  )
}

/** Clickable action row with label, hint, and accent-filled active state. */
function ActionRow({ label, hint, active, onClick }: {
  label: string
  hint: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="zatom-choice zatom-pressable flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left"
      data-selected={active}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] font-medium truncate">{label}</span>
        <span className="truncate text-[9px]" style={{ color: active ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)' }}>
          {hint}
        </span>
      </div>
      <span aria-hidden className="text-[11px] opacity-60 shrink-0">›</span>
    </button>
  )
}

// ── Workflow header ─────────────────────────────────────────────────────────

/** Inspector top header: explains the 3-step plane workflow and shows current step.
 *  Renders even before any plane is built — that's the value (orientation). */
function PlaneWorkflowHeader({ currentStep }: { currentStep: 1 | 2 }) {
  const STEPS = [
    { n: 1, label: 'Define', hint: '3 atoms / Miller (hkl)' },
    { n: 2, label: 'Use', hint: '2D edit · select · measure' },
    { n: 3, label: 'Clear', hint: 'back to default view' },
  ] as const

  return (
    <div
      className="rounded-lg p-3"
      style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
    >
      <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 2, fontWeight: 500 }}>
        Reference Plane
      </div>
      <p style={{ fontSize: 10, color: 'var(--panel-text-tertiary)', lineHeight: 1.5, marginBottom: 10 }}>
        A geometric reference plane in 3D space. Use it as a <strong>2D editing
        workspace</strong>, a <strong>two-side selection boundary</strong>, or a
        slice template for the Slab tool. The plane itself doesn&apos;t modify
        atoms.
      </p>
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          // Step 1 active when currentStep===1; step 2 active when ===2;
          // Step 3 (Clear) only highlights while step 2 is active (because that
          // button is the way to reach step 3). Done steps get a checked look.
          const isDone = s.n < currentStep
          const isActive = s.n === currentStep || (s.n === 3 && currentStep === 2)
          // Step 3 is more "available action" than "active state" when at step 2,
          // so we keep it visually softer than the truly-active current step.
          const isCurrent = s.n === currentStep
          const dotBg = isDone
            ? 'var(--control-primary-bg)'
            : isCurrent
              ? 'var(--control-primary-bg)'
              : 'var(--panel-bg)'
          const dotBorder = isCurrent || isDone
            ? 'var(--control-selected-border)'
            : 'var(--panel-border-focus)'
          const dotColor = isDone || isCurrent ? '#fff' : 'var(--panel-text-tertiary)'
          const labelColor = isCurrent ? 'var(--panel-text)' : (isActive ? 'var(--panel-text-secondary)' : 'var(--panel-text-tertiary)')
          return (
            <div key={s.n} className="flex items-center gap-1 flex-1 min-w-0">
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold transition-colors duration-[160ms]"
                style={{ backgroundColor: dotBg, border: `1px solid ${dotBorder}`, color: dotColor }}
                aria-hidden
              >
                {isDone ? '✓' : s.n}
              </span>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[10px] truncate" style={{ color: labelColor, fontWeight: isCurrent ? 500 : 400 }}>
                  {s.label}
                </span>
                <span className="text-[8px] truncate" style={{ color: 'var(--panel-text-tertiary)' }}>
                  {s.hint}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="text-[10px] mx-0.5" style={{ color: 'var(--panel-text-tertiary)' }}>›</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MillerPlaneSection() {
  const constructPlaneFromMiller = useCrystalStore((s) => s.constructPlaneFromMiller) as (
    h: number, k: number, l: number, anchor?: [number, number, number],
  ) => void
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodic = useCrystalStore((s) => s.periodic)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const atoms = useCrystalStore((s) => s.atoms)
  const [h, setH] = useState('1')
  const [k, setK] = useState('0')
  const [l, setL] = useState('0')
  const hN = Number(h)
  const kN = Number(k)
  const lN = Number(l)
  const integerIndices = [hN, kN, lN].every(Number.isInteger)
  const valid = periodic && !!latticeVectors && integerIndices && !(hN === 0 && kN === 0 && lN === 0)

  // Use one selected atom, the centroid of three, or cell center as the anchor.
  // Changing the anchor translates within the same hkl family without changing orientation.
  const selectedAtomList = (atoms ?? []).filter((a) => selectedAtomIds.has(a.id))
  const cartOf = (a: typeof selectedAtomList[number]): [number, number, number] | null => {
    const v = a.cartesian ?? a.position
    return v ? [v[0], v[1], v[2]] : null
  }
  let anchor: [number, number, number] | undefined
  let anchorLabel = 'cell center'
  if (selectedAtomList.length === 1) {
    const c = cartOf(selectedAtomList[0])
    if (c) { anchor = c; anchorLabel = `atom ${selectedAtomList[0].element}` }
  } else if (selectedAtomList.length >= 3) {
    const c1 = cartOf(selectedAtomList[0]), c2 = cartOf(selectedAtomList[1]), c3 = cartOf(selectedAtomList[2])
    if (c1 && c2 && c3) {
      anchor = [
        (c1[0] + c2[0] + c3[0]) / 3,
        (c1[1] + c2[1] + c3[1]) / 3,
        (c1[2] + c2[2] + c3[2]) / 3,
      ]
      anchorLabel = '3-atom centroid'
    }
  }

  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>From Miller Indices</div>
      <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', marginBottom: 8 }}>
        (h k l) plane, normal = h·b₁ + k·b₂ + l·b₃ (reciprocal lattice vectors)
      </p>
      <div className="flex items-center gap-1.5 mb-2">
        {([['h', h, setH], ['k', k, setK], ['l', l, setL]] as const).map(([label, val, set]) => (
          <div key={label} className="flex-1">
            <label className="text-[9px] text-[var(--panel-text-tertiary)] block mb-1">{label}</label>
            <input
              type="number"
              value={val}
              onChange={(e) => set(e.target.value)}
              step={1}
              min={-99}
              max={99}
              className="zatom-field w-full rounded px-2 py-1 text-xs tabular-nums"
            />
          </div>
        ))}
      </div>
      {/* Show the live anchor choice so atom selection effects are explicit. */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[9px] text-[var(--panel-text-tertiary)]">Anchor:</span>
        <span className="text-[9px]" style={{
          color: anchor ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)',
          fontFamily: 'monospace',
        }}>
          {anchorLabel}
        </span>
      </div>
      <button
        onClick={() => { if (valid) { constructPlaneFromMiller(hN, kN, lN, anchor);  } }}
        disabled={!valid}
        className="zatom-primary zatom-pressable w-full rounded py-1.5 text-[11px] font-medium"
      >
        {!periodic ? 'Miller planes require a periodic cell' : !integerIndices ? 'Miller indices must be integers' : valid ? `Build (${hN} ${kN} ${lN})` : 'Need at least one nonzero index'}
      </button>
      <p className="text-[9px] text-[var(--panel-text-tertiary)] mt-1.5 leading-snug">
        Select 1 atom → plane through that atom · 3 atoms → through centroid · none → cell center.
      </p>
    </div>
  )
}
