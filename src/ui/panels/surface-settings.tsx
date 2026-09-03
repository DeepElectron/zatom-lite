'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Layers, Paintbrush, X } from 'lucide-react'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { CubParser } from '../../lib/molecular-orbitals/CubParser'
import {
  SURFACE_COLORMAP_OPTIONS,
  sampleColormap,
  type SurfaceColormap,
} from '../../lib/molecular-orbitals/surface-coloring'
import { isCubeFieldSliceSampleReady } from '../../lib/molecular-orbitals/cube-field-slice'
import { Notice, Segmented, SelectRow, SliderRow, Toggle } from './panel-ui'
import { OrbitalBrowser } from './orbital-browser'

const COLORMAP_HINTS: Partial<Record<SurfaceColormap, string>> = {
  bgr: 'blue attractive · green vdW · red repulsive (IGMH / NCI sign(λ₂)ρ)',
  rwb: 'red negative · white zero · blue positive (ESP)',
}

function surfaceColormapGradient(colormap: SurfaceColormap, steps = 24) {
  const stops: string[] = []
  for (let i = 0; i < steps; i++) {
    const [r, g, b] = sampleColormap(colormap, i / (steps - 1))
    stops.push(`rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function formatTick(value: number) {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs < 0.01 || abs >= 1000) return value.toExponential(2)
  return value.toFixed(abs < 1 ? 4 : 2)
}

/**
 * Numeric field that commits on blur / Enter rather than per keystroke:
 * typing "-0.0" character by character must not re-colour the surface three
 * times with nonsense intermediate ranges.
 */
function RangeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : String(value)
  const commit = () => {
    setEditing(false)
    const parsed = Number(draft)
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={() => { setDraft(String(value)); setEditing(true) }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) (e.target as HTMLInputElement).blur()
        }}
        aria-label={`${label} of colour range`}
        className="w-full rounded-md px-2 py-1 font-mono text-[12px] outline-none"
        style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--panel-text)' }}
      />
    </label>
  )
}

/**
 * Isosurface controls. Rendered only when a cube or Molden surface is loaded;
 * the layer itself lives in crystal-viewer/molecular-orbital-layer.tsx.
 *
 * The colour-field attach is the one piece of workflow here that is not a
 * plain slider: it takes a second cube and colours the existing surface by
 * it, which is how IGMH / NCI / ESP figures are made (surface from δg or ρ,
 * colour from sign(λ₂)ρ or the potential).
 */
export function SurfaceSettings() {
  const mo = useCrystalStore((state) => state.molecularOrbital)
  const setVisible = useCrystalStore((state) => state.setMolecularOrbitalVisible)
  const setSelectedOrbital = useCrystalStore((state) => state.setMolecularOrbitalSelectedOrbital)
  const setIsoValue = useCrystalStore((state) => state.setMolecularOrbitalIsoValue)
  const setOpacity = useCrystalStore((state) => state.setMolecularOrbitalOpacity)
  const setResolution = useCrystalStore((state) => state.setMolecularOrbitalResolution)
  const setPositiveColor = useCrystalStore((state) => state.setMolecularOrbitalPositiveColor)
  const setNegativeColor = useCrystalStore((state) => state.setMolecularOrbitalNegativeColor)
  const setColorField = useCrystalStore((state) => state.setSurfaceColorField)
  const clearColorField = useCrystalStore((state) => state.clearSurfaceColorField)
  const setColormap = useCrystalStore((state) => state.setSurfaceColormap)
  const setColorRange = useCrystalStore((state) => state.setSurfaceColorRange)
  const setShowExtrema = useCrystalStore((state) => state.setSurfaceShowExtrema)
  const setFieldSlice = useCrystalStore((state) => state.setFieldSlice)
  const constructedPlane = useCrystalStore((state) => state.constructedPlane)
  const stats = useCrystalStore((state) => state.molecularOrbital.colorFieldStats)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)

  if (!mo.sourceType) return null

  const handleAttach = async (file: File | undefined) => {
    if (!file) return
    setAttachError(null)
    try {
      const text = await file.text()
      const data = new CubParser().parse(text)
      if (data.volumeData.length === 0) throw new Error('cube has no volume data')
      setColorField(data, file.name)
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'could not read cube')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const colorField = mo.colorField
  const currentSliceReady = isCubeFieldSliceSampleReady(
    mo.fieldSliceSample,
    constructedPlane?.id,
    colorField?.cubData,
  )

  return (
    <section className="space-y-3 border-t border-[var(--glass-border-subtle)] pt-4" aria-labelledby="surface-heading">
      <div className="flex items-center justify-between">
        <div id="surface-heading" className="flex items-center gap-1.5" style={{ fontSize: 13, color: 'var(--panel-text)' }}>
          <Layers className="h-3.5 w-3.5" /> Isosurface
        </div>
        <Toggle checked={mo.visible} onChange={(v) => { setVisible(v);  }} />
      </div>
      <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
        {mo.sourceName ?? mo.sourceType}
      </p>

      {mo.moldenData && (
        <OrbitalBrowser data={mo.moldenData} selectedIndex={mo.selectedOrbitalIndex} onSelect={setSelectedOrbital} />
      )}

      <SliderRow
        label="Iso value" value={mo.isoValue} min={0.001} max={0.2} step={0.001}
        display={mo.isoValue.toFixed(3)}
        onChange={(v) => { setIsoValue(v);  }}
      />
      <SliderRow
        label="Opacity" value={mo.opacity} min={0.05} max={1} step={0.01}
        display={mo.opacity.toFixed(2)}
        onChange={(v) => { setOpacity(v);  }}
      />
      <SliderRow
        label="Resolution" value={mo.resolution} min={12} max={80} step={2}
        display={String(mo.resolution)}
        onChange={(v) => { setResolution(v);  }}
      />

      {!colorField && (
        <div className="flex items-center gap-3">
          <label className="flex flex-1 items-center justify-between text-[12px]" style={{ color: 'var(--panel-text)' }}>
            <span>Positive lobe</span>
            <input type="color" value={mo.positiveColor} onChange={(e) => setPositiveColor(e.target.value)} aria-label="Positive lobe colour" className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
          </label>
          <label className="flex flex-1 items-center justify-between text-[12px]" style={{ color: 'var(--panel-text)' }}>
            <span>Negative lobe</span>
            <input type="color" value={mo.negativeColor} onChange={(e) => setNegativeColor(e.target.value)} aria-label="Negative lobe colour" className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
          </label>
        </div>
      )}

      <div className="space-y-2 rounded-xl p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--panel-text)' }}>
            <Paintbrush className="h-3.5 w-3.5" /> Colour by field
          </span>
          {colorField ? (
            <button
              type="button"
              onClick={() => { clearColorField();  }}
              className="zatom-pressable flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
              style={{ color: 'var(--panel-text-secondary)' }}
              aria-label="Remove colour field"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="zatom-pressable rounded-md px-2 py-1 text-[11px]"
              style={{ background: 'var(--panel-accent-bg)', border: '1px solid var(--panel-accent-border)', color: 'var(--panel-accent)' }}
            >
              Attach cube…
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".cub,.cube"
            className="hidden"
            onChange={(e) => void handleAttach(e.target.files?.[0])}
          />
        </div>
        {colorField ? (
          <>
            <p className="truncate text-[10px]" style={{ color: 'var(--panel-text-secondary)' }} title={colorField.sourceName ?? undefined}>
              {colorField.sourceName ?? 'cube'}
            </p>
            <SelectRow
              label="Colormap"
              value={colorField.colormap}
              options={SURFACE_COLORMAP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(next: SurfaceColormap) => { setColormap(next);  }}
            />
            <div
              className="h-2 w-full rounded-sm"
              aria-hidden
              style={{ background: surfaceColormapGradient(colorField.colormap), border: '1px solid var(--panel-border)' }}
            />
            {COLORMAP_HINTS[colorField.colormap] && (
              <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
                {COLORMAP_HINTS[colorField.colormap]}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px]" style={{ color: 'var(--panel-text)' }}>Range</span>
              <Segmented
                ariaLabel="Colour range"
                value={colorField.range ? 'Manual' : 'Auto'}
                options={['Auto', 'Manual']}
                onChange={(mode) => {
                  if (mode === 'Auto') setColorRange(null)
                  else if (stats) setColorRange({ ...stats.range })
                }}
              />
            </div>
            {colorField.range ? (
              <div className="grid grid-cols-2 gap-2">
                <RangeInput label="Min" value={colorField.range.min} onCommit={(v) => setColorRange({ min: v, max: colorField.range!.max })} />
                <RangeInput label="Max" value={colorField.range.max} onCommit={(v) => setColorRange({ min: colorField.range!.min, max: v })} />
              </div>
            ) : stats ? (
              <p className="font-mono text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
                {formatTick(stats.range.min)} … {formatTick(stats.range.max)} (symmetric about the surface values)
              </p>
            ) : null}

            <div className="space-y-2 border-t pt-2.5" style={{ borderColor: 'var(--panel-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px]" style={{ color: 'var(--panel-text)' }}>Reference-plane field</span>
                {constructedPlane && (
                  <Toggle
                    checked={mo.fieldSlice.enabled}
                    onChange={(enabled) => {
                      setFieldSlice({ enabled })
                    }}
                  />
                )}
              </div>
              <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
                {constructedPlane
                  ? `Samples ${colorField.sourceName ?? 'the attached cube'} on the active ${constructedPlane.method.replace('-', ' ')} plane.`
                  : 'Create a reference plane from three atoms, two bonds, or Miller indices in Functions › Plane.'}
              </p>
              {constructedPlane && mo.fieldSlice.enabled && (
                <>
                  {mo.fieldSlice.mode === 'slice-only' && !currentSliceReady && (
                    <Notice tone="amber" icon={AlertCircle}>
                      {mo.fieldSliceSample.phase === 'unavailable'
                        ? mo.fieldSliceSample.failureReason === 'render-failed'
                          ? 'The plane was sampled, but its field texture could not be rendered. The isosurface remains visible.'
                          : mo.fieldSliceSample.failureReason === 'sampling-failed'
                            ? 'The attached Cube could not be sampled on this plane. The isosurface remains visible.'
                            : 'No valid field samples fall on this plane. The isosurface remains visible; rebuild or move the plane inside the Cube volume.'
                        : 'Checking this plane against the Cube volume. The isosurface stays visible until the slice is ready.'}
                    </Notice>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px]" style={{ color: 'var(--panel-text)' }}>View</span>
                    <Segmented
                      ariaLabel="Reference-plane field view"
                      value={mo.fieldSlice.mode === 'slice-only' ? 'Slice only' : 'Overlay'}
                      options={['Overlay', 'Slice only']}
                      onChange={(mode) => {
                        setFieldSlice({ mode: mode === 'Slice only' ? 'slice-only' : 'overlay' })
                      }}
                    />
                  </div>
                  {mo.fieldSlice.mode === 'overlay' && (
                    <SliderRow
                      label="Field opacity"
                      value={mo.fieldSlice.opacity}
                      min={0.1}
                      max={1}
                      step={0.01}
                      display={mo.fieldSlice.opacity.toFixed(2)}
                      onChange={(opacity) => {
                        setFieldSlice({ opacity })
                      }}
                    />
                  )}
                  <SliderRow
                    label="Contours"
                    value={mo.fieldSlice.contours}
                    min={0}
                    max={12}
                    step={1}
                    display={String(mo.fieldSlice.contours)}
                    onChange={(contours) => {
                      setFieldSlice({ contours })
                    }}
                  />
                </>
              )}
            </div>

            <label className="flex cursor-pointer items-center justify-between" title="Mark local minima and maxima of the field on the surface — ESP surface analysis style. Values are the sampled field at those vertices.">
              <span className="text-[12px]" style={{ color: 'var(--panel-text)' }}>Surface extrema</span>
              <Toggle checked={colorField.showExtrema} onChange={(v) => { setShowExtrema(v);  }} />
            </label>
            {colorField.showExtrema && stats && (
              <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
                {stats.extrema.filter((e) => e.kind === 'min').length} minima, {stats.extrema.filter((e) => e.kind === 'max').length} maxima (≥ 1.5 Å apart, strongest 8 of each).
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
            Colour this surface by a second cube — sign(λ₂)ρ over an IGMH/RDG surface, or ESP over a density surface. The surface shape stays as it is.
          </p>
        )}
        {attachError && (
          <p className="text-[10px] leading-4" style={{ color: 'var(--status-amber)' }}>Could not attach: {attachError}</p>
        )}
      </div>
    </section>
  )
}
