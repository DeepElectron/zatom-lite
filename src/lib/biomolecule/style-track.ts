import type {
  BioColorScheme,
  BioLayer,
  BioLayerColor,
  BioLayerShadingOverride,
  BioRepresentation,
  BioStyleKeyframe,
  BioStylePatch,
} from './types'

import {
  snapshotLayerShading,
  type LayerShadingSnapshotContext,
} from './shading'

export interface EvaluatedBioStyle {
  mode?: BioLayerShadingOverride['mode']
  ambient: number
  diffuse: number
  specular: number
  shininess: number
  rim: number
  opacity: number
  color?: BioLayerColor
  representation?: BioRepresentation
  scale: number
  bondScale: number
}

export interface BioStyleDefaults {
  ambient: number
  diffuse: number
  specular: number
  shininess: number
  rim: number
}

export interface BioLayerStyleSnapshotContext extends LayerShadingSnapshotContext {
  bioColorScheme: BioColorScheme
}

type SnapshotBioLayer = Pick<
  BioLayer,
  'representation' | 'color' | 'opacity' | 'scale' | 'bondScale' | 'shading'
>

/**
 * Capture the complete effective layer style at record time. Inherited color
 * and material fields are deliberately dereferenced so later global changes
 * cannot rewrite the appearance of an existing keyframe.
 */
export function snapshotBioLayerStyle(
  layer: SnapshotBioLayer,
  context: BioLayerStyleSnapshotContext,
): BioStylePatch {
  const color: BioLayerColor = layer.color.mode === 'inherit'
    ? { mode: 'scheme', scheme: context.bioColorScheme }
    : { ...layer.color }
  return {
    representation: layer.representation,
    color,
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
    shading: snapshotLayerShading(layer.shading, context),
  }
}

/** Materialize one WYSIWYG edit as a complete keyframe style snapshot. */
export function materializeBioLayerStyleEdit(
  current: SnapshotBioLayer,
  edit: Partial<SnapshotBioLayer>,
  context: BioLayerStyleSnapshotContext,
): BioStylePatch {
  return snapshotBioLayerStyle({
    representation: edit.representation ?? current.representation,
    color: edit.color ?? current.color,
    shading: edit.shading === undefined ? current.shading : edit.shading,
    opacity: edit.opacity ?? current.opacity,
    scale: edit.scale ?? current.scale,
    bondScale: edit.bondScale ?? current.bondScale,
  }, context)
}

const smoothstep = (value: number) => value * value * (3 - 2 * value)

function sortedStyleKeys(track: readonly BioStyleKeyframe[]): BioStyleKeyframe[] {
  return [...track]
    .filter((keyframe) => Object.keys(keyframe.patch).some((key) => key !== 'visible'))
    .sort((left, right) => left.frame - right.frame)
}

function at(
  keyframe: BioStyleKeyframe,
  layer: BioStylePatch,
  defaults: BioStyleDefaults,
): EvaluatedBioStyle {
  const patch = keyframe.patch
  const scale = patch.scale ?? layer.scale ?? 1
  const shading = patch.shading ?? layer.shading
  return {
    mode: shading?.mode,
    ambient: shading?.ambient ?? defaults.ambient,
    diffuse: shading?.diffuse ?? defaults.diffuse,
    specular: shading?.specular ?? defaults.specular,
    shininess: shading?.shininess ?? defaults.shininess,
    rim: shading?.rim ?? defaults.rim,
    opacity: patch.opacity ?? layer.opacity ?? 1,
    color: patch.color ?? layer.color,
    representation: patch.representation ?? layer.representation,
    scale,
    bondScale: patch.bondScale ?? layer.bondScale ?? scale,
  }
}

/**
 * Visibility is a step channel: the latest visibility key at or before the
 * requested frame owns the value. Keys that do not mention visibility do not
 * interrupt this channel.
 */
export function evaluateBioVisibility(
  track: readonly BioStyleKeyframe[] | undefined,
  frame: number,
  staticVisible: boolean,
): boolean {
  if (!track?.length) return staticVisible
  let result = staticVisible
  let latest = Number.NEGATIVE_INFINITY
  for (const keyframe of track) {
    if (keyframe.patch.visible === undefined || keyframe.frame > frame || keyframe.frame < latest) continue
    latest = keyframe.frame
    result = keyframe.patch.visible
  }
  return result
}

/**
 * Numeric fields interpolate from the source keyframe using its easing.
 * Discrete fields (shading, colour and representation) hold the source value
 * until the playhead reaches the destination keyframe.
 */
export function evaluateBioStyleTrack(
  track: readonly BioStyleKeyframe[] | undefined,
  frame: number,
  layer: BioStylePatch,
  defaults: BioStyleDefaults,
): EvaluatedBioStyle | null {
  if (!track?.length || !Number.isFinite(frame)) return null
  const keys = sortedStyleKeys(track)
  if (!keys.length) return null
  if (frame <= keys[0].frame) return at(keys[0], layer, defaults)
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return at(last, layer, defaults)

  let source = keys[0]
  let destination = keys[1]
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (frame >= keys[index].frame && frame < keys[index + 1].frame) {
      source = keys[index]
      destination = keys[index + 1]
      break
    }
  }

  if ((source.easing ?? 'smooth') === 'hold') return at(source, layer, defaults)
  const span = destination.frame - source.frame
  const raw = span > 0 ? Math.max(0, Math.min(1, (frame - source.frame) / span)) : 1
  const amount = (source.easing ?? 'smooth') === 'smooth' ? smoothstep(raw) : raw
  const left = at(source, layer, defaults)
  const right = at(destination, layer, defaults)
  const lerp = (a: number, b: number) => a + (b - a) * amount
  return {
    mode: left.mode,
    ambient: lerp(left.ambient, right.ambient),
    diffuse: lerp(left.diffuse, right.diffuse),
    specular: lerp(left.specular, right.specular),
    shininess: lerp(left.shininess, right.shininess),
    rim: lerp(left.rim, right.rim),
    opacity: lerp(left.opacity, right.opacity),
    color: left.color,
    representation: left.representation,
    scale: lerp(left.scale, right.scale),
    bondScale: lerp(left.bondScale, right.bondScale),
  }
}
