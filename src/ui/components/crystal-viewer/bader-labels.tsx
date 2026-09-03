'use client'

/**
 * Bader-charge label overlay.
 *
 * Renders a small floating "+0.42" / "-1.34" label adjacent to each atom that
 * has a `bader_charge` in `atomAttributes`. Uses drei's <Html> billboard so
 * the labels always face the camera and stay legible at any zoom.
 *
 * Color convention:
 *   - positive charge (electron-deficient) → red (#e11d48)
 *   - negative charge (electron-rich)      → blue (#2563eb)
 *
 * Returns null when `showBaderLabels` is false.
 */

import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { getElement, applyRadiusVariance } from '../../../lib/crystal/elements'

export function BaderLabels() {
  const showBaderLabels = useCrystalStore((s) => s.showBaderLabels)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const atoms = useCrystalStore((s) => s.atoms)
  const elementRadiusVariance = useCrystalStore((s) => s.elementRadiusVariance)
  const atomScale = useCrystalStore((s) => s.atomScale)

  const labeledAtoms = useMemo(() => {
    if (!showBaderLabels) return []
    const out: { id: string; pos: [number, number, number]; charge: number; offset: number }[] = []
    for (const atom of atoms) {
      const attrs = atomAttributes[atom.id]
      if (!attrs || typeof attrs.bader_charge !== 'number') continue
      const pos = atom.cartesian ?? atom.position
      if (!pos) continue
      const r = applyRadiusVariance(getElement(atom.element).radius, elementRadiusVariance) * 0.5 * atomScale
      out.push({ id: atom.id, pos: [pos[0], pos[1], pos[2]], charge: attrs.bader_charge, offset: r + 0.25 })
    }
    return out
  }, [showBaderLabels, atomAttributes, atoms, elementRadiusVariance, atomScale])

  if (!showBaderLabels || labeledAtoms.length === 0) return null

  return (
    <group>
      {labeledAtoms.map(({ id, pos, charge, offset }) => {
        const color = charge >= 0 ? '#e11d48' : '#2563eb'
        const sign = charge >= 0 ? '+' : ''
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
              {sign}{charge.toFixed(2)}
            </Html>
          </group>
        )
      })}
    </group>
  )
}
