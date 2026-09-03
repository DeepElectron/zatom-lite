/** Lightweight SVG layers for the 2D plane view, using only plane-canvas-theme colors. */

import { getElement } from "../../../lib/crystal/elements"
import type { DynamicConnections, ProjectedAtom, ProjectedBondLine, ProjectedLatticeEdge, SnapPoint } from "../../../lib/plane/plane-projection"
import { CANVAS_ACCENT, CANVAS_INK, STRUCTURE_OPACITY, labelColorOn } from "./plane-canvas-theme"

/** Loose hovered-snap shape; hover identity compares only x and y. */
interface HoveredSnapPoint {
  x: number
  y: number
  x3d: number
  y3d: number
  z3d: number
  type: string
}

/** Shared pending-atom preview for dynamic and snap-point layers. */
function SnapPointPreview({ screenX, screenY, element }: { screenX: number; screenY: number; element: string }) {
  const color = getElement(element)?.color || "#888"
  return (
    <>
      <circle
        cx={screenX}
        cy={screenY}
        r={11}
        fill={color}
        fillOpacity={0.55}
        stroke={CANVAS_ACCENT}
        strokeWidth={1.5}
        strokeDasharray="3 3"
        style={{ pointerEvents: "none" }}
      />
      <text
        x={screenX}
        y={screenY + 3.5}
        textAnchor="middle"
        fill={labelColorOn(color)}
        fontSize={9}
        fontWeight={600}
        style={{ pointerEvents: "none" }}
      >
        {element}
      </text>
    </>
  )
}

interface PlaneCanvasSubstrateProps {
  size: number
}

/** Fine grid, edge fade, and inset outline establish scale without competing with data. */
export function PlaneCanvasSubstrate({ size }: PlaneCanvasSubstrateProps) {
  return (
    <>
      <defs>
        <pattern id="plane-substrate-dots" width={16} height={16} patternUnits="userSpaceOnUse">
          <circle cx={0.75} cy={0.75} r={0.75} fill={CANVAS_INK} fillOpacity={0.16} />
        </pattern>
        <radialGradient id="plane-substrate-fade" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#000" stopOpacity={1} />
          <stop offset="100%" stopColor="#000" stopOpacity={0} />
        </radialGradient>
        <mask id="plane-substrate-mask">
          <rect width={size} height={size} fill="url(#plane-substrate-fade)" />
        </mask>
      </defs>
      <rect
        width={size}
        height={size}
        fill="url(#plane-substrate-dots)"
        mask="url(#plane-substrate-mask)"
        style={{ pointerEvents: "none" }}
      />
      <rect
        x={0.5}
        y={0.5}
        width={size - 1}
        height={size - 1}
        rx={11.5}
        fill="none"
        stroke={CANVAS_INK}
        strokeOpacity={0.08}
        style={{ pointerEvents: "none" }}
      />
    </>
  )
}

interface LatticeEdgesLayerProps {
  edges: ProjectedLatticeEdge[]
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
}

/** Lattice edges use weight and opacity, rather than color or dashes, to show depth. */
export function LatticeEdgesLayer({ edges, toScreenX, toScreenY }: LatticeEdgesLayerProps) {
  return (
    <>
      {edges.map((edge, i) => (
        <line
          key={`lattice-${i}`}
          x1={toScreenX(edge.x1)}
          y1={toScreenY(edge.y1)}
          x2={toScreenX(edge.x2)}
          y2={toScreenY(edge.y2)}
          stroke={CANVAS_INK}
          strokeWidth={edge.onPlane ? 1 : 0.75}
          strokeOpacity={edge.onPlane ? STRUCTURE_OPACITY.latticeOnPlane : STRUCTURE_OPACITY.latticeOffPlane}
        />
      ))}
    </>
  )
}

interface BondsOnPlaneLayerProps {
  bonds: ProjectedBondLine[]
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
}

/** Render in-plane bonds in neutral ink because they are structure, not emphasis. */
export function BondsOnPlaneLayer({ bonds, toScreenX, toScreenY }: BondsOnPlaneLayerProps) {
  return (
    <>
      {bonds.map((bond, i) => (
        <line
          key={`bond-${i}`}
          x1={toScreenX(bond.x1)}
          y1={toScreenY(bond.y1)}
          x2={toScreenX(bond.x2)}
          y2={toScreenY(bond.y2)}
          stroke={CANVAS_INK}
          strokeWidth={2.5}
          strokeOpacity={STRUCTURE_OPACITY.bond}
          strokeLinecap="round"
        />
      ))}
    </>
  )
}

interface OffPlaneAtomsLayerProps {
  positive: ProjectedAtom[]
  negative: ProjectedAtom[]
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
}

/** Distinguish off-plane sides by solid versus hollow marks instead of extra hues. */
export function OffPlaneAtomsLayer({ positive, negative, toScreenX, toScreenY }: OffPlaneAtomsLayerProps) {
  return (
    <>
      {positive.map(atom => (
        <circle
          key={atom.id}
          cx={toScreenX(atom.x)}
          cy={toScreenY(atom.y)}
          r={4}
          fill={CANVAS_INK}
          fillOpacity={0.28}
        />
      ))}
      {negative.map(atom => (
        <circle
          key={atom.id}
          cx={toScreenX(atom.x)}
          cy={toScreenY(atom.y)}
          r={4}
          fill="none"
          stroke={CANVAS_INK}
          strokeWidth={1}
          strokeOpacity={0.3}
        />
      ))}
    </>
  )
}

interface DynamicConnectionsLayerProps {
  dynamicConnections: DynamicConnections
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
  hoveredSnapPoint: HoveredSnapPoint | null
  isAddAtomMode: boolean
  selectedElement: string
  onConnectionAreaEnter: () => void
  onConnectionAreaLeave: () => void
  onSetHoveredSnapPoint: (point: HoveredSnapPoint | null) => void
  onSnapPointClick: (point: { x3d: number; y3d: number; z3d: number }) => void
}

/**
 * Candidate directions combine a wide invisible hit area, a dashed guide, and
 * snap points so hover remains stable while the pointer follows the line.
 */
export function DynamicConnectionsLayer({
  dynamicConnections,
  toScreenX,
  toScreenY,
  hoveredSnapPoint,
  isAddAtomMode,
  selectedElement,
  onConnectionAreaEnter,
  onConnectionAreaLeave,
  onSetHoveredSnapPoint,
  onSnapPointClick,
}: DynamicConnectionsLayerProps) {
  if (dynamicConnections.lines.length === 0) return null
  return (
    <g onMouseEnter={onConnectionAreaEnter} onMouseLeave={onConnectionAreaLeave}>
      {/* Invisible wider lines for easier hover detection */}
      {dynamicConnections.lines.map((line, i) => (
        <line
          key={`dyn-line-hit-${i}`}
          x1={toScreenX(line.x1)}
          y1={toScreenY(line.y1)}
          x2={toScreenX(line.x2)}
          y2={toScreenY(line.y2)}
          stroke="transparent"
          strokeWidth={16}
          style={{ cursor: "crosshair" }}
        />
      ))}
      {/* Visible lines */}
      {dynamicConnections.lines.map((line, i) => (
        <line
          key={`dyn-line-${i}`}
          x1={toScreenX(line.x1)}
          y1={toScreenY(line.y1)}
          x2={toScreenX(line.x2)}
          y2={toScreenY(line.y2)}
          stroke={CANVAS_ACCENT}
          strokeWidth={1.25}
          strokeOpacity={0.7}
          strokeDasharray="4 4"
          style={{ pointerEvents: "none" }}
        />
      ))}
      {/* Dynamic snap points on connection lines */}
      {dynamicConnections.snapPoints.map((point, i) => {
        const screenX = toScreenX(point.x)
        const screenY = toScreenY(point.y)
        const isHovered = hoveredSnapPoint?.x === point.x && hoveredSnapPoint?.y === point.y
        return (
          <g key={`dyn-snap-${i}`}>
            {/* Hover area */}
            <circle
              cx={screenX}
              cy={screenY}
              r={14}
              fill="transparent"
              style={{ cursor: isAddAtomMode ? "pointer" : "default" }}
              onMouseEnter={() => {
                onConnectionAreaEnter()
                onSetHoveredSnapPoint(point)
              }}
              onMouseLeave={() => onSetHoveredSnapPoint(null)}
              onClick={() => onSnapPointClick(point)}
            />
            {/* Visible point */}
            {!isHovered && (
              <circle
                cx={screenX}
                cy={screenY}
                r={3}
                fill={CANVAS_ACCENT}
                fillOpacity={0.85}
                style={{ pointerEvents: "none" }}
              />
            )}
            {/* Preview */}
            {isHovered && isAddAtomMode && (
              <SnapPointPreview screenX={screenX} screenY={screenY} element={selectedElement} />
            )}
            {isHovered && !isAddAtomMode && (
              <circle
                cx={screenX}
                cy={screenY}
                r={5}
                fill={CANVAS_ACCENT}
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

interface SnapPointsLayerProps {
  snapPoints: SnapPoint[]
  enabled: boolean
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
  hoveredSnapPoint: HoveredSnapPoint | null
  isAddAtomMode: boolean
  selectedElement: string
  onSetHoveredSnapPoint: (point: HoveredSnapPoint | null) => void
  onSnapPointClick: (point: { x3d: number; y3d: number; z3d: number }) => void
}

/** Use one accent hue and encode snap types by ring, diamond, dot, or crosshair. */
function SnapMark({ type, x, y, emphasized }: { type: string; x: number; y: number; emphasized: boolean }) {
  const opacity = emphasized ? 1 : 0.55
  const common = { style: { pointerEvents: "none" as const }, opacity }

  if (type === "atom") {
    return <circle cx={x} cy={y} r={emphasized ? 7 : 5.5} fill="none" stroke={CANVAS_ACCENT} strokeWidth={1.5} {...common} />
  }
  if (type === "intersection") {
    const r = emphasized ? 5 : 3.5
    return (
      <path
        d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
        fill={CANVAS_ACCENT}
        {...common}
      />
    )
  }
  if (type === "lattice") {
    const r = emphasized ? 5 : 3.5
    return (
      <g {...common}>
        <line x1={x - r} y1={y} x2={x + r} y2={y} stroke={CANVAS_ACCENT} strokeWidth={1} />
        <line x1={x} y1={y - r} x2={x} y2={y + r} stroke={CANVAS_ACCENT} strokeWidth={1} />
      </g>
    )
  }
  // Bonds and unknown types use a solid dot.
  return <circle cx={x} cy={y} r={emphasized ? 4.5 : 3} fill={CANVAS_ACCENT} {...common} />
}

export function SnapPointsLayer({
  snapPoints,
  enabled,
  toScreenX,
  toScreenY,
  hoveredSnapPoint,
  isAddAtomMode,
  selectedElement,
  onSetHoveredSnapPoint,
  onSnapPointClick,
}: SnapPointsLayerProps) {
  if (!enabled) return null
  return (
    <>
      {snapPoints.map((point, i) => {
        const screenX = toScreenX(point.x)
        const screenY = toScreenY(point.y)
        const isHovered = hoveredSnapPoint?.x === point.x && hoveredSnapPoint?.y === point.y

        return (
          <g key={`snap-${i}`}>
            {/* Hover area (larger, invisible) */}
            <circle
              cx={screenX}
              cy={screenY}
              r={12}
              fill="transparent"
              style={{ cursor: isAddAtomMode ? "pointer" : "default" }}
              onMouseEnter={() => onSetHoveredSnapPoint(point)}
              onMouseLeave={() => onSetHoveredSnapPoint(null)}
              onClick={() => onSnapPointClick(point)}
            />
            {/* In add-atom mode, the hovered mark yields to the atom preview. */}
            {isHovered && isAddAtomMode ? (
              <SnapPointPreview screenX={screenX} screenY={screenY} element={selectedElement} />
            ) : (
              <SnapMark type={point.type} x={screenX} y={screenY} emphasized={isHovered} />
            )}
          </g>
        )
      })}
    </>
  )
}
