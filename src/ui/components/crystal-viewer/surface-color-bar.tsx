/**
 * Colour bar for a field-coloured isosurface. A 2D overlay that sits beside
 * the Canvas (not inside it), so it stays crisp at any DPR and is unaffected
 * by camera moves.
 *
 * Reads the effective range published by the orbital layer; if the user set a
 * manual range narrower than the data, the raw min/max are shown as small
 * "clipped" hints so a saturated surface is not mistaken for a flat one.
 */
import { useMemo } from 'react'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { sampleColormap } from '../../../lib/molecular-orbitals/surface-coloring'

const STEPS = 24

function formatTick(value: number) {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs < 0.01 || abs >= 1000) return value.toExponential(1)
  return value.toFixed(abs < 1 ? 3 : 2)
}

export function SurfaceColorBar() {
  const colorField = useCrystalStore((s) => s.molecularOrbital.colorField)
  const stats = useCrystalStore((s) => s.molecularOrbital.colorFieldStats)
  const visible = useCrystalStore((s) => s.molecularOrbital.visible)

  const gradient = useMemo(() => {
    if (!colorField) return ''
    const stops: string[] = []
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const [r, g, b] = sampleColormap(colorField.colormap, t)
      stops.push(`rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}) ${(t * 100).toFixed(1)}%`)
    }
    // Vertical bar: max at top, min at bottom.
    return `linear-gradient(to top, ${stops.join(', ')})`
  }, [colorField])

  if (!visible || !colorField || !stats) return null

  const { range, sampled } = stats
  const mid = (range.min + range.max) / 2
  const clippedLow = sampled.min < range.min - Math.abs(range.max - range.min) * 1e-3
  const clippedHigh = sampled.max > range.max + Math.abs(range.max - range.min) * 1e-3
  const label = colorField.sourceName ?? 'Colour field'

  return (
    <div
      className="absolute top-1/2 z-10 flex -translate-y-1/2 items-stretch gap-2"
      style={{
        // The canvas spans the full shell; the inspector floats over its right edge.
        right: 'calc(var(--viewport-chrome-right, 0px) + 16px)',
        pointerEvents: 'none',
      }}
      role="img"
      aria-label={`Colour scale for ${label}: ${formatTick(range.min)} to ${formatTick(range.max)}`}
    >
      <div className="flex flex-col justify-between text-right font-mono" style={{ fontSize: 10, color: 'var(--panel-text)', minWidth: 44 }}>
        <span>{clippedHigh ? '≥ ' : ''}{formatTick(range.max)}</span>
        <span>{formatTick(mid)}</span>
        <span>{clippedLow ? '≤ ' : ''}{formatTick(range.min)}</span>
      </div>
      <div className="w-3" style={{ height: 160, background: gradient, border: '1px solid var(--panel-text)' }} />
      <div
        className="flex items-center"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, color: 'var(--panel-text)', maxHeight: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={label}
      >
        {label}
      </div>
    </div>
  )
}
