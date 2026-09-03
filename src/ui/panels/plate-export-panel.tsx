/** Composes multiple 3D viewports into a labeled publication plate. */

'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { useViewportManager } from '../../orchestration/viewportManager'
import {
  exportViewportPlate,
  PlateExportError,
  type PlateSourceCell,
} from '../../orchestration/viewportPlateExport'
import { Notice, SectionLabel, Segmented, ToggleRow } from './panel-ui'

const PANEL_LABELS = ['a', 'b', 'c', 'd'] as const

/** Publication widths shared with single-figure export. */
const WIDTH_PRESETS = [
  { label: '89 mm', value: 89 },
  { label: '120 mm', value: 120 },
  { label: '183 mm', value: 183 },
] as const

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function PlateExportPanel() {
  const viewports = useViewportManager((s) => s.viewports)
  const getViewportStore = useViewportManager((s) => s.getViewportStore)

  const [widthMm, setWidthMm] = useState<number>(183)
  const [dpi, setDpi] = useState(600)
  const [columns, setColumns] = useState<1 | 2>(2)
  const [gutterMm, setGutterMm] = useState(3)
  const [marginMm, setMarginMm] = useState(0)
  const [labelFontSizePt, setLabelFontSizePt] = useState(9)
  const [transparent, setTransparent] = useState(false)
  const [includeSharedScaleBar, setIncludeSharedScaleBar] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  /** Include only populated crystal viewports with a measurable 3D camera. */
  const candidates = useMemo(() => {
    return Object.values(viewports)
      .filter((slot) => slot.kind === 'crystal')
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((slot) => {
        const store = getViewportStore(slot.id)
        if (!store) return []
        const state = store.getState()
        if (state.atoms.length === 0) return []
        return [{ id: slot.id, label: slot.label, store, atomCount: state.atoms.length }]
      })
  }, [viewports, getViewportStore])

  const usable = candidates.slice(0, 4)
  const enoughPanels = usable.length >= 2

  const handleExport = async () => {
    setBusy(true)
    setError(null)
    setLastResult(null)
    try {
      const cells: PlateSourceCell[] = usable.map((candidate, index) => {
        const atoms = candidate.store.getState().atoms
    // Use Cartesian coordinates for the centroid; Atom.position is fractional.
        const world = atoms.flatMap((atom) => (atom.cartesian ? [atom.cartesian] : []))
        const centroid: [number, number, number] = world.length
          ? [
              world.reduce((sum, p) => sum + p[0], 0) / world.length,
              world.reduce((sum, p) => sum + p[1], 0) / world.length,
              world.reduce((sum, p) => sum + p[2], 0) / world.length,
            ]
          : [0, 0, 0]
        return { label: PANEL_LABELS[index], registryKey: candidate.store, centroid }
      })

      const result = await exportViewportPlate({
        cells,
        widthMm,
        dpi,
        columns,
        gutterMm,
        marginMm,
        labelFontSizePt,
        transparent,
        includeSharedScaleBar,
      })
      downloadBlob(result.suggestedFileName, result.blob)
      const normalized = result.rescaledCells > 0
        ? ` · ${result.rescaledCells} panel${result.rescaledCells > 1 ? 's' : ''} scaled down to match`
        : ' · panels already matched'
      setLastResult(
        `plate · ${cells.length} panels · ${result.layout.widthMm}×${result.layout.heightMm.toFixed(1)} mm` +
          `${normalized} · ${(result.blob.size / 1024).toFixed(0)} KB`,
      )
    } catch (cause) {
      setError(
        cause instanceof PlateExportError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'Plate export failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <SectionLabel>Panels</SectionLabel>
        {enoughPanels ? (
          <ul className="flex flex-col gap-1">
            {usable.map((candidate, index) => (
              <li
                key={candidate.id}
                className="flex items-center justify-between rounded-md border border-[var(--panel-border)] px-2 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-[var(--panel-text)]">
                    ({PANEL_LABELS[index]})
                  </span>
                  <span className="text-[11px] text-[var(--panel-text-secondary)]">
                    {candidate.label}
                  </span>
                </span>
                <span className="text-[10px] text-[var(--panel-text-tertiary)]">
                  {candidate.atomCount} atoms
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="amber" icon={AlertTriangle}>
            A plate needs at least two viewports with a structure loaded. Split the view and open a
            structure in each panel.
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Plate width</SectionLabel>
        <Segmented
          options={WIDTH_PRESETS.map((preset) => preset.label)}
          value={WIDTH_PRESETS.find((preset) => preset.value === widthMm)?.label ?? '183 mm'}
          onChange={(next) => {
            const preset = WIDTH_PRESETS.find((candidate) => candidate.label === next)
            if (preset) setWidthMm(preset.value)
          }}
          ariaLabel="Plate width"
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Arrangement</SectionLabel>
        <Segmented
          options={['2 columns', '1 column']}
          value={columns === 2 ? '2 columns' : '1 column'}
          onChange={(next) => setColumns(next === '2 columns' ? 2 : 1)}
          ariaLabel="Panel arrangement"
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Resolution</SectionLabel>
        <Segmented
          options={['300 dpi', '600 dpi']}
          value={dpi === 300 ? '300 dpi' : '600 dpi'}
          onChange={(next) => setDpi(next === '300 dpi' ? 300 : 600)}
          ariaLabel="Plate resolution"
        />
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Spacing</SectionLabel>
        <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--panel-text-secondary)]">
          <span>Gutter</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={gutterMm}
              onChange={(event) => setGutterMm(Number(event.target.value))}
              aria-label="Gutter between panels in millimetres"
              className="w-28"
            />
            <span className="w-12 text-right font-mono text-[10px] text-[var(--panel-text)]">
              {gutterMm.toFixed(1)} mm
            </span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--panel-text-secondary)]">
          <span>Margin</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={marginMm}
              onChange={(event) => setMarginMm(Number(event.target.value))}
              aria-label="Plate outer margin in millimetres"
              className="w-28"
            />
            <span className="w-12 text-right font-mono text-[10px] text-[var(--panel-text)]">
              {marginMm.toFixed(1)} mm
            </span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--panel-text-secondary)]">
          <span>Panel label</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={6}
              max={14}
              step={0.5}
              value={labelFontSizePt}
              onChange={(event) => setLabelFontSizePt(Number(event.target.value))}
              aria-label="Panel label size in points"
              className="w-28"
            />
            <span className="w-12 text-right font-mono text-[10px] text-[var(--panel-text)]">
              {labelFontSizePt.toFixed(1)} pt
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Options</SectionLabel>
        <ToggleRow
          label="Shared scale bar"
          description="Draws one bar for the whole plate, valid in every panel."
          checked={includeSharedScaleBar}
          onChange={setIncludeSharedScaleBar}
        />
        <ToggleRow
          label="Transparent background"
          description="Omits the white backdrop so the plate drops onto any page colour."
          checked={transparent}
          onChange={setTransparent}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
        Every panel is normalised to one shared Angstrom-per-millimetre scale, so sizes are directly
        comparable across (a)–(d). Panels keep their own camera angle.
      </p>

      <button
        type="button"
        onClick={handleExport}
        disabled={busy || !enoughPanels}
        className="flex items-center justify-center gap-2 rounded-md bg-[var(--panel-accent)] px-3 py-2 text-[11px] font-medium text-[var(--panel-accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? 'Composing plate…' : 'Export plate'}
      </button>

      {error && <Notice tone="red" icon={AlertTriangle}>{error}</Notice>}
      {lastResult && <Notice tone="green" icon={Layers}>{`Exported ${lastResult}`}</Notice>}
    </div>
  )
}
