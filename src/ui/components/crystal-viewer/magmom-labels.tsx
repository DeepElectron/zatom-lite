'use client'

/**
 * Magnetic-moment label overlay.
 *
 * Renders a small floating "↑5.0" / "↓5.0" badge next to each atom that has a
 * non-zero `magmom` in `atomAttributes` (μB). Uses drei's <Html> billboard so
 * the labels always face the camera. Spin direction by sign:
 *   - up   (magmom > 0) → red  (#e11d48), ↑
 *   - down (magmom < 0) → blue (#2563eb), ↓
 * Atoms with magmom 0 / undefined get no badge. Returns null when the
 * `showMagmomLabels` toggle is off.
 */

import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { getElement, applyRadiusVariance } from '../../../lib/crystal/elements'

export function MagmomLabels() {
  const showMagmomLabels = useCrystalStore((s) => s.showMagmomLabels)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const atoms = useCrystalStore((s) => s.atoms)
  const elementRadiusVariance = useCrystalStore((s) => s.elementRadiusVariance)
  const atomScale = useCrystalStore((s) => s.atomScale)

  const labeledAtoms = useMemo(() => {
    if (!showMagmomLabels) return []
    const out: { id: string; pos: [number, number, number]; magmom: number; offset: number }[] = []
    for (const atom of atoms) {
      const attrs = atomAttributes[atom.id]
      if (!attrs || typeof attrs.magmom !== 'number' || attrs.magmom === 0) continue
      const pos = atom.cartesian ?? atom.position
      if (!pos) continue
      const r = applyRadiusVariance(getElement(atom.element).radius, elementRadiusVariance) * 0.5 * atomScale
      out.push({ id: atom.id, pos: [pos[0], pos[1], pos[2]], magmom: attrs.magmom, offset: r + 0.25 })
    }
    return out
  }, [showMagmomLabels, atomAttributes, atoms, elementRadiusVariance, atomScale])

  if (!showMagmomLabels || labeledAtoms.length === 0) return null

  return (
    <group>
      {labeledAtoms.map(({ id, pos, magmom, offset }) => {
        const up = magmom > 0
        const color = up ? '#e11d48' : '#2563eb'
        return (
          <group key={id} position={[pos[0], pos[1] + offset, pos[2]]}>
            <Html
              center
              distanceFactor={8}
              style={{
                pointerEvents: 'none',
                userSelect: 'none',
                fontSize: 12,
                fontWeight: 600,
                color: '#ffffff',
                backgroundColor: color,
                padding: '2px 6px',
                borderRadius: 6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                whiteSpace: 'nowrap',
                lineHeight: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            >
              {up ? '↑' : '↓'}{Math.abs(magmom).toFixed(1)}
            </Html>
          </group>
        )
      })}
    </group>
  )
}
