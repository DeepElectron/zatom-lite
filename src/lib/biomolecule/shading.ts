import type { RenderStyle } from '../render/crystal-visuals'
import type { BioLayerShadingOverride, BioShadingMode } from './types'

export interface LayerShadingSnapshotContext {
  renderStyle: RenderStyle
  ambient: number
  diffuse: number
  specular: number
  shininess: number
  rim: number
  /** Optional light-panel overrides; null means use the visual-style value. */
  lightAmbient?: number | null
  lightKey?: number | null
}

/**
 * Biomolecule layers and the shared crystal renderer use the same shader
 * family, but retain two user-facing names. Keep those aliases at this single
 * boundary so recording and rendering cannot drift apart.
 */
export function renderStyleToBioShadingMode(renderStyle: RenderStyle): BioShadingMode {
  if (renderStyle === 'vesta') return 'standard'
  if (renderStyle === 'pixel8') return 'pixel'
  /**
  * The studio uses MeshPhysicalMaterial and covers this set of "stylized shader uMode numbers" on the layer.
  * There is no corresponding item in the system, so it falls back to standard.
  *
  * This does not make the biological structure lose its studio quality: this function is only called when **explicit layer overlay** is recorded, not
  * The mode passed to StylizedMaterial for the overlay layer is undefined, which happens to be the studio branch.
  * In other words, the fallback here only affects the situation where "the user actively nails the shading mode for a certain layer" - in that case
  * What users want is that specific stylized look, not photorealistic texture.
  */
  if (renderStyle === 'studio') return 'standard'
  return renderStyle
}

export function bioShadingModeToRenderStyle(mode: BioShadingMode): RenderStyle {
  if (mode === 'standard') return 'vesta'
  if (mode === 'pixel') return 'pixel8'
  return mode
}

/** Resolve every material field at record time for either semantic layer kind. */
export function snapshotLayerShading(
  override: BioLayerShadingOverride | null | undefined,
  context: LayerShadingSnapshotContext,
): Required<BioLayerShadingOverride> {
  return {
    mode: override?.mode ?? renderStyleToBioShadingMode(context.renderStyle),
    ambient: override?.ambient ?? context.lightAmbient ?? context.ambient,
    diffuse: override?.diffuse ?? context.lightKey ?? context.diffuse,
    specular: override?.specular ?? context.specular,
    shininess: override?.shininess ?? context.shininess,
    rim: override?.rim ?? context.rim,
  }
}
