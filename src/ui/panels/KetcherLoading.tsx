/** Single opaque loading layer for Ketcher, using a benzene-ring animation. */

import './KetcherLoading.css'

// Point-up regular hexagon centered at (50, 50) with radius 30.
const HEX = 'M50 20 L75.98 35 L75.98 65 L50 80 L24.02 65 L24.02 35 Z'
const VERTICES: ReadonlyArray<readonly [number, number]> = [
  [50, 20],
  [75.98, 35],
  [75.98, 65],
  [50, 80],
  [24.02, 65],
  [24.02, 35],
]

interface KetcherLoadingProps {
  label?: string
}

export function KetcherLoading({ label = 'Initializing chemistry engine…' }: KetcherLoadingProps) {
  return (
    <div className="ketl-root" role="status" aria-live="polite">
      <svg className="ketl-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* aromatic ring (breathing) */}
        <circle className="ketl-aromatic" cx="50" cy="50" r="13" />
        {/* faint base hexagon */}
        <path className="ketl-base" d={HEX} />
        {/* bright comet tracing the ring */}
        <path className="ketl-trace" d={HEX} />
        {/* vertex atoms */}
        {VERTICES.map(([cx, cy], i) => (
          <circle key={i} className={`ketl-atom ketl-atom-${i}`} cx={cx} cy={cy} r="4.5" />
        ))}
      </svg>
      <span className="ketl-label">{label}</span>
    </div>
  )
}
