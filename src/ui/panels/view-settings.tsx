import { useState } from "react"
import { AlertTriangle, CheckCircle2, Crosshair } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useIsMobile } from "../../ui-kit/use-mobile"
import { getAdaptivePerformanceLabel, isMassiveScene, isVeryLargeScene } from "../../lib/performance/adaptive-performance"
import { RangeSliderRow, Segmented, SliderRow, Toggle, ToggleRow } from "./panel-ui"
import { CELL_OVERFLOW_OPTIONS } from "./cell-overflow-options"

import { PANEL_STATUS_TONES } from "./panel-status"
import {
  PTM_ORDERING_LABELS,
  PTM_ORDERING_ORDER,
  PTM_STRUCTURE_COLORS,
  PTM_STRUCTURE_LABELS,
  PTM_STRUCTURE_ORDER,
} from "../../orchestration/slices/atom-attributes-slice"
import type { GeometrySnapTargets } from "../../orchestration/slices/view-settings-slice"

// Match geometry-snap-pick priority: atom center, intersection, division, extension.
const SNAP_TARGET_ITEMS: ReadonlyArray<{
  key: keyof GeometrySnapTargets
  label: string
  hint: string
}> = [
  { key: "atomCenter", label: "Atom centers", hint: "Snap to the centre of an existing atom (highest priority)" },
  { key: "intersection", label: "Intersections", hint: "Snap to the 3D intersection of two bond / lattice lines" },
  { key: "division", label: "Division points", hint: "Snap to midpoints, thirds and quarters along a line" },
  { key: "extension", label: "Extension lines", hint: "Snap to endpoints, extension points and anywhere along a line" },
]

type PerformanceRenderMode = "detailed" | "fast" | "ultra" | "massive" | "very-large"

const PERFORMANCE_MODE_META: Record<PerformanceRenderMode, {
  label: string
  color: string
  background: string
  border: string
}> = {
  detailed: {
    label: "Detailed",
    color: "var(--status-neutral)",
    background: "var(--status-neutral-bg)",
    border: "var(--status-neutral-border)",
  },
  fast: {
    label: "Fast (Instanced)",
    color: "var(--status-amber)",
    background: "var(--status-amber-bg)",
    border: "var(--status-amber-border)",
  },
  massive: {
    label: "Massive Scene",
    color: "var(--status-amber)",
    background: "var(--status-amber-bg)",
    border: "var(--status-amber-border)",
  },
  "very-large": {
    label: "Very Large Scene",
    color: "var(--status-red)",
    background: "var(--status-red-bg)",
    border: "var(--status-red-border)",
  },
  ultra: {
    label: "Solid Box",
    color: "var(--status-red)",
    background: "var(--status-red-bg)",
    border: "var(--status-red-border)",
  },
}

function LargeSceneThresholdSlider() {
  const massive = useCrystalStore((s) => s.massiveSceneThreshold)
  const veryLarge = useCrystalStore((s) => s.veryLargeSceneThreshold)
  const setMassive = useCrystalStore((s) => s.setMassiveSceneThreshold)
  const setVeryLarge = useCrystalStore((s) => s.setVeryLargeSceneThreshold)
  const atoms = useCrystalStore((s) => s.atoms)
  const min = 5000
  const max = 100000
  const step = 1000

  return (
    <div>
      <RangeSliderRow
        label="Scene Thresholds"
        min={min}
        max={max}
        step={step}
        value={[massive, veryLarge]}
        display={(value) => `${Math.round(value / 1000)}K`}
        minLabel="Massive"
        maxLabel="Very large"
        onChange={([nextMassive, nextVeryLarge]) => {
          const constrainedMassive = Math.min(nextMassive, nextVeryLarge - step)
          const constrainedVeryLarge = Math.max(nextVeryLarge, constrainedMassive + step)
          setMassive(constrainedMassive)
          setVeryLarge(constrainedVeryLarge)
        }}
      />
      <p className="mt-1 text-[11px] text-[var(--panel-text-secondary)]">
        Current scene: {atoms.length.toLocaleString()} atoms
      </p>
    </div>
  )
}

function SolidBoxToggle() {
  const solidBoxManual = useCrystalStore((s) => s.solidBoxManual)
  const setSolidBoxManual = useCrystalStore((s) => s.setSolidBoxManual)

  return (
    <ToggleRow
      label="Solid Box Mode"
      description="Replace atoms with a bounding volume"
      checked={solidBoxManual}
      onChange={setSolidBoxManual}
    />
  )
}

/** Region solids for explicit polycrystal grains and labeled trajectory phases. */
function RegionViewSection() {
  const showRegionSolids = useCrystalStore((s) => s.showRegionSolids)
  const hideAtomsInRegionView = useCrystalStore((s) => s.hideAtomsInRegionView)
  const regionOpacity = useCrystalStore((s) => s.regionOpacity)
  const setShowRegionSolids = useCrystalStore((s) => s.setShowRegionSolids)
  const setHideAtomsInRegionView = useCrystalStore((s) => s.setHideAtomsInRegionView)
  const setRegionOpacity = useCrystalStore((s) => s.setRegionOpacity)

  return (
    <div className="mt-3 space-y-3">
      <ToggleRow
        label="Region Solids"
        description="Show grains and labeled phases as translucent hulls"
        checked={showRegionSolids}
        onChange={setShowRegionSolids}
      />
      {showRegionSolids && (
        <div className="space-y-3 border-l border-[var(--panel-border)] pl-3">
          <ToggleRow
            label="Hide Atoms"
            description="Display regions without atom geometry"
            checked={hideAtomsInRegionView}
            onChange={setHideAtomsInRegionView}
          />
          <SliderRow
            label="Region Opacity"
            value={regionOpacity}
            min={0.1}
            max={0.9}
            step={0.05}
            display={`${Math.round(regionOpacity * 100)}%`}
            onChange={setRegionOpacity}
          />
        </div>
      )}
    </div>
  )
}

function DomainWallReviewSection({ review }: { review: Record<string, unknown> | null }) {
  if (!review) return null

  const checks = review.checks && typeof review.checks === 'object'
    ? review.checks as Record<string, Record<string, unknown>>
    : {}
  const rows = [
    ['Composition', checks.composition],
    ['Interface', checks.interfacePosition],
    ['Polarity', checks.polarity],
    ['Pseudo-H', checks.passivation],
  ] as const
  const summary = typeof review.summaryStatus === 'string' ? review.summaryStatus : 'unknown'
  const tone = summary === 'pass'
    ? PANEL_STATUS_TONES.success
    : summary === 'fail'
      ? PANEL_STATUS_TONES.error
      : PANEL_STATUS_TONES.warning

  return (
    <div className="pt-3 mt-3 border-t border-[var(--glass-border-subtle)]">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-[var(--text-secondary)] block font-medium">
          Domain Wall Review
        </label>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] uppercase"
          style={{ color: tone.foreground, backgroundColor: tone.background, border: `1px solid ${tone.border}` }}
        >
          {summary}
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map(([label, check]) => {
          const status = typeof check?.status === 'string' ? check.status : 'unknown'
          const statusTone = status === 'pass'
            ? PANEL_STATUS_TONES.success
            : status === 'fail'
              ? PANEL_STATUS_TONES.error
              : PANEL_STATUS_TONES.warning
          return (
            <div key={label} className="flex items-center justify-between rounded-md px-2 py-1" style={{ backgroundColor: 'var(--panel-elevated)' }}>
              <span className="text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>{label}</span>
              <span className="text-[10px] uppercase" style={{ color: statusTone.foreground }}>{status}</span>
            </div>
          )
        })}
      </div>
      {Boolean(checks.composition?.actual && typeof checks.composition.actual === 'object') && (
        <div className="mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          Composition: {Object.entries(checks.composition.actual as Record<string, number>).map(([key, value]) => `${key}${value}`).join(' ')}
        </div>
      )}
      {checks.polarity && (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          Polarity: {String(checks.polarity.lowerSign ?? '?')} / {String(checks.polarity.upperSign ?? '?')}
        </div>
      )}
    </div>
  )
}

export function ViewSettings() {
  const isMobile = useIsMobile()
  const autoFocusOnAtom = useCrystalStore((s) => s.autoFocusOnAtom)
  const hoverHintsEnabled = useCrystalStore((s) => s.hoverHintsEnabled)
  const geometrySnapEnabled = useCrystalStore((s) => s.geometrySnapEnabled)
  const geometrySnapTargets = useCrystalStore((s) => s.geometrySnapTargets)
  const setGeometrySnapTarget = useCrystalStore((s) => s.setGeometrySnapTarget)
  const domainWallReview = useCrystalStore((s) => s.domainWallReview)
  const lodThreshold = useCrystalStore((s) => s.lodThreshold)
  const useLowDetailMode = useCrystalStore((s) => s.useLowDetailMode)
  const useUltraLowMode = useCrystalStore((s) => s.useUltraLowMode)
  const massiveSceneThreshold = useCrystalStore((s) => s.massiveSceneThreshold)
  const veryLargeSceneThreshold = useCrystalStore((s) => s.veryLargeSceneThreshold)
  const adaptivePerformanceEnabled = useCrystalStore((s) => s.adaptivePerformanceEnabled)
  const adaptivePerformanceLevel = useCrystalStore((s) => s.adaptivePerformanceLevel)
  const adaptivePerformanceDpr = useCrystalStore((s) => s.adaptivePerformanceDpr)
  const atoms = useCrystalStore((s) => s.atoms)
  const setAutoFocusOnAtom = useCrystalStore((s) => s.setAutoFocusOnAtom)
  const setHoverHintsEnabled = useCrystalStore((s) => s.setHoverHintsEnabled)
  const setGeometrySnapEnabled = useCrystalStore((s) => s.setGeometrySnapEnabled)
  const cellOverflowMode = useCrystalStore((s) => s.cellOverflowMode)
  const setCellOverflowMode = useCrystalStore((s) => s.setCellOverflowMode)
  const periodic = useCrystalStore((s) => s.periodic)
  const setLodThreshold = useCrystalStore((s) => s.setLodThreshold)
  const setAdaptivePerformanceEnabled = useCrystalStore((s) => s.setAdaptivePerformanceEnabled)
  
  // Determine current render mode
  const largeSceneThresholdOptions = {
    mobileLike: isMobile,
    customMassiveThreshold: massiveSceneThreshold,
    customVeryLargeThreshold: veryLargeSceneThreshold,
  }
  const veryLargeSceneMode = isVeryLargeScene(atoms.length, largeSceneThresholdOptions)
  const massiveSceneMode = isMassiveScene(atoms.length, largeSceneThresholdOptions)
  const renderMode: PerformanceRenderMode = veryLargeSceneMode
    ? 'very-large'
    : massiveSceneMode
      ? 'massive'
      : useUltraLowMode
        ? 'ultra'
        : useLowDetailMode
          ? 'fast'
          : 'detailed'
  const renderModeMeta = PERFORMANCE_MODE_META[renderMode]

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-2" aria-labelledby="tools-interaction-heading">
        <div id="tools-interaction-heading" style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 2 }}>Interaction</div>
        <label className="flex items-center justify-between cursor-pointer" title="When off, selecting or adding an atom no longer flies the camera back to it — the current view is kept (better for heavy modeling)">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Auto-focus on Atom</span>
          <Toggle checked={autoFocusOnAtom} onChange={(v) => { setAutoFocusOnAtom(v);  }} />
        </label>
        <label className="flex items-center justify-between cursor-pointer" title="Show extended descriptions after dwelling on a viewport tool">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Extended Tooltips</span>
          <Toggle checked={hoverHintsEnabled} onChange={(v) => { setHoverHintsEnabled(v);  }} />
        </label>
        <label className="flex items-center justify-between cursor-pointer" title="While placing or dragging atoms, show division points, extension lines and intersections along bonds / lattice edges and snap to them. Hold Alt while dragging to bypass snapping for that drag.">
          <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Geometry Snap</span>
          <Toggle checked={geometrySnapEnabled} onChange={(v) => { setGeometrySnapEnabled(v);  }} />
        </label>
        {/* Disclose Alt as the temporary snap override so intentional near-feature placement is possible. */}
        {geometrySnapEnabled && (
          <p className="text-[11px] leading-relaxed -mt-1" style={{ color: 'var(--panel-text-secondary)' }}>
            Hold <kbd className="px-1 rounded" style={{ background: 'var(--glass-border-subtle)' }}>Alt</kbd> while dragging to place an atom freely without snapping.
          </p>
        )}
        {/* Hide per-target snap controls when the master switch is off. */}
        {geometrySnapEnabled && (
          <div className="ml-3 pl-2 flex flex-col gap-1.5 border-l" style={{ borderColor: 'var(--glass-border-subtle)' }}>
            {SNAP_TARGET_ITEMS.map((item) => (
              <label key={item.key} className="flex items-center justify-between cursor-pointer" title={item.hint}>
                <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                <Toggle
                  checked={geometrySnapTargets[item.key]}
                  onChange={(v) => { setGeometrySnapTarget(item.key, v);  }}
                />
              </label>
            ))}
          </div>
        )}

        {/* Outside-cell handling changes data or lattice, so it belongs to Interaction and only periodic systems. */}
        {periodic && (
          <div className="mt-1 pt-3 border-t space-y-1.5" style={{ borderColor: 'var(--glass-border-subtle)' }}>
            <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Moving atoms outside the cell</span>
            <Segmented
              ariaLabel="Cell overflow mode"
              options={CELL_OVERFLOW_OPTIONS.map((o) => o.label)}
              value={CELL_OVERFLOW_OPTIONS.find((o) => o.mode === cellOverflowMode)!.label}
              onChange={(label) => {
                const next = CELL_OVERFLOW_OPTIONS.find((o) => o.label === label)
                if (!next || next.mode === cellOverflowMode) return
                setCellOverflowMode(next.mode)
              }}
            />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--panel-text-secondary)' }}>
              {CELL_OVERFLOW_OPTIONS.find((o) => o.mode === cellOverflowMode)!.hint}
            </p>
            {/* grow-cell changes lattice constants and therefore the material; state that cost explicitly. */}
            {cellOverflowMode === 'grow-cell' && (
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--status-amber)' }}>
                Changes the lattice constants, so the material itself changes. Intended for vacuum padding on
                slabs and molecules — not for a genuinely periodic axis.
              </p>
            )}
          </div>
        )}
      </section>

      <DomainWallReviewSection review={domainWallReview} />

      {/* Performance Settings Section */}
      <div className="pt-3 mt-3 border-t border-[var(--glass-border-subtle)]">
        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">
          Performance
        </label>
        
        {/* Current render mode indicator */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--text-secondary)]">Render Mode</span>
          <span
            className="rounded-md border px-2 py-0.5 text-xs font-medium"
            style={{
              color: renderModeMeta.color,
              background: renderModeMeta.background,
              borderColor: renderModeMeta.border,
            }}
          >
            {renderModeMeta.label}
          </span>
        </div>
        
        {/* Atom count info */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--text-secondary)]">Atoms</span>
          <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
            {atoms.length.toLocaleString()}
          </span>
        </div>

        <label className="flex items-center justify-between cursor-pointer mb-3 gap-3">
          <div>
            <span className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Adaptive Performance</span>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              {getAdaptivePerformanceLabel(adaptivePerformanceLevel)} · DPR {adaptivePerformanceDpr.toFixed(2)}
            </p>
          </div>
          <Toggle checked={adaptivePerformanceEnabled} onChange={(v) => { setAdaptivePerformanceEnabled(v);  }} />
        </label>

        {/* LOD Threshold slider */}
        <div className="mb-3">
          <SliderRow
            label="Fast Mode Threshold" value={lodThreshold} min={100} max={5000} step={100}
            display={lodThreshold.toLocaleString()} accent="var(--status-amber)"
            onChange={setLodThreshold}
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            Switch to instanced rendering above this count
          </p>
        </div>
        
        {/* Large Scene Thresholds — dual handle */}
        <LargeSceneThresholdSlider />

        {/* Solid Box Manual Toggle */}
        <SolidBoxToggle />
        <RegionViewSection />
        
      </div>

      {/* Analysis overlays are visual evidence, not a performance preference. */}
      <AnalysisOverlaysSection />
    </div>
  )
}

// ── PR-I: Analysis overlays ────────────────────────────────────────────────

/** 3D viewer overlays driven by explicit analysis evidence. */
function AnalysisOverlaysSection() {
  const [baderNotice, setBaderNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const showBaderLabels = useCrystalStore((s) => s.showBaderLabels)
  const setShowBaderLabels = useCrystalStore((s) => s.setShowBaderLabels)
  const ptmAnalysis = useCrystalStore((s) => s.ptmAnalysis)
  const showPtmColoring = useCrystalStore((s) => s.showPtmColoring)
  const setShowPtmColoring = useCrystalStore((s) => s.setShowPtmColoring)
  const setAtomAttributesBulk = useCrystalStore((s) => s.setAtomAttributesBulk)
  const atoms = useCrystalStore((s) => s.atoms)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const selectAtoms = useCrystalStore((s) => s.selectAtoms)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)

  const focusPtmRepresentative = (type: (typeof PTM_STRUCTURE_ORDER)[number]) => {
    const matching = atoms.filter((atom) => {
      const attrs = atomAttributes[atom.id]
      return attrs?.ptmAnalyzed === true && attrs.ptmStructureType === type
    })
    if (!matching.length) return
    const representative = matching.reduce((best, atom) => {
      const bestRmsd = atomAttributes[best.id]?.ptmRmsd ?? 0
      const rmsd = atomAttributes[atom.id]?.ptmRmsd ?? 0
      return type === 'other'
        ? rmsd > bestRmsd ? atom : best
        : rmsd < bestRmsd ? atom : best
    })
    selectAtoms([representative.id])
    focusOnAtoms([representative.id])
  }

  const focusPtmOrderingRepresentative = (type: (typeof PTM_ORDERING_ORDER)[number]) => {
    const matching = atoms.filter((atom) => {
      const attrs = atomAttributes[atom.id]
      return attrs?.ptmAnalyzed === true && attrs.ptmOrderingType === type
    })
    if (!matching.length) return
    const representative = matching.reduce((best, atom) => (
      (atomAttributes[atom.id]?.ptmRmsd ?? 0) < (atomAttributes[best.id]?.ptmRmsd ?? 0)
        ? atom
        : best
    ))
    selectAtoms([representative.id])
    focusOnAtoms([representative.id])
  }

  const focusMaximumElasticStrain = () => {
    const atomId = ptmAnalysis?.maximumElasticStrainAtomId
    if (!atomId || !atoms.some((atom) => atom.id === atomId)) return
    selectAtoms([atomId])
    focusOnAtoms([atomId])
  }

  const importBaderJson = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const entries: Record<string, { bader_charge: number }> = {}
      const atomIds = new Set(atoms.map((atom) => atom.id))
      let unmatched = 0

      // Bader/ACF atom indices are canonically one-based. Index 0 is accepted
      // only as the first atom so an explicitly zero-based export remains unambiguous.
      const resolveAtomId = (value: string | number): string | null => {
        const key = String(value)
        if (atomIds.has(key)) return key
        const index = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN
        if (!Number.isInteger(index)) return null
        if (index === 0) return atoms[0]?.id ?? null
        return atoms[index - 1]?.id ?? null
      }

      const addCharge = (key: string | number, charge: unknown) => {
        if (typeof charge !== 'number' || !Number.isFinite(charge)) return
        const atomId = resolveAtomId(key)
        if (!atomId) {
          unmatched++
          return
        }
        entries[atomId] = { bader_charge: charge }
      }

      if (Array.isArray(parsed)) {
        for (const row of parsed as Array<{ atom_id?: string; index?: number; charge?: number; bader_charge?: number }>) {
          const id = row.atom_id ?? row.index
          if (id != null) addCharge(id, row.bader_charge ?? row.charge)
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'number') addCharge(k, v)
          else if (v && typeof v === 'object') {
            const charge = (v as { charge?: number; bader_charge?: number }).bader_charge
              ?? (v as { charge?: number }).charge
            addCharge(k, charge)
          }
        }
      }

      const importedCount = Object.keys(entries).length
      if (importedCount === 0) {
        setBaderNotice({
          tone: 'error',
          message: atoms.length === 0
            ? 'Open a structure before importing charges.'
            : 'No charges matched this structure. Use atom_id or one-based atom indices.',
        })
        return
      }

      setAtomAttributesBulk(entries)
      setBaderNotice({
        tone: 'success',
        message: `Imported ${importedCount.toLocaleString()} charge${importedCount === 1 ? '' : 's'}${unmatched > 0 ? `; ${unmatched.toLocaleString()} unmatched` : ''}.`,
      })
    } catch {
      setBaderNotice({ tone: 'error', message: 'Could not read this file. Choose a valid Bader JSON export.' })
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--glass-border-subtle)] space-y-3">
      <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
        Analysis overlays
      </div>

      <ToggleRow
        label="Bader charge labels"
        checked={showBaderLabels}
        onChange={setShowBaderLabels}
      />
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-tertiary)] pl-3">Import charges (JSON)</span>
        <span
          className="zatom-pressable cursor-pointer rounded-md px-2 py-1 text-[10px] font-medium"
          style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}
        >
          Choose JSON
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importBaderJson(f)
              e.target.value = ''
            }}
            className="sr-only"
          />
        </span>
      </label>
      {baderNotice && (
        <div
          role={baderNotice.tone === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-[10px] leading-4"
          style={baderNotice.tone === 'error'
            ? {
                color: PANEL_STATUS_TONES.error.foreground,
                background: PANEL_STATUS_TONES.error.background,
                border: `1px solid ${PANEL_STATUS_TONES.error.border}`,
              }
            : {
                color: PANEL_STATUS_TONES.success.foreground,
                background: PANEL_STATUS_TONES.success.background,
                border: `1px solid ${PANEL_STATUS_TONES.success.border}`,
              }}
        >
          {baderNotice.tone === 'error'
            ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
          <span>{baderNotice.message}</span>
        </div>
      )}

      {ptmAnalysis ? (
        <div className="space-y-2">
          <ToggleRow
            label="OVITO PTM coloring"
            checked={showPtmColoring}
            onChange={setShowPtmColoring}
          />
          <div
            className="rounded-xl p-2.5"
            style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium" style={{ color: 'var(--panel-text)' }}>
                  OVITO {ptmAnalysis.engineVersion}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>
                  RMSD cutoff {ptmAnalysis.rmsdCutoff.toFixed(3)}
                </div>
              </div>
              <div className="text-right text-[10px] tabular-nums" style={{ color: 'var(--panel-text-secondary)' }}>
                {ptmAnalysis.analyzedAtomCount.toLocaleString()} / {ptmAnalysis.totalAtomCount.toLocaleString()}
                <div style={{ color: 'var(--panel-text-tertiary)' }}>analyzed</div>
              </div>
            </div>

            <div className="mt-2 space-y-1" aria-label="OVITO PTM structure legend">
              {PTM_STRUCTURE_ORDER.filter((type) => ptmAnalysis.counts[type] > 0).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => focusPtmRepresentative(type)}
                  className="zatom-pressable flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left"
                  style={{ color: 'var(--panel-text-secondary)' }}
                  aria-label={`Focus representative ${PTM_STRUCTURE_LABELS[type]} atom`}
                  title={type === 'other'
                    ? 'Focus the unmatched atom with the highest reported RMSD'
                    : `Focus the lowest-RMSD ${PTM_STRUCTURE_LABELS[type]} representative`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: PTM_STRUCTURE_COLORS[type],
                      border: type === 'other' ? '1px solid rgba(128,128,128,0.45)' : 'none',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{PTM_STRUCTURE_LABELS[type]}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>
                    {ptmAnalysis.counts[type].toLocaleString()}
                  </span>
                  <Crosshair className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
            {ptmAnalysis.orderingEnabled && ptmAnalysis.orderingCounts && (
              <div className="mt-2 border-t border-[var(--panel-border)] pt-2">
                <div className="px-2 text-[10px] font-medium" style={{ color: 'var(--panel-text-tertiary)' }}>
                  Chemical ordering
                </div>
                <div className="mt-1 space-y-1" aria-label="OVITO PTM chemical ordering">
                  {PTM_ORDERING_ORDER.filter((type) => ptmAnalysis.orderingCounts![type] > 0).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => focusPtmOrderingRepresentative(type)}
                      className="zatom-pressable flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left"
                      style={{ color: 'var(--panel-text-secondary)' }}
                      aria-label={`Focus representative ${PTM_ORDERING_LABELS[type]} ordering atom`}
                      title={`Focus the lowest-RMSD ${PTM_ORDERING_LABELS[type]} ordering representative`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px]">{PTM_ORDERING_LABELS[type]}</span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>
                        {ptmAnalysis.orderingCounts![type].toLocaleString()}
                      </span>
                      <Crosshair className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {ptmAnalysis.deformationGradientEnabled && (
              <button
                type="button"
                onClick={focusMaximumElasticStrain}
                disabled={ptmAnalysis.maximumElasticStrainAtomId === null}
                className="zatom-pressable mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg border-t border-[var(--panel-border)] px-2 pt-2 text-left disabled:cursor-default disabled:opacity-60"
                style={{ color: 'var(--panel-text-secondary)' }}
                aria-label={ptmAnalysis.maximumElasticStrainAtomId
                  ? `Focus atom ${ptmAnalysis.maximumElasticStrainAtomId} with maximum elastic strain`
                  : 'No recognized atom has an elastic deformation gradient'}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-medium" style={{ color: 'var(--panel-text-tertiary)' }}>
                    Peak elastic strain ‖E‖F
                  </span>
                  <span className="block truncate text-[11px] tabular-nums">
                    {ptmAnalysis.maximumElasticStrainMagnitude === null
                      ? 'No matched atoms'
                      : `${ptmAnalysis.maximumElasticStrainMagnitude.toPrecision(5)} · ${ptmAnalysis.maximumElasticStrainAtomId}`}
                  </span>
                </span>
                {ptmAnalysis.maximumElasticStrainAtomId && (
                  <Crosshair className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
              </button>
            )}
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--panel-text-tertiary)' }}>
              Other means unmatched under this template set and cutoff—not a named defect or phase.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl px-2.5 py-2 text-[10px] leading-relaxed"
          style={{ color: 'var(--panel-text-tertiary)', backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
        >
          Local structure coloring appears after a registered OVITO PTM result is applied.
        </div>
      )}
    </div>
  )
}
