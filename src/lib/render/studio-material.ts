/**
 * Physically based studio material. It uses Three's MeshPhysicalMaterial for
 * IBL, energy-conserving GGX highlights, shadows, and clearcoat rather than
 * adding a nonphysical branch to the gamma-space VESTA shader.
 */

import * as THREE from 'three'

/**
 * Convert shared sRGB vertex/instance color buffers to the linear workspace
 * expected by MeshPhysicalMaterial. VESTA consumes the same buffers directly in
 * gamma space, so conversion belongs in the PBR consumer rather than the writer.
 */
function linearizeVertexColors(shader: { fragmentShader: string }): void {
  const original = `#elif defined( USE_COLOR )

	diffuseColor.rgb *= vColor;`
  const patched = `#elif defined( USE_COLOR )

	// Exact IEC 61966-2-1 sRGB-to-linear transfer; dark atom colors make a
	// simple pow(x, 2.2) approximation visibly inaccurate.
	{
		vec3 srgb = vColor;
		vec3 lo = srgb / 12.92;
		vec3 hi = pow( ( srgb + 0.055 ) / 1.055, vec3( 2.4 ) );
		diffuseColor.rgb *= mix( lo, hi, step( vec3( 0.04045 ), srgb ) );
	}`
  if (!shader.fragmentShader.includes(original)) {
    // If Three changes this chunk, preserve rendering and warn for realignment.
    console.warn('[zatom] Studio material shader changed; skipping sRGB linearization')
    return
  }
  shader.fragmentShader = shader.fragmentShader.replace(original, patched)
}

export interface StudioMaterialOptions {
  color: string
  side?: THREE.Side
  vertexColors?: boolean
  instanceColors?: boolean
}

/** Polished dielectric defaults for publication-style molecular surfaces. */
export const STUDIO_SURFACE = {
  roughness: 0.38,
  metalness: 0,
  clearcoat: 0.55,
  clearcoatRoughness: 0.18,
  envMapIntensity: 1,
} as const

export function createStudioMaterial(opts: StudioMaterialOptions): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    // Uniform colors follow Three's normal sRGB-to-linear pipeline.
    color: new THREE.Color(opts.color),
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    ...STUDIO_SURFACE,
  })

  if (opts.vertexColors || opts.instanceColors) {
    material.onBeforeCompile = linearizeVertexColors
    // Include the shader patch in Three's program cache identity.
    material.customProgramCacheKey = () => 'studio-linearized-vcolor'
  }

  return material
}
