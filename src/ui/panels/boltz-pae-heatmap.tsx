"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { BoltzPaeMatrix } from "../../services/boltz-archive"

/** PAE heatmap for relative residue placement confidence. Canvas avoids one DOM node per matrix cell. */

/** Upper PAE color limit; values above roughly 32 Å are not meaningfully distinct. */
const PAE_CEILING_ANGSTROM = 32

/** Use a monotonic dark-to-light scale rather than a perceptually nonmonotonic rainbow. */
function paeColor(angstrom: number): [number, number, number] {
  const t = Math.min(angstrom / PAE_CEILING_ANGSTROM, 1)
  // Interpolate deep indigo to near-white.
  return [
    Math.round(30 + t * (242 - 30)),
    Math.round(42 + t * (243 - 42)),
    Math.round(120 + t * (247 - 120)),
  ]
}

export interface BoltzPaeHeatmapProps {
  matrix: BoltzPaeMatrix
  /** Chain token boundaries mark cross-chain quadrants. */
  chainSizes?: readonly { chainId: string; tokenCount: number }[]
}

export function BoltzPaeHeatmap({ matrix, chainSizes }: BoltzPaeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{ i: number; j: number; value: number } | null>(null)

  // Cumulative chain boundaries, excluding the final edge.
  const dividers = useMemo(() => {
    if (!chainSizes || chainSizes.length < 2) return []
    const result: number[] = []
    let sum = 0
    for (const chain of chainSizes.slice(0, -1)) {
      sum += chain.tokenCount
      result.push(sum)
    }
    return result
  }, [chainSizes])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return

    const n = matrix.tokenCount
    canvas.width = n
    canvas.height = n
    const image = context.createImageData(n, n)
    for (let index = 0; index < matrix.values.length; index += 1) {
      const [r, g, b] = paeColor(matrix.values[index])
      const offset = index * 4
      image.data[offset] = r
      image.data[offset + 1] = g
      image.data[offset + 2] = b
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [matrix])

  const n = matrix.tokenCount

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Predicted aligned error matrix, ${n} by ${n} tokens`}
          className="w-full rounded-lg"
          style={{
            // Disable interpolation so enlarged cells preserve individual residue errors.
            imageRendering: "pixelated",
            aspectRatio: "1 / 1",
            border: "1px solid var(--panel-border)",
          }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const i = Math.floor(((event.clientY - rect.top) / rect.height) * n)
            const j = Math.floor(((event.clientX - rect.left) / rect.width) * n)
            if (i < 0 || j < 0 || i >= n || j >= n) return setHover(null)
            setHover({ i, j, value: matrix.values[i * n + j] })
          }}
        />
        {/* Overlay chain separators outside the bitmap so line width remains constant. */}
        {dividers.map((position) => {
          const percent = `${(position / n) * 100}%`
          return (
            <span key={position} aria-hidden>
              <span
                className="pointer-events-none absolute inset-y-0"
                style={{ left: percent, width: 1, backgroundColor: "var(--panel-accent)", opacity: 0.5 }}
              />
              <span
                className="pointer-events-none absolute inset-x-0"
                style={{ top: percent, height: 1, backgroundColor: "var(--panel-accent)", opacity: 0.5 }}
              />
            </span>
          )
        })}
      </div>

      <div className="flex items-center gap-2 px-1">
        <span className="text-[9px] text-[var(--panel-text-tertiary)]">0 Å</span>
        <span
          className="h-1.5 flex-1 rounded-full"
          style={{ background: "linear-gradient(to right, #1e2a78, #f2f3f7)" }}
        />
        <span className="text-[9px] text-[var(--panel-text-tertiary)]">{PAE_CEILING_ANGSTROM}+ Å</span>
      </div>

      <p className="px-1 font-mono text-[9px] text-[var(--panel-text-tertiary)]">
        {hover
          ? `token ${hover.i + 1} ↔ ${hover.j + 1} · ${hover.value.toFixed(1)} Å`
          : `${n}×${n} tokens · darker means better-defined relative position`}
      </p>
    </div>
  )
}
