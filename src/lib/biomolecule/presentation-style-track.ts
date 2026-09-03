import type { ViewMode } from '../crystal/types'
import type {
  PolyhedronColorSource,
  PolyhedronStyle,
  RenderStyle,
} from '../render/crystal-visuals'
import type { BioStyleEasing } from './types'

/**
 * The global visual state that is meaningful on a presentation timeline.
 * Every key stores a complete snapshot: later edits to the live visual panel
 * therefore cannot silently change an already recorded presentation.
 */
export interface PresentationStyleSnapshot {
  renderStyle: RenderStyle
  background: string
  outline: boolean
  outlineWidth: number
  outlineColor: string
  atomShininess: number
  bondBicolor: boolean
  bondColor: string
  elementRadiusVariance: number
  showCoordinationPolyhedra: boolean
  polyhedraOpacity: number
  polyStyle: PolyhedronStyle
  polyColorSource: PolyhedronColorSource
  polyElementColors: Record<string, string>
  polyColor: string
  showPolyEdges: boolean
  polyEdgeColor: string
  polyEdgeOpacity: number
  polySpecular: number
  polyShininess: number
  polyFresnel: number
  cellColor: string
  cellLineWidth: number
  showCellGrid: boolean
  showCrystalAxes: boolean
  ambientIntensity: number
  diffuseIntensity: number
  specularIntensity: number
  rimIntensity: number
  viewMode: ViewMode
  /** Source geometry fields remain independent of target renderer scale fields. */
  radiusScale: number
  bondRadius: number
  atomScale: number
  bondScale: number
  showBonds: boolean
  showLattice: boolean
  lightAmbient: number | null
  lightKey: number | null
  lightFill: number | null
  lightAzimuth: number | null
  lightElevation: number | null
}

export interface PresentationStyleKeyframe {
  id: string
  frame: number
  snapshot: PresentationStyleSnapshot
  /** Easing used while leaving this keyframe. */
  easing: BioStyleEasing
}

const NUMERIC_FIELDS = [
  'outlineWidth',
  'atomShininess',
  'elementRadiusVariance',
  'polyhedraOpacity',
  'polyEdgeOpacity',
  'polySpecular',
  'polyShininess',
  'polyFresnel',
  'cellLineWidth',
  'ambientIntensity',
  'diffuseIntensity',
  'specularIntensity',
  'rimIntensity',
  'radiusScale',
  'bondRadius',
  'atomScale',
  'bondScale',
] as const

const NULLABLE_NUMERIC_FIELDS = [
  'lightAmbient',
  'lightKey',
  'lightFill',
  'lightAzimuth',
  'lightElevation',
] as const

function eased(amount: number, easing: BioStyleEasing): number {
  if (easing === 'hold') return 0
  if (easing === 'smooth') return amount * amount * (3 - 2 * amount)
  return amount
}

function copySnapshot(snapshot: PresentationStyleSnapshot): PresentationStyleSnapshot {
  return { ...snapshot, polyElementColors: { ...snapshot.polyElementColors } }
}

export function evaluatePresentationStyleTrack(
  track: readonly PresentationStyleKeyframe[] | undefined,
  frame: number,
): PresentationStyleSnapshot | null {
  if (!track?.length || !Number.isFinite(frame)) return null
  const keys = [...track].sort((left, right) => left.frame - right.frame)
  if (frame <= keys[0].frame) return copySnapshot(keys[0].snapshot)
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return copySnapshot(last.snapshot)

  let source = keys[0]
  let destination = keys[1]
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (frame >= keys[index].frame && frame < keys[index + 1].frame) {
      source = keys[index]
      destination = keys[index + 1]
      break
    }
  }

  const span = Math.max(destination.frame - source.frame, 1e-6)
  const amount = eased((frame - source.frame) / span, source.easing)
  const snapshot = copySnapshot(source.snapshot)
  for (const field of NUMERIC_FIELDS) {
    snapshot[field] = source.snapshot[field]
      + (destination.snapshot[field] - source.snapshot[field]) * amount
  }
  for (const field of NULLABLE_NUMERIC_FIELDS) {
    const left = source.snapshot[field]
    const right = destination.snapshot[field]
    snapshot[field] = left === null || right === null
      ? left
      : left + (right - left) * amount
  }
  return snapshot
}

export function upsertPresentationStyleKeyframe(
  track: readonly PresentationStyleKeyframe[] | undefined,
  keyframe: Omit<PresentationStyleKeyframe, 'id'>,
  makeId: () => string,
): PresentationStyleKeyframe[] {
  return [
    ...(track ?? []).filter((candidate) => candidate.frame !== keyframe.frame),
    { ...keyframe, snapshot: copySnapshot(keyframe.snapshot), id: makeId() },
  ].sort((left, right) => left.frame - right.frame)
}

export function removePresentationStyleKeyframe(
  track: readonly PresentationStyleKeyframe[] | undefined,
  frame: number,
): PresentationStyleKeyframe[] {
  return (track ?? []).filter((keyframe) => keyframe.frame !== frame)
}
