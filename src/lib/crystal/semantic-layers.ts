import type { Atom, Bond, SupercellParams, ViewMode } from './types'
import { evaluateCrystalLayerSelectionDsl } from './layer-selection'
import type { BioLayerShadingOverride } from '../biomolecule/types'
import type { BioStyleEasing } from '../biomolecule/types'
import {
  snapshotLayerShading,
  type LayerShadingSnapshotContext,
} from '../biomolecule/shading'

export type CrystalLayerColor =
  | { mode: 'element' }
  | { mode: 'custom'; value: string }

/** Crystal-only geometric presentations in addition to the canonical atom modes. */
export type CrystalLayerRepresentation = ViewMode | 'stick' | 'polyhedra' | 'surface'

/**
 * A crystal semantic layer is a presentation-only view over the canonical
 * Atom[]/Bond[] document. Its selection uses the existing numeric/element
 * expression language; biomolecular residue syntax is deliberately separate.
 */
export interface CrystalLayer {
  id: string
  name: string
  selection: string
  representation: CrystalLayerRepresentation
  color: CrystalLayerColor
  materialPresetId: string | null
  shading: BioLayerShadingOverride | null
  visible: boolean
  opacity: number
  scale: number
  bondScale: number
  replaceBase: boolean
  styleTrack?: CrystalLayerStyleKeyframe[]
}

export interface CrystalLayerStylePatch {
  representation?: CrystalLayerRepresentation
  color?: CrystalLayerColor
  shading?: BioLayerShadingOverride | null
  visible?: boolean
  opacity?: number
  scale?: number
  bondScale?: number
}

export interface CrystalLayerStyleKeyframe {
  id: string
  frame: number
  patch: CrystalLayerStylePatch
  easing: BioStyleEasing
  presetId?: string
}

type SnapshotCrystalLayer = Pick<
  CrystalLayer,
  'representation' | 'color' | 'shading' | 'opacity' | 'scale' | 'bondScale'
>

/** Record one complete effective crystal-layer style, dereferencing material inheritance. */
export function snapshotCrystalLayerStyle(
  layer: SnapshotCrystalLayer,
  context: LayerShadingSnapshotContext,
): CrystalLayerStylePatch {
  return {
    representation: layer.representation,
    color: { ...layer.color },
    shading: snapshotLayerShading(layer.shading, context),
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
  }
}

export interface EvaluatedCrystalLayerStyle {
  representation: CrystalLayerRepresentation
  color: CrystalLayerColor
  shading: BioLayerShadingOverride | null
  visible: boolean
  opacity: number
  scale: number
  bondScale: number
}

/**
 * Materialize a WYSIWYG edit into a complete keyframe snapshot. A complete
 * patch prevents later static layer edits from leaking backwards into keys
 * that did not happen to mention the same channel.
 */
export function materializeCrystalLayerStyleEdit(
  current: EvaluatedCrystalLayerStyle,
  edit: Partial<SnapshotCrystalLayer>,
  context: LayerShadingSnapshotContext,
): CrystalLayerStylePatch {
  return snapshotCrystalLayerStyle({
    representation: edit.representation ?? current.representation,
    color: edit.color ?? current.color,
    shading: edit.shading === undefined ? current.shading : edit.shading,
    opacity: edit.opacity ?? current.opacity,
    scale: edit.scale ?? current.scale,
    bondScale: edit.bondScale ?? current.bondScale,
  }, context)
}

const smoothstep = (value: number) => value * value * (3 - 2 * value)
const lerp = (left: number, right: number, amount: number) => left + (right - left) * amount

function effectiveKeyShading(
  layer: CrystalLayer,
  keyframe: CrystalLayerStyleKeyframe,
  context: LayerShadingSnapshotContext,
): Required<BioLayerShadingOverride> {
  const keyShading = keyframe.patch.shading === undefined
    ? layer.shading
    : keyframe.patch.shading
  return snapshotLayerShading(keyShading, context)
}

function keyStyle(
  layer: CrystalLayer,
  keyframe: CrystalLayerStyleKeyframe,
  context: LayerShadingSnapshotContext,
): EvaluatedCrystalLayerStyle {
  return {
    representation: keyframe.patch.representation ?? layer.representation,
    color: keyframe.patch.color ?? layer.color,
    shading: effectiveKeyShading(layer, keyframe, context),
    visible: layer.visible,
    opacity: keyframe.patch.opacity ?? layer.opacity,
    scale: keyframe.patch.scale ?? layer.scale,
    bondScale: keyframe.patch.bondScale ?? layer.bondScale,
  }
}

/** Visibility is a separate hold channel and needs no material defaults. */
export function evaluateCrystalLayerVisibility(layer: CrystalLayer, frame: number): boolean {
  if (!Number.isFinite(frame) || !layer.styleTrack?.length) return layer.visible
  let visible = layer.visible
  let latestVisibilityFrame = Number.NEGATIVE_INFINITY
  for (const key of layer.styleTrack) {
    if (key.patch.visible === undefined || key.frame > frame || key.frame < latestVisibilityFrame) continue
    visible = key.patch.visible
    latestVisibilityFrame = key.frame
  }
  return visible
}

/**
 * Numeric channels, including the five material-lighting channels, interpolate.
 * Representation, colour and material mode hold the source value until the
 * playhead reaches the destination keyframe; visibility is a separate step channel.
 */
export function evaluateCrystalLayerStyle(
  layer: CrystalLayer,
  frame: number,
  context: LayerShadingSnapshotContext,
): EvaluatedCrystalLayerStyle {
  const base: EvaluatedCrystalLayerStyle = {
    representation: layer.representation,
    color: layer.color,
    shading: snapshotLayerShading(layer.shading, context),
    visible: layer.visible,
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
  }
  if (!layer.styleTrack?.length || !Number.isFinite(frame)) return base

  const visible = evaluateCrystalLayerVisibility(layer, frame)

  const keys = [...layer.styleTrack]
    .filter((key) => Object.keys(key.patch).some((field) => field !== 'visible'))
    .sort((left, right) => left.frame - right.frame)
  if (!keys.length) return { ...base, visible }
  if (frame <= keys[0].frame) return { ...keyStyle(layer, keys[0], context), visible }
  if (frame >= keys[keys.length - 1].frame) return { ...keyStyle(layer, keys[keys.length - 1], context), visible }

  let source = keys[0]
  let destination = keys[1]
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (frame >= keys[index].frame && frame < keys[index + 1].frame) {
      source = keys[index]
      destination = keys[index + 1]
      break
    }
  }
  const left = keyStyle(layer, source, context)
  if (source.easing === 'hold') return { ...left, visible }
  const raw = (frame - source.frame) / Math.max(1, destination.frame - source.frame)
  const amount = source.easing === 'smooth' ? smoothstep(raw) : raw
  const right = keyStyle(layer, destination, context)
  return {
    representation: left.representation,
    color: left.color,
    shading: {
      mode: left.shading!.mode,
      ambient: lerp(left.shading!.ambient!, right.shading!.ambient!, amount),
      diffuse: lerp(left.shading!.diffuse!, right.shading!.diffuse!, amount),
      specular: lerp(left.shading!.specular!, right.shading!.specular!, amount),
      shininess: lerp(left.shading!.shininess!, right.shading!.shininess!, amount),
      rim: lerp(left.shading!.rim!, right.shading!.rim!, amount),
    },
    visible,
    opacity: lerp(left.opacity, right.opacity, amount),
    scale: lerp(left.scale, right.scale, amount),
    bondScale: lerp(left.bondScale, right.bondScale, amount),
  }
}

export interface CrystalLayerSelectionResult {
  atomIds: ReadonlySet<string>
  error: string | null
}

export interface CrystalLayerCompositionPlan {
  /** Atoms left to the ordinary crystal presentation pass. */
  baseAtomIds: ReadonlySet<string>
  /** Effective atom ownership after top-to-bottom exclusive-layer priority. */
  layerAtomIds: ReadonlyMap<string, ReadonlySet<string>>
}

/**
 * Source-compatible Licorice geometry uses one world-space radius for both
 * atoms and bonds. Layer atom scale is deliberately irrelevant in this mode.
 */
export function resolveCrystalLayerStickRadius(
  globalBondRadius: number,
  layerBondScale: number,
): number {
  const radius = Number.isFinite(globalBondRadius) ? globalBondRadius : .12
  const scale = Number.isFinite(layerBondScale) ? layerBondScale : 1
  return Math.max(.001, radius * scale)
}

/** Semantic layers own their bond pass independently of the base visibility gate. */
export function crystalLayerRepresentationHasBonds(representation: CrystalLayerRepresentation): boolean {
  return representation !== 'space-fill'
    && representation !== 'hyper-stick'
    && representation !== 'polyhedra'
    && representation !== 'surface'
}

/** Evaluate one layer against the active Cartesian structure. */
export function evaluateCrystalLayerSelection(
  atoms: readonly Atom[],
  expression: string,
  supercell: SupercellParams = { nx: 1, ny: 1, nz: 1 },
): CrystalLayerSelectionResult {
  return evaluateCrystalLayerSelectionDsl(atoms, expression, supercell)
}

/**
 * Resolve deterministic layer composition in the same top-to-bottom order as
 * the editor. Overlay layers are deliberately additive. Exclusive layers
 * claim their selection from the base and every lower layer; an overlay above
 * an exclusive layer can still be used as an intentional annotation pass.
 */
export function resolveCrystalLayerComposition(
  atoms: readonly Atom[],
  layers: readonly CrystalLayer[],
  frame?: number,
  supercell: SupercellParams = { nx: 1, ny: 1, nz: 1 },
): CrystalLayerCompositionPlan {
  const claimedByHigherExclusive = new Set<string>()
  const excludedFromBase = new Set<string>()
  const layerAtomIds = new Map<string, ReadonlySet<string>>()

  for (const layer of layers) {
    const visible = frame === undefined ? layer.visible : evaluateCrystalLayerVisibility(layer, frame)
    if (!visible) {
      layerAtomIds.set(layer.id, new Set())
      continue
    }
    const selection = evaluateCrystalLayerSelection(atoms, layer.selection, supercell)
    const effective = new Set<string>()
    if (!selection.error) {
      for (const id of selection.atomIds) {
        if (!claimedByHigherExclusive.has(id)) effective.add(id)
      }
    }
    layerAtomIds.set(layer.id, effective)
    if (!layer.replaceBase || selection.error) continue
    for (const id of selection.atomIds) {
      excludedFromBase.add(id)
      claimedByHigherExclusive.add(id)
    }
  }

  return {
    baseAtomIds: new Set(atoms.flatMap((atom) => excludedFromBase.has(atom.id) ? [] : [atom.id])),
    layerAtomIds,
  }
}

/** Atoms removed from the base pass by visible replacement layers. */
export function crystalReplaceBaseAtomIds(
  atoms: readonly Atom[],
  layers: readonly CrystalLayer[],
  frame?: number,
  supercell: SupercellParams = { nx: 1, ny: 1, nz: 1 },
): ReadonlySet<string> {
  const baseAtomIds = resolveCrystalLayerComposition(atoms, layers, frame, supercell).baseAtomIds
  return new Set(atoms.flatMap((atom) => baseAtomIds.has(atom.id) ? [] : [atom.id]))
}

/** Keep only bonds whose two endpoints are present in a semantic atom subset. */
export function bondsWithinAtomIds(
  bonds: readonly Bond[],
  atomIds: ReadonlySet<string>,
): Bond[] {
  return bonds.filter((bond) => atomIds.has(bond.atom1Id) && atomIds.has(bond.atom2Id))
}
