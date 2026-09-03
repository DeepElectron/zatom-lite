/**
 * Procedural equirectangular studio IBL shared by raster and path tracing.
 * A generated floating-point softbox works offline, avoids distracting HDR
 * reflections, and supports highlight intensities above one.
 */

import { Color, type Spherical, type Vector2 } from 'three'
import { ProceduralEquirectTexture } from 'three-gpu-pathtracer'

/** Above-one zenith intensity preserves highlight roll-off in the PBR pipeline. */
const ZENITH_INTENSITY = 1.15
const HORIZON_INTENSITY = 0.3
/** Small ground bounce keeps lower surfaces legible. */
const NADIR_INTENSITY = 0.08

/** Cool top light and warm ground bounce add restrained depth. */
const ZENITH_TINT = new Color(0.97, 0.98, 1.0)
const HORIZON_TINT = new Color(1.0, 1.0, 1.0)
const NADIR_TINT = new Color(1.0, 0.97, 0.94)

/** Smoothstep gives the softbox a defined edge without a hard transition. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Generate an azimuth-invariant softbox so rotating a molecule does not change
 * its environment brightness. Directionality remains the key/fill lights' job.
 */
export function createStudioEnvironment(): ProceduralEquirectTexture {
  // Low-frequency illumination needs no more than a 512×256 map.
  const texture = new ProceduralEquirectTexture(512, 256)

  texture.generationCallback = (polar: Spherical, _uv: Vector2, _coord: Vector2, color: Color) => {
    // Three's phi runs from zenith (+Y) at 0 to nadir at PI.
    const upness = 1 - polar.phi / Math.PI // 1 = zenith, 0 = nadir

    let intensity: number
    if (upness >= 0.5) {
      // Cool upper softbox.
      const t = smoothstep(0.5, 0.92, upness)
      intensity = HORIZON_INTENSITY + (ZENITH_INTENSITY - HORIZON_INTENSITY) * t
      color.copy(HORIZON_TINT).lerp(ZENITH_TINT, t)
    } else {
      // Warm lower bounce attenuates toward the ground.
      const t = smoothstep(0.0, 0.5, upness)
      intensity = NADIR_INTENSITY + (HORIZON_INTENSITY - NADIR_INTENSITY) * t
      color.copy(NADIR_TINT).lerp(HORIZON_TINT, t)
    }

    // The FloatType texture and numeric Color constructors already use linear components.
    color.multiplyScalar(intensity)
  }

  texture.update()
  return texture
}
