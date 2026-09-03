'use client'

/** Render persistent bond annotations and transient contact candidates. */
import { useMemo } from 'react'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import type { BondAnnotation } from '../../../orchestration/crystal-store-types'
import { detectGenericContactCandidates } from '../../../lib/analysis/contact-candidates'
import { CandidateDashGroup } from './biomolecule-layer'
import { ViewerLabelSprite } from './viewer-label-sprite'

const ANNOTATION_COLOR: Record<BondAnnotation['kind'], string> = {
  'custom': '#2dd4bf',
  'hydrogen-bond': '#38bdf8',
  'salt-bridge': '#f59e0b',
}

interface ResolvedAnnotation {
  id: string
  kind: BondAnnotation['kind']
  start: [number, number, number]
  end: [number, number, number]
  distance: number
}

export function GenericContactLayer() {
  const active = useCrystalStore((s) => s.toolMode === 'add-bond' && s.bondToolSubmode === 'contacts')
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)

  const contacts = useMemo(() => {
    if (!active || bioStructure) return []
    if (atoms.length > 50_000) return []
    return detectGenericContactCandidates(atoms, bonds, selectedAtomIds)
  }, [active, atoms, bioStructure, bonds, selectedAtomIds])

  if (contacts.length === 0) return null

  return (
    <group name="generic-contacts">
      <CandidateDashGroup items={contacts} color="#38bdf8" />
      {contacts.slice(0, 120).map((item, index) => (
        <ViewerLabelSprite
          key={`contact-${index}`}
          item={{
            text: `${item.distance.toFixed(2)}Å`,
            position: [
              (item.start[0] + item.end[0]) / 2,
              (item.start[1] + item.end[1]) / 2,
              (item.start[2] + item.end[2]) / 2,
            ],
            scale: 1,
            bold: true,
            color: '#38bdf8',
          }}
          baseSize={0.5}
          outlineColor="#ffffff"
        />
      ))}
    </group>
  )
}

export function BondAnnotationLayer() {
  const annotations = useCrystalStore((s) => s.bondAnnotations)
  const atoms = useCrystalStore((s) => s.atoms)
  const bioStructure = useCrystalStore((s) => s.bioStructure)

  const resolved = useMemo<ResolvedAnnotation[]>(() => {
    if (annotations.length === 0) return []
    const positionById = new Map<string, [number, number, number]>()
    for (const atom of atoms) {
      if (atom.cartesian) positionById.set(atom.id, atom.cartesian)
    }
    if (bioStructure) {
      for (const atom of bioStructure.atoms) {
        positionById.set(atom.id, atom.position as [number, number, number])
      }
    }
    const items: ResolvedAnnotation[] = []
    for (const annotation of annotations) {
      const start = positionById.get(annotation.atomId1)
      const end = positionById.get(annotation.atomId2)
      if (!start || !end) continue
      items.push({
        id: annotation.id,
        kind: annotation.kind,
        start,
        end,
        distance: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
      })
    }
    return items
  }, [annotations, atoms, bioStructure])

  const grouped = useMemo(() => {
    const result = new Map<BondAnnotation['kind'], ResolvedAnnotation[]>()
    for (const item of resolved) {
      const bucket = result.get(item.kind)
      if (bucket) bucket.push(item)
      else result.set(item.kind, [item])
    }
    return result
  }, [resolved])

  if (resolved.length === 0) return null

  return (
    <group name="bond-annotations">
      {[...grouped].map(([kind, items]) => (
        <CandidateDashGroup key={kind} items={items} color={ANNOTATION_COLOR[kind]} />
      ))}
      {resolved.map((item) => (
        <ViewerLabelSprite
          key={item.id}
          item={{
            text: `${item.distance.toFixed(2)}Å`,
            position: [
              (item.start[0] + item.end[0]) / 2,
              (item.start[1] + item.end[1]) / 2,
              (item.start[2] + item.end[2]) / 2,
            ],
            scale: 1,
            bold: true,
            color: ANNOTATION_COLOR[item.kind],
          }}
          baseSize={0.6}
          outlineColor="#ffffff"
        />
      ))}
    </group>
  )
}
