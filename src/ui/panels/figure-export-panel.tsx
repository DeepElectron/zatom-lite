/**
 * Publication-oriented figure export using physical width, DPI, and transparency.
 * Report the achieved DPI when GPU framebuffer limits cap the requested size.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Image as ImageIcon } from 'lucide-react'
import {
  getActiveViewportStoreApi,
  useActiveCrystalStore as useCrystalStore,
} from '../../orchestration/ViewportContext'
import { downloadBlob } from '../../lib/molecule/molecule-export'
import {
  DPI_CHOICES,
  JOURNAL_PRESETS,
  describeHeightOverflow,
  type JournalPreset,
} from '../../lib/figure-export/figure-size'
import {
  exportViewportFigure,
  planViewportFigure,
  FigureExportError,
  type FigureImageFormat,
} from '../../lib/figure-export/export-figure'
import { atomLabelText } from '../components/crystal-viewer/atom-labels'
import { exportViewportFigureSvg } from '../../lib/figure-export/export-figure-svg'
import { exportViewportFigurePdf } from '../../lib/figure-export/export-figure-pdf'
import type { AnnotationSceneRequest } from '../../lib/figure-export/capture-annotation-scene'
import type { AtomLabelScope } from '../../lib/figure-export/collect-annotations'
import { Notice, SectionLabel, Segmented, ToggleRow } from './panel-ui'

/** SVG and PDF use vector annotations; PNG and JPEG are raster-only. */
type FigureFormat = FigureImageFormat | 'svg' | 'pdf'

const FORMAT_LABELS: Record<FigureFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  svg: 'SVG',
  pdf: 'PDF',
}

const CUSTOM_PRESET_ID = 'custom'

export function FigureExportPanel() {
  const [presetId, setPresetId] = useState<string>('nature-double')
  const [customWidthMm, setCustomWidthMm] = useState(120)
  const [dpi, setDpi] = useState(300)
  const [format, setFormat] = useState<FigureFormat>('png')
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  // Default to selected-atom annotations to keep dense figures legible.
  const [atomLabelScope, setAtomLabelScope] = useState<AtomLabelScope>('selected')
  const [includeMeasurements, setIncludeMeasurements] = useState(true)
  const [includeScaleBar, setIncludeScaleBar] = useState(true)
  const [includeLatticeVectors, setIncludeLatticeVectors] = useState(false)
  const [fontSizePt, setFontSizePt] = useState(7)

  const atoms = useCrystalStore((s) => s.atoms)
  const measurements = useCrystalStore((s) => s.measurements)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const atomLabelContent = useCrystalStore((s) => s.atomLabelContent)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodic = useCrystalStore((s) => s.periodic)

  /** Vector annotation options shared by SVG and PDF. */
  const isVector = format === 'svg' || format === 'pdf'
  /** Nonperiodic structures have placeholder lattice vectors, so omit cell axes. */
  const canDrawLatticeVectors = periodic

  const preset: JournalPreset | undefined = useMemo(
    () => JOURNAL_PRESETS.find((p) => p.id === presetId),
    [presetId],
  )
  const widthMm = preset?.widthMm ?? customWidthMm

  // Recompute on parameter or viewport-size changes; conversion does not render.
  const [plan, setPlan] = useState(() => planViewportFigure({ widthMm, dpi }))
  useEffect(() => {
    const recompute = () => {
      setPlan(planViewportFigure({ widthMm, dpi, registryKey: getActiveViewportStoreApi() }))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [widthMm, dpi])

  const heightWarning = plan ? describeHeightOverflow(plan, preset) : null

  const runExport = async () => {
    setBusy(true)
    setError(null)
    setLastResult(null)
    try {
      const registryKey = getActiveViewportStoreApi()
      if (format === 'svg' || format === 'pdf') {
        const scene: AnnotationSceneRequest = {
          widthMm,
          dpi,
          transparent,
          // Project Cartesian coordinates; Atom.position is fractional for crystals.
          atoms: atoms.flatMap((a, index) => {
            const world = a.cartesian
            if (!world) return []
            return [{
              id: a.id,
              element: a.element,
              position: [world[0], world[1], world[2]] as [number, number, number],
              // Reuse on-screen label text so exported annotations match the viewport.
              label: atomLabelText(a.element, index + 1, atomLabelContent),
            }]
          }),
          measurements,
          selectedAtomIds,
          atomLabelScope,
          includeMeasurements,
          includeScaleBar,
          latticeVectors:
            includeLatticeVectors && canDrawLatticeVectors ? latticeVectors : null,
          embedRaster: true,
          registryKey,
        }
        const result =
          format === 'svg'
            ? await exportViewportFigureSvg({ ...scene, style: { fontSizePt } })
            : await exportViewportFigurePdf({ ...scene, style: { fontSizePt } })
        downloadBlob(result.suggestedFileName, result.blob)
        const omitted = result.omittedAtomLabels > 0
          ? ` · ${result.omittedAtomLabels} labels omitted (cap reached)`
          : ''
        setLastResult(
          `${FORMAT_LABELS[format]} · ${result.annotationCount} vector annotations · ${(result.blob.size / 1024).toFixed(0)} KB${omitted}`,
        )
        return
      }
      const result = await exportViewportFigure({
        widthMm,
        dpi,
        format,
        transparent,
        registryKey,
      })
      downloadBlob(result.suggestedFileName, result.blob)
      setLastResult(
        `${result.widthPx} × ${result.heightPx} px · ${Math.round(result.actualDpi)} DPI · ${(result.blob.size / 1024).toFixed(0)} KB`,
      )
    } catch (cause) {
      setError(
        cause instanceof FigureExportError
          ? cause.message
          : 'Export failed unexpectedly. Check the console for details.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Figure width</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {JOURNAL_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPresetId(option.id)}
              aria-pressed={presetId === option.id}
              className={`zatom-pressable rounded px-2 py-1 text-[11px] ${
                presetId === option.id
                  ? 'zatom-primary font-medium'
                  : 'zatom-choice text-[var(--panel-text-secondary)]'
              }`}
              title={option.note ? `${option.widthMm} mm (${option.note})` : `${option.widthMm} mm`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPresetId(CUSTOM_PRESET_ID)}
            aria-pressed={presetId === CUSTOM_PRESET_ID}
            className={`zatom-pressable rounded px-2 py-1 text-[11px] ${
              presetId === CUSTOM_PRESET_ID
                ? 'zatom-primary font-medium'
                : 'zatom-choice text-[var(--panel-text-secondary)]'
            }`}
          >
            Custom
          </button>
        </div>
        {presetId === CUSTOM_PRESET_ID && (
          <label className="flex items-center gap-2 text-xs text-[var(--panel-text-secondary)]">
            <span className="shrink-0">Width</span>
            <input
              type="number"
              min={10}
              max={500}
              step={1}
              value={customWidthMm}
              onChange={(e) => setCustomWidthMm(Math.max(10, Math.min(500, Number(e.target.value) || 10)))}
              className="zatom-field w-20 rounded px-2 py-1 font-mono text-xs"
              aria-label="Custom figure width in millimetres"
            />
            <span className="shrink-0">mm</span>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Resolution</SectionLabel>
        <Segmented
          options={DPI_CHOICES.map((d) => `${d} DPI`)}
          value={`${dpi} DPI`}
          onChange={(v) => setDpi(Number.parseInt(v, 10))}
          ariaLabel="Export resolution in dots per inch"
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Format</SectionLabel>
        <Segmented
          options={Object.values(FORMAT_LABELS)}
          value={FORMAT_LABELS[format]}
          onChange={(v) => {
            const next = (Object.keys(FORMAT_LABELS) as FigureFormat[]).find(
              (key) => FORMAT_LABELS[key] === v,
            )
            if (next) setFormat(next)
          }}
          ariaLabel="Image format"
        />
        {/* JPEG has no alpha channel, so hide transparency instead of exposing a no-op control. */}
        {format !== 'jpeg' && (
          <ToggleRow
            label="Transparent background"
            description="Leave the background empty so the figure composites onto any layout. Some journals require a solid background."
            checked={transparent}
            onChange={setTransparent}
          />
        )}
        {isVector && (
          <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
            {format === 'svg'
              ? 'Structure ships as an embedded raster; labels, measurements, lattice vectors and the scale bar stay editable vector text. Open in Illustrator or Inkscape to restyle type without re-rendering.'
              : 'One page sized exactly to the figure, with real PDF text for every annotation — drops straight into LaTeX or Word without a browser print step.'}
          </p>
        )}
      </div>

      {isVector && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Vector annotations</SectionLabel>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--panel-text-secondary)]">Atom labels</span>
            <Segmented
              options={['None', 'Selected', 'All']}
              value={atomLabelScope === 'none' ? 'None' : atomLabelScope === 'selected' ? 'Selected' : 'All'}
              onChange={(v) =>
                setAtomLabelScope(v === 'None' ? 'none' : v === 'Selected' ? 'selected' : 'all')
              }
              ariaLabel="Which atoms to label"
            />
          </div>
          {atomLabelScope === 'selected' && selectedAtomIds.size === 0 && (
            <p className="text-[10px] text-[var(--panel-text-tertiary)]">
              Nothing selected — no atom labels will be drawn.
            </p>
          )}
          <ToggleRow
            label="Measurement values"
            description="Draw distances and angles you have measured as vector text."
            checked={includeMeasurements}
            onChange={setIncludeMeasurements}
          />
          {includeMeasurements && measurements.length === 0 && (
            <p className="text-[10px] text-[var(--panel-text-tertiary)]">
              No measurements recorded yet — use the Measure tool first.
            </p>
          )}
          {canDrawLatticeVectors && (
            <ToggleRow
              label="Lattice vectors"
              description="Draws labelled a, b, c arrows along the cell edges from the origin."
              checked={includeLatticeVectors}
              onChange={setIncludeLatticeVectors}
            />
          )}
          <ToggleRow
            label="Scale bar"
            description="Adds a rounded scale bar in Angstroms, derived from the export camera."
            checked={includeScaleBar}
            onChange={setIncludeScaleBar}
          />
          <label className="flex items-center gap-2 text-xs text-[var(--panel-text-secondary)]">
            <span className="shrink-0">Type size</span>
            <input
              type="number"
              min={4}
              max={24}
              step={0.5}
              value={fontSizePt}
              onChange={(e) => setFontSizePt(Math.max(4, Math.min(24, Number(e.target.value) || 7)))}
              className="zatom-field w-16 rounded px-2 py-1 font-mono text-xs"
              aria-label="Annotation type size in points"
            />
            <span className="shrink-0">pt</span>
          </label>
          {fontSizePt < 5 && (
            <p className="text-[10px] text-[var(--panel-text-tertiary)]">
              Below 5 pt is smaller than most journals accept in print.
            </p>
          )}
        </div>
      )}

      {plan && (
        <div className="rounded-lg bg-[var(--panel-hover)] px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--panel-text-secondary)]">Output</span>
            {/* Width follows DPI exactly; height is approximate because aspect rounding may differ by one pixel. */}
            <span className="font-mono text-[var(--panel-text)]">
              {plan.widthPx} × ~{plan.heightPx} px
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--panel-text-tertiary)]">
            <span>
              {widthMm.toFixed(1)} × {plan.heightMm.toFixed(1)} mm
            </span>
            <span>{Math.round(plan.effectiveDpi)} DPI</span>
          </div>
        </div>
      )}

      {plan?.limitedByMaxDimension && (
        <Notice tone="amber" icon={AlertTriangle}>
          {`This GPU caps the render at ${plan.longEdgePx} px, so the figure lands at ${Math.round(plan.effectiveDpi)} DPI instead of ${dpi}. Lower the width or DPI for an exact match.`}
        </Notice>
      )}

      {heightWarning && (
        <Notice tone="amber" icon={AlertTriangle}>
          {heightWarning}
        </Notice>
      )}

      {error && <Notice tone="red" icon={AlertTriangle}>{error}</Notice>}
      {lastResult && <Notice tone="green" icon={ImageIcon}>{`Exported ${lastResult}`}</Notice>}

      <button
        type="button"
        onClick={runExport}
        disabled={busy || !plan}
        className="zatom-primary zatom-pressable flex items-center justify-center gap-1.5 rounded px-3 py-2 text-xs font-medium disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? 'Rendering…' : 'Export figure'}
      </button>
      <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
        The frame is re-rendered at the target resolution, not upscaled from the screen. Aspect ratio follows
        the current viewport, so re-frame the view to change proportions.
      </p>
    </div>
  )
}
