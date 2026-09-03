import { bioShadingModeToRenderStyle } from '../../../lib/biomolecule/shading'
import type { BioLayerShadingOverride } from '../../../lib/biomolecule/types'
import { SHADING_MODE_MAP } from '../../../lib/render/stylized-material'

/**
 * Narrow presentation override shared by semantic render layers.
 *
 * Geometry, picking and LOD remain owned by the canonical atom/bond renderers;
 * a layer may only override presentation values for that render pass.
 */
export interface LayerRenderOverride {
  colorByAtomId?: ReadonlyMap<string, string>
  /** Atom scale used when a bond computes its endpoint contact with the sphere. */
  atomScale?: number
  /** Exact world-space radius for element-aware passes such as biomolecular vdW space-fill. */
  atomRadiusByAtomId?: ReadonlyMap<string, number>
  /** Exact world-space cylinder radius for source-compatible biomolecular passes. */
  bondRadius?: number
  /** The semantic layer has already resolved focus opacity for this whole pass. */
  suppressGlobalFocusFade?: boolean
  /** Independent bond thickness for unified atom/bond representations. */
  bondScale?: number
  opacity?: number
  mode?: number
  ambient?: number
  diffuse?: number
  specularStrength?: number
  shininess?: number
  fresnel?: number
}

type LayerMaterialRenderOverride = Pick<
  LayerRenderOverride,
  'mode' | 'ambient' | 'diffuse' | 'specularStrength' | 'shininess' | 'fresnel'
>

/**
 * Convert semantic material overrides to renderer inputs. Undefined fields
 * intentionally fall through to the current global StylizedMaterial values;
 * null shading therefore remains true material inheritance.
 */
export function resolveLayerShadingRenderOverride(
  shading: BioLayerShadingOverride | null | undefined,
): LayerMaterialRenderOverride {
  return {
    mode: shading?.mode === undefined
      ? undefined
      : SHADING_MODE_MAP[bioShadingModeToRenderStyle(shading.mode)],
    ambient: shading?.ambient,
    diffuse: shading?.diffuse,
    specularStrength: shading?.specular,
    shininess: shading?.shininess,
    fresnel: shading?.rim,
  }
}
