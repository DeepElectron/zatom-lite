/**
 * SVG atoms for the plane view. Atom size stays constant; an outer ring alone
 * communicates source and hover state to avoid visual noise in dense scenes.
 */

import { getElement } from "../../../lib/crystal/elements"
import type { ProjectedAtom, ProjectedMirrorAtom } from "../../../lib/plane/plane-projection"
import { CANVAS_ACCENT, CANVAS_ANCHOR, CANVAS_INK, labelColorOn } from "./plane-canvas-theme"

interface AtomsOnPlaneLayerProps {
  onPlane: ProjectedAtom[]
/** Display-only periodic image; interaction remains attached to the source atom. */
  mirrors?: ProjectedMirrorAtom[]
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
  hoveredAtomId: string | null
  isAddAtomMode: boolean
  /** Dim lattice atoms while the molecule overlay is present to separate the layers. */
  recede?: boolean
  onAtomEnter: (atomId: string) => void
  onAtomLeave: () => void
}

export function AtomsOnPlaneLayer({
  onPlane,
  mirrors = [],
  toScreenX,
  toScreenY,
  hoveredAtomId,
  isAddAtomMode,
  recede = false,
  onAtomEnter,
  onAtomLeave,
}: AtomsOnPlaneLayerProps) {
  return (
    <g opacity={recede ? 0.3 : 1} style={{ transition: "opacity 0.18s" }}>
          {/* Draw non-interactive periodic images first so solid source atoms remain legible. */}
      {mirrors.map((mirror, i) => {
        const element = getElement(mirror.element)
        const color = element?.color || "#888"
        const cx = toScreenX(mirror.x)
        const cy = toScreenY(mirror.y)
        return (
          <g key={`mirror-${mirror.sourceId}-${i}`} style={{ pointerEvents: "none" }}>
            <circle
              cx={cx}
              cy={cy}
              r={10}
              fill={color}
              fillOpacity={0.25}
              stroke={CANVAS_INK}
              strokeWidth={1}
              strokeOpacity={0.5}
              strokeDasharray="3 2"
            />
            <text
              x={cx}
              y={cy + 3.5}
              textAnchor="middle"
              fill={CANVAS_INK}
              fillOpacity={0.55}
              fontSize={9}
              fontWeight={600}
            >
              {mirror.element}
            </text>
          </g>
        )
      })}
      {onPlane.map(atom => {
        const element = getElement(atom.element)
        const color = element?.color || "#888"
        const cx = toScreenX(atom.x)
        const cy = toScreenY(atom.y)
        const isSelected = atom.isSelected
        const isHoveredAtom = hoveredAtomId === atom.id
        const isSource = atom.isSourceAtom === true

        // One mutually exclusive state ring: hover wins, then source, then selection.
        const ringColor = isHoveredAtom ? CANVAS_ACCENT : isSource ? CANVAS_ANCHOR : isSelected ? CANVAS_INK : null

        return (
          <g key={atom.id}>
            {/* Hover area for triggering connection lines */}
            {isAddAtomMode && (
              <circle
                cx={cx}
                cy={cy}
                r={20}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onAtomEnter(atom.id)}
                onMouseLeave={onAtomLeave}
              />
            )}
            {/* A two-pixel gap separates the state indicator from atom geometry. */}
            {ringColor && (
              <circle
                cx={cx}
                cy={cy}
                r={13}
                fill="none"
                stroke={ringColor}
                strokeWidth={isSelected && !isHoveredAtom && !isSource ? 1 : 1.75}
                strokeOpacity={isSelected && !isHoveredAtom && !isSource ? 0.5 : 1}
                style={{ pointerEvents: "none", transition: "stroke 0.15s" }}
              />
            )}
            {/* Constant-size atom with a faint edge that remains visible on light backgrounds. */}
            <circle
              cx={cx}
              cy={cy}
              r={10}
              fill={color}
              stroke={CANVAS_INK}
              strokeWidth={1}
              strokeOpacity={0.35}
              style={{ pointerEvents: "none" }}
            />
            {/* Label */}
            <text
              x={cx}
              y={cy + 3.5}
              textAnchor="middle"
              fill={labelColorOn(color)}
              fontSize={9}
              fontWeight={600}
              style={{ pointerEvents: "none" }}
            >
              {atom.element}
            </text>
          </g>
        )
      })}
    </g>
  )
}
