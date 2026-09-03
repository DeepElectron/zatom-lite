/** SVG overlay for a parsed molecule, rotated about its centroid and then translated. */

import type React from "react"
import { getElement } from "../../../lib/crystal/elements"
import type { Molecule2D } from "../../../lib/molecule/smiles-parser"
import { CANVAS_ACCENT, CANVAS_ANCHOR, CANVAS_MOLECULE, labelColorOn } from "./plane-canvas-theme"

type Mol2DToolMode = "select" | "add-atom" | "add-bond" | "delete" | "move-molecule"

interface MoleculeOverlayProps {
  molecule2D: Molecule2D
  insertRotation: number
  moleculeOffset: { x: number; y: number }
  mol2DToolMode: Mol2DToolMode
  mol2DSelectedAtomId: string | null
  mol2DPendingBondAtom: string | null
  multiSelectedAtomIds: Set<string>
  toScreenX: (x: number) => number
  toScreenY: (y: number) => number
  onAtomClick: (atomId: string, e: React.MouseEvent) => void
}

export function MoleculeOverlay({
  molecule2D,
  insertRotation,
  moleculeOffset,
  mol2DToolMode,
  mol2DSelectedAtomId,
  mol2DPendingBondAtom,
  multiSelectedAtomIds,
  toScreenX,
  toScreenY,
  onAtomClick,
}: MoleculeOverlayProps) {
  // Molecular centroid.
  let molCenterX = 0, molCenterY = 0
  molecule2D.atoms.forEach(a => {
    molCenterX += a.x
    molCenterY += a.y
  })
  molCenterX /= molecule2D.atoms.length
  molCenterY /= molecule2D.atoms.length

  const offsetX = moleculeOffset.x
  const offsetY = moleculeOffset.y

  // Rotate around the centroid, then apply the user offset.
  const rotRad = (insertRotation * Math.PI) / 180
  const cos = Math.cos(rotRad)
  const sin = Math.sin(rotRad)
  const rotatePoint = (x: number, y: number) => {
    const cx = x - molCenterX
    const cy = y - molCenterY
    const rx = cx * cos - cy * sin
    const ry = cx * sin + cy * cos
    return { x: rx + molCenterX + offsetX, y: ry + molCenterY + offsetY }
  }

  const isDragging = mol2DToolMode === "move-molecule"

  return (
  // Lift the overlay visually with a shadow and accent rings.
    <g style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.18))" }}>
      {/* Molecule bonds */}
      {molecule2D.bonds.map((bond, i) => {
        const a1 = molecule2D.atoms.find(a => a.id === bond.atom1Id)
        const a2 = molecule2D.atoms.find(a => a.id === bond.atom2Id)
        if (!a1 || !a2) return null

        const p1 = rotatePoint(a1.x, a1.y)
        const p2 = rotatePoint(a2.x, a2.y)
        const x1 = toScreenX(p1.x)
        const y1 = toScreenY(p1.y)
        const x2 = toScreenX(p2.x)
        const y2 = toScreenY(p2.y)

        const element1 = getElement(a1.element)
        const element2 = getElement(a2.element)
        const color1 = element1?.color || "#888"
        const color2 = element2?.color || "#888"

        if (bond.type === "double" || bond.type === "aromatic") {
          const dx = x2 - x1
          const dy = y2 - y1
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          const offset = 3
          const nx = -dy / len * offset
          const ny = dx / len * offset
          return (
            <g key={`mol-bond-${i}`}>
              <defs>
                <linearGradient id={`mol-bond-grad-${i}-a`} x1={x1 + nx} y1={y1 + ny} x2={x2 + nx} y2={y2 + ny} gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor={color1} />
                  <stop offset="100%" stopColor={color2} />
                </linearGradient>
                <linearGradient id={`mol-bond-grad-${i}-b`} x1={x1 - nx} y1={y1 - ny} x2={x2 - nx} y2={y2 - ny} gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor={color1} />
                  <stop offset="100%" stopColor={color2} />
                </linearGradient>
              </defs>
              <line x1={x1 + nx} y1={y1 + ny} x2={x2 + nx} y2={y2 + ny} stroke={`url(#mol-bond-grad-${i}-a)`} strokeWidth={2} strokeLinecap="round" />
              <line x1={x1 - nx} y1={y1 - ny} x2={x2 - nx} y2={y2 - ny} stroke={`url(#mol-bond-grad-${i}-b)`} strokeWidth={2} strokeLinecap="round" />
            </g>
          )
        }

        return (
          <g key={`mol-bond-${i}`}>
            <defs>
              <linearGradient id={`mol-bond-grad-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={color1} />
                <stop offset="100%" stopColor={color2} />
              </linearGradient>
            </defs>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={`url(#mol-bond-grad-${i})`} strokeWidth={3} strokeLinecap="round" />
          </g>
        )
      })}

      {/* Molecule atoms */}
      {molecule2D.atoms.map(atom => {
        const p = rotatePoint(atom.x, atom.y)
        const x = toScreenX(p.x)
        const y = toScreenY(p.y)
        const element = getElement(atom.element)
        const color = element?.color || "#888"
        const isSelected = mol2DSelectedAtomId === atom.id
        const isPending = mol2DPendingBondAtom === atom.id
        const isMultiSelected = multiSelectedAtomIds.has(atom.id)

        return (
          <g key={`mol-atom-${atom.id}`} onClick={(e) => onAtomClick(atom.id, e)} style={{ cursor: isDragging ? "move" : "pointer" }}>
            {/* One ring changes color for multi-select, pending bond, single-select, and molecule identity. */}
            <circle
              cx={x}
              cy={y}
              r={13}
              fill="none"
              stroke={isMultiSelected || isPending ? CANVAS_ACCENT : isSelected ? CANVAS_ANCHOR : CANVAS_MOLECULE}
              strokeWidth={isMultiSelected || isPending || isSelected || isDragging ? 2 : 1.25}
              strokeOpacity={isMultiSelected || isPending || isSelected || isDragging ? 1 : 0.75}
              style={{ transition: "stroke 0.15s" }}
            />
            <circle cx={x} cy={y} r={9.5} fill={color} stroke={CANVAS_MOLECULE} strokeWidth={1} strokeOpacity={0.45} />
            <text x={x} y={y + 3.5} textAnchor="middle" fill={labelColorOn(color)} fontSize={9} fontWeight={600} style={{ pointerEvents: "none" }}>
              {atom.element}
            </text>
          </g>
        )
      })}
    </g>
  )
}
