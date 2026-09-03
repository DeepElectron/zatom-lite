import { Play, X } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useViewportManager, type ChartKind, type ChartSlot } from "../../orchestration/viewportManager"
import { RangeSliderRow, SectionLabel, Segmented, SliderRow, ToggleRow } from "./panel-ui"

/**
 * Analysis page — parameters for the chart viewports opened from g(r) / XRD /
 * eDiff.
 *
 * The charts render in their own grid panes, so their parameters used to live
 * only in each pane's header strip: a horizontal row of unlabelled native
 * range inputs that shrinks with the pane and has no room for anything more.
 * This page is the settings surface for whatever analysis is currently open,
 * bound to the same store fields the chart headers write, so the two stay in
 * lockstep rather than being two sources of truth.
 *
 * Presentation follows the Tools and Bonds pages: flat label/control rows,
 * hairline + uppercase label for grouping, no card containers.
 */

const CHART_TITLES: Record<ChartKind, string> = {
  rdf: 'g(r)',
  xrd: 'XRD',
  ediff: 'eDiff',
  convergence: 'E/F',
  ladder: 'Ladder',
}

const CHART_SUBTITLES: Record<ChartKind, string> = {
  rdf: 'Radial distribution',
  xrd: 'Powder pattern',
  ediff: 'Electron diffraction',
  convergence: 'Relaxation convergence',
  ladder: 'Structure ladder',
}

/** Radiation sources, matching the XRD chart header. */
const RADIATION_KEYS = ['CuKa', 'CuKa1', 'MoKa', 'CrKa', 'CoKa', 'FeKa', 'AgKa'] as const

function Rule() {
  return <div className="h-px" style={{ background: 'var(--panel-border)' }} aria-hidden />
}

/** Group header: analysis name plus its recompute / close actions. */
function GroupHeader({
  kind,
  computing,
  onRecompute,
  onClose,
}: {
  kind: ChartKind
  computing: boolean
  onRecompute?: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <SectionLabel>{CHART_TITLES[kind]}</SectionLabel>
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">{CHART_SUBTITLES[kind]}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onRecompute && (
          <button
            type="button"
            onClick={() => { onRecompute();  }}
            disabled={computing}
            className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-2 py-1 text-[10px] disabled:opacity-40"
            title="Recompute with current parameters"
          >
            <Play className="h-3 w-3" />
            {computing ? 'Computing' : 'Update'}
          </button>
        )}
        <button
          type="button"
          onClick={() => { onClose();  }}
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ color: 'var(--panel-text-tertiary)' }}
          title={`Close ${CHART_TITLES[kind]} pane`}
          aria-label={`Close ${CHART_TITLES[kind]} pane`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function RdfGroup({ onClose }: { onClose: () => void }) {
  const periodic = useCrystalStore((s) => s.periodic)
  const cutoff = useCrystalStore((s) => s.rdfCutoff)
  const nBins = useCrystalStore((s) => s.rdfNBins)
  const usePbc = useCrystalStore((s) => s.rdfUsePbc)
  const status = useCrystalStore((s) => s.rdfStatus)
  const setCutoff = useCrystalStore((s) => s.setRdfCutoff)
  const setNBins = useCrystalStore((s) => s.setRdfNBins)
  const setUsePbc = useCrystalStore((s) => s.setRdfUsePbc)
  const computeRdf = useCrystalStore((s) => s.computeRdf)
  const computeAllPairs = useCrystalStore((s) => s.computeAllPairs)

  return (
    <div className="flex flex-col gap-3">
      <GroupHeader kind="rdf" computing={status === 'computing'} onRecompute={computeRdf} onClose={onClose} />
      <SliderRow
        label="Cutoff"
        value={cutoff}
        min={1}
        max={20}
        step={0.5}
        display={`${cutoff} Å`}
        onChange={setCutoff}
      />
      <SliderRow
        label="Bins"
        value={nBins}
        min={10}
        max={300}
        step={5}
        display={String(nBins)}
        onChange={setNBins}
      />
      {periodic && (
        <ToggleRow
          label="Minimum image"
          description="Use periodic distances instead of box distances."
          checked={usePbc}
          onChange={setUsePbc}
        />
      )}
      <button
        type="button"
        onClick={() => { computeAllPairs();  }}
        disabled={status === 'computing'}
        className="zatom-choice zatom-pressable self-start rounded px-2 py-1 text-[10px] disabled:opacity-40"
      >
        Compute every element pair
      </button>
    </div>
  )
}

function XrdGroup({ onClose }: { onClose: () => void }) {
  const periodic = useCrystalStore((s) => s.periodic)
  const radiation = useCrystalStore((s) => s.xrdRadiation)
  const tMin = useCrystalStore((s) => s.xrdTwoThetaMin)
  const tMax = useCrystalStore((s) => s.xrdTwoThetaMax)
  const status = useCrystalStore((s) => s.xrdStatus)
  const setRadiation = useCrystalStore((s) => s.setXrdRadiation)
  const setRange = useCrystalStore((s) => s.setXrdTwoThetaRange)
  const computeXrd = useCrystalStore((s) => s.computeXrd)

  return (
    <div className="flex flex-col gap-3">
      <GroupHeader kind="xrd" computing={status === 'computing'} onRecompute={computeXrd} onClose={onClose} />
      {!periodic && (
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">
          Needs a periodic cell. Turn on Boundary → Periodic.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-[var(--panel-text)]">Radiation</span>
        <Segmented
          bare
          ariaLabel="X-ray radiation source"
          options={[...RADIATION_KEYS]}
          value={radiation === 'custom' ? RADIATION_KEYS[0] : radiation}
          onChange={(v) => setRadiation(v as (typeof RADIATION_KEYS)[number])}
        />
      </div>
      <RangeSliderRow
        label="2θ range"
        min={0}
        max={180}
        step={1}
        value={[tMin, tMax]}
        display={(v) => `${v}°`}
        onChange={([lo, hi]) => setRange(lo, hi)}
      />
    </div>
  )
}

function EdiffGroup({ onClose }: { onClose: () => void }) {
  const periodic = useCrystalStore((s) => s.periodic)
  const voltage = useCrystalStore((s) => s.ediffVoltageKV)
  const gMax = useCrystalStore((s) => s.ediffGMax)
  const status = useCrystalStore((s) => s.ediffStatus)
  const setVoltage = useCrystalStore((s) => s.setEdiffVoltage)
  const setGMax = useCrystalStore((s) => s.setEdiffGMax)
  const computeEdiff = useCrystalStore((s) => s.computeEdiff)

  return (
    <div className="flex flex-col gap-3">
      <GroupHeader kind="ediff" computing={status === 'computing'} onRecompute={computeEdiff} onClose={onClose} />
      {!periodic && (
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">
          Needs a periodic cell. Turn on Boundary → Periodic.
        </p>
      )}
      <SliderRow
        label="Accelerating voltage"
        value={voltage}
        min={20}
        max={400}
        step={20}
        display={`${voltage} kV`}
        onChange={setVoltage}
      />
      <SliderRow
        label="Reciprocal extent"
        value={gMax}
        min={2}
        max={30}
        step={1}
        display={`|g| ≤ ${gMax} Å⁻¹`}
        onChange={setGMax}
      />
    </div>
  )
}

/** Charts with no parameters of their own still get a close affordance. */
function PlainGroup({ kind, onClose }: { kind: ChartKind; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <GroupHeader kind={kind} computing={false} onClose={onClose} />
      <p className="text-[10px] text-[var(--panel-text-tertiary)]">
        This view follows the structure directly and has no parameters.
      </p>
    </div>
  )
}

export function AnalysisSettings() {
  const atomCount = useCrystalStore((s) => s.atoms.length)
  const periodic = useCrystalStore((s) => s.periodic)

  const viewports = useViewportManager((s) => s.viewports)
  const activeVpId = useViewportManager((s) => s.activeViewportId)
  const layout = useViewportManager((s) => s.layout)
  const openChartSlot = useViewportManager((s) => s.openChartSlot)
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  const openCharts = Object.values(viewports).filter(
    (s): s is ChartSlot => s.kind === 'chart' && s.sourceViewportId === activeVpId,
  )
  const openKinds = new Set(openCharts.map((c) => c.chartKind))

  /** Analyses that can be launched from here, with the grid's own gating. */
  const launchable: { kind: ChartKind; disabled: boolean; reason?: string }[] = [
    { kind: 'rdf', disabled: atomCount < 2, reason: 'needs 2+ atoms' },
    { kind: 'xrd', disabled: !periodic || atomCount < 1, reason: 'needs a periodic cell' },
    { kind: 'ediff', disabled: !periodic || atomCount < 1, reason: 'needs a periodic cell' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Open analyses</SectionLabel>
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">
          {openCharts.length === 0
            ? 'Each analysis opens in its own pane next to the structure.'
            : `${openCharts.length} pane${openCharts.length > 1 ? 's' : ''} in ${layout}, live against this structure.`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {launchable.map(({ kind, disabled, reason }) => {
            const isOpen = openKinds.has(kind)
            return (
              <button
                key={kind}
                type="button"
                disabled={disabled && !isOpen}
                data-selected={isOpen}
                onClick={() => {
                  const existing = openCharts.find((c) => c.chartKind === kind)
                  if (existing) {
                    closeChartSlot(existing.id)
                    return
                  }
                  openChartSlot(kind)
                }}
                className="zatom-choice zatom-pressable rounded px-2 py-1 text-[11px] disabled:opacity-40"
                title={disabled && !isOpen ? `${CHART_TITLES[kind]} ${reason}` : undefined}
              >
                {CHART_TITLES[kind]}
              </button>
            )
          })}
        </div>
      </div>

      {openCharts.length === 0 ? (
        <>
          <Rule />
          <p className="text-[11px] text-[var(--panel-text-secondary)]">
            Open an analysis above to set its parameters here.
          </p>
        </>
      ) : (
        openCharts.map((chart) => (
          <div key={chart.id} className="flex flex-col gap-3">
            <Rule />
            {chart.chartKind === 'rdf' ? (
              <RdfGroup onClose={() => closeChartSlot(chart.id)} />
            ) : chart.chartKind === 'xrd' ? (
              <XrdGroup onClose={() => closeChartSlot(chart.id)} />
            ) : chart.chartKind === 'ediff' ? (
              <EdiffGroup onClose={() => closeChartSlot(chart.id)} />
            ) : (
              <PlainGroup kind={chart.chartKind} onClose={() => closeChartSlot(chart.id)} />
            )}
          </div>
        ))
      )}
    </div>
  )
}

export default AnalysisSettings
