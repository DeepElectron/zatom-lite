import * as THREE from 'three'
import type { RenderStyle } from './crystal-visuals'

// Multi-mode stylized shader. All modes share the same shader, branched as uMode:
//
// 0 vesta: gamma-space Lambert plus soft Blinn highlight
// 1 flat: unshaded illustration fill
// 2 cel: two-level N·L threshold
// 3 gooch: cool-to-warm technical illustration
// 4 hatch: screen-space cross-hatching
// 5 iridescent: view-dependent hue shift and Fresnel
// 6 xray: inverse-Fresnel transparency
// 7 halftone: screen-space comic dots
// 8 thermal: N·L mapped to an ironbow scale
const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
#include <clipping_planes_pars_vertex>
#ifdef USE_VERTEX_COLOR
varying vec3 vVertexColor;
#endif
#ifdef USE_INSTANCING_COLOR
varying vec3 vInstanceColor;
#endif

void main() {
  vec3 objectNormal = normal;
  mat4 mvm = modelViewMatrix;
  mat4 mm = modelMatrix;
  #ifdef USE_INSTANCING
    mvm = modelViewMatrix * instanceMatrix;
    mm = modelMatrix * instanceMatrix;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vec4 mvPosition = mvm * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  vWorldPos = (mm * vec4(position, 1.0)).xyz;
  vNormal = normalize(normalMatrix * objectNormal);
  #ifdef USE_VERTEX_COLOR
    vVertexColor = color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vInstanceColor = instanceColor;
  #endif
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uMode;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uSpecularStrength;
uniform float uShininess;
uniform float uOpacity;
uniform float uFresnel;     // Edge-glow strength; 0 disables it.
uniform vec3 uLightDir;     // World-space direction transformed in the fragment stage.
uniform float uHeadlight;   // 1 uses a constant view-space light direction.
varying vec3 vNormal;
varying vec3 vWorldPos;
#include <clipping_planes_pars_fragment>
#ifdef USE_VERTEX_COLOR
varying vec3 vVertexColor;
#endif
#ifdef USE_INSTANCING_COLOR
varying vec3 vInstanceColor;
#endif

// HSV to RGB for iridescent hue rotation.
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Bayer 4x4 ordered-dither threshold matrix for 1-bit mode.
float bayer4(vec2 p) {
  vec2 q = floor(mod(p, 4.0));
  float i = q.x + q.y * 4.0;
  // Flattened and normalized to [0,1].
  float m = 0.0;
  if (i < 0.5) m = 0.0;       else if (i < 1.5) m = 8.0;
  else if (i < 2.5) m = 2.0;  else if (i < 3.5) m = 10.0;
  else if (i < 4.5) m = 12.0; else if (i < 5.5) m = 4.0;
  else if (i < 6.5) m = 14.0; else if (i < 7.5) m = 6.0;
  else if (i < 8.5) m = 3.0;  else if (i < 9.5) m = 11.0;
  else if (i < 10.5) m = 1.0; else if (i < 11.5) m = 9.0;
  else if (i < 12.5) m = 15.0; else if (i < 13.5) m = 7.0;
  else if (i < 14.5) m = 13.0; else m = 5.0;
  return (m + 0.5) / 16.0;
}

// Ironbow thermal scale.
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.0, 0.12);   // Deep violet-black.
  vec3 b = vec3(0.55, 0.0, 0.60);   // Magenta-violet.
  vec3 c = vec3(0.95, 0.25, 0.05);  // Orange-red.
  vec3 d = vec3(1.00, 0.80, 0.10);  // Bright yellow.
  vec3 e = vec3(1.00, 1.00, 0.95);  // White-hot.
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.55) return mix(b, c, (t - 0.25) / 0.30);
  if (t < 0.85) return mix(c, d, (t - 0.55) / 0.30);
  return mix(d, e, (t - 0.85) / 0.15);
}

void main() {
  #include <clipping_planes_fragment>
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = vec3(0.0, 0.0, 1.0);
  // A headlight shares the view direction and needs no world-space transform.
  vec3 L = uHeadlight > 0.5 ? V : normalize(mat3(viewMatrix) * uLightDir);
  float ndl = max(dot(N, L), 0.0);
  float alpha = uOpacity;
  vec3 col;
  vec3 baseColor = uColor;
  #ifdef USE_VERTEX_COLOR
    baseColor *= vVertexColor;
  #endif
  #ifdef USE_INSTANCING_COLOR
    baseColor *= vInstanceColor;
  #endif

  int mode = int(uMode + 0.5);

  if (mode == 1) {
    // Flat illustration.
    col = baseColor;

  } else if (mode == 2) {
    // Cel bands.
    float band = ndl > 0.42 ? 1.0 : 0.0;
    col = baseColor * clamp(uAmbient + uDiffuse * band, 0.0, 1.0);

  } else if (mode == 3) {
    // Gooch cool-to-warm interpolation.
    vec3 cool = vec3(0.05, 0.10, 0.45) + 0.25 * baseColor;
    vec3 warm = vec3(0.45, 0.35, 0.05) + 0.85 * baseColor;
    float t = 0.5 * (dot(N, L) + 1.0);
    col = mix(cool, warm, t);
    // Narrow white technical-illustration highlight.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 64.0);
    col += vec3(1.0) * spec * 0.5 * step(0.01, uSpecularStrength);

  } else if (mode == 4) {
    // Cross-hatching density follows luminance.
    float lum = uAmbient + uDiffuse * ndl;
    vec2 sc = gl_FragCoord.xy;
    float ink = 0.0;
    // Add crossed layers as luminance falls.
    if (lum < 0.85) ink = max(ink, step(mod(sc.x + sc.y, 9.0), 1.4));
    if (lum < 0.65) ink = max(ink, step(mod(sc.x - sc.y, 9.0), 1.4));
    if (lum < 0.45) ink = max(ink, step(mod(sc.x + sc.y * 0.5, 5.0), 1.2));
    if (lum < 0.28) ink = max(ink, step(mod(sc.y, 4.0), 1.2));
    vec3 paper = mix(baseColor, vec3(0.97), 0.72); // Paper retains a trace of atom color.
    col = mix(paper, vec3(0.13, 0.11, 0.10), ink);

  } else if (mode == 5) {
    // View-dependent iridescence with Fresnel lift.
    float fres = pow(1.0 - abs(N.z), 1.5);
    float baseLum = uAmbient + uDiffuse * ndl;
    // Rotate atom hue by up to 0.45 turns at grazing angles.
    float hueShift = fres * 0.45 + dot(N, vec3(0.3, 0.59, 0.11)) * 0.08;
    // Reconstruct hue in HSV space.
    float mx = max(baseColor.r, max(baseColor.g, baseColor.b));
    float mn = min(baseColor.r, min(baseColor.g, baseColor.b));
    float h = 0.0;
    float d = mx - mn;
    if (d > 0.001) {
      if (mx == baseColor.r) h = mod((baseColor.g - baseColor.b) / d, 6.0) / 6.0;
      else if (mx == baseColor.g) h = ((baseColor.b - baseColor.r) / d + 2.0) / 6.0;
      else h = ((baseColor.r - baseColor.g) / d + 4.0) / 6.0;
    }
    vec3 shifted = hsv2rgb(vec3(fract(h + hueShift), 0.75, 1.0));
    col = shifted * baseLum;
    vec3 H = normalize(L + V);
    col += vec3(1.0) * pow(max(dot(N, H), 0.0), 90.0) * 0.9;
    col += shifted * fres * 0.55;

  } else if (mode == 6) {
    // X-ray: inverse-Fresnel transparency with a bright rim.
    float fres = pow(1.0 - abs(N.z), 1.8);
    col = baseColor * (0.35 + 0.65 * fres) + vec3(0.6) * fres;
    alpha = uOpacity * clamp(0.06 + fres * 1.1, 0.0, 1.0);

  } else if (mode == 7) {
    // Halftone dots grow in darker regions.
    float lum = clamp(uAmbient + uDiffuse * ndl, 0.0, 1.0);
    vec2 grid = mod(gl_FragCoord.xy, 7.0) - 3.5;
    float dist = length(grid);
    float dotR = (1.0 - lum) * 4.2; // Darker means larger dots.
    float ink = step(dist, dotR);
    vec3 base = mix(baseColor, vec3(1.0), 0.15);
    col = mix(base, base * 0.22, ink);

  } else if (mode == 8) {
    // Thermal mode maps luminance to ironbow and ignores atom hue.
    float t = uAmbient * 0.4 + uDiffuse * ndl + pow(1.0 - abs(N.z), 2.0) * -0.25;
    col = ironbow(clamp(t + 0.15, 0.0, 1.0));

  } else if (mode == 9) {
    // Gem facets: quantized face lighting, sharp highlights, and Fresnel fire.
    float facet = ndl;
    // Quantize each flat face to one luminance band.
    float q = floor(facet * 5.0) / 5.0;
    float lum = clamp(uAmbient * 0.8 + uDiffuse * (q * 0.85 + facet * 0.15), 0.0, 1.15);
    col = baseColor * lum;
    // Very narrow specular glints emulate cut-gem flashes.
    vec3 H = normalize(L + V);
    col += vec3(1.0) * pow(max(dot(N, H), 0.0), 220.0) * 1.2;
    // Grazing Fresnel adds a hue-rotated spectral edge.
    float fres = pow(1.0 - abs(N.z), 2.2);
    col += hsv2rgb(vec3(fract(fres * 1.8 + 0.55), 0.6, 1.0)) * fres * 0.5;

  } else if (mode == 10) {
    // Hologram: horizontal scan lines plus inverse Fresnel.
    float fres = pow(1.0 - abs(N.z), 1.6);
    float scan = step(mod(gl_FragCoord.y, 4.0), 1.6);        // Fine scan lines.
    float band = step(mod(gl_FragCoord.y * 0.08, 8.0), 0.5);  // Broad slow band.
    col = baseColor * (0.5 + 0.8 * fres) + vec3(0.45) * fres;
    col += baseColor * scan * 0.35 + vec3(1.0) * band * 0.25;
    alpha = uOpacity * clamp(0.10 + fres * 0.9 + scan * 0.12, 0.0, 1.0);

  } else if (mode == 11) {
    // 1-bit Bayer 4x4 ordered dithering.
    float lum = clamp(uAmbient + uDiffuse * ndl, 0.0, 1.0);
    // Retain atom-color luminance information.
    lum *= dot(baseColor, vec3(0.35, 0.5, 0.15)) + 0.35;
    float threshold = bayer4(gl_FragCoord.xy * 0.5);
    float on = step(threshold, lum);
    col = mix(vec3(0.07, 0.07, 0.09), vec3(0.93, 0.91, 0.86), on);

  } else if (mode == 12) {
    // 8-bit pixel mode: lock normals to a 6 px screen grid and four shades.
    vec2 cell = floor(gl_FragCoord.xy / 6.0) * 6.0 + 3.0;
    vec2 dxy = (cell - gl_FragCoord.xy) * 0.004;
    vec3 Nq = normalize(N + vec3(dxy, 0.0));
    float lum = clamp(uAmbient + uDiffuse * max(dot(Nq, L), 0.0), 0.0, 1.0);
    lum = floor(lum * 4.0 + 0.5) / 4.0;   // Four luminance levels.
    // Quantize color to a five-level retro palette.
    vec3 cq = floor(baseColor * 5.0 + 0.5) / 5.0;
    col = cq * (0.35 + 0.75 * lum);

  } else if (mode == 13) {
    // Risograph: paper/ink separation with grain.
    float lum = clamp(uAmbient + uDiffuse * ndl, 0.0, 1.0);
    // Noise-dithered threshold approximates ink grain.
    float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
    float ink = step(lum + (grain - 0.5) * 0.55, 0.62);
    vec3 paper = vec3(0.96, 0.93, 0.86);           // Warm paper.
    vec3 inkCol = baseColor * 0.75 + vec3(0.02);      // Darkened atom-color ink.
    col = mix(paper, inkCol, ink * 0.92);

  } else if (mode == 14) {
    // Velvet: dark face-on response and bright inverse-Fresnel fibers.
    float fres = pow(1.0 - abs(N.z), 1.35);
    float lum = uAmbient * 0.55 + uDiffuse * ndl * 0.4;
    col = baseColor * lum + baseColor * fres * 1.05 + vec3(1.0) * pow(fres, 3.0) * 0.22;

  } else if (mode == 16) {
    // Isosurface contour bands along world Y.
    float bandY = vWorldPos.y * 6.0;
    float band = step(fract(bandY), 0.5);
    float lum = clamp(uAmbient + uDiffuse * ndl, 0.0, 1.1);
    col = baseColor * lum * (0.68 + 0.44 * band);
    // A dark seam emphasizes each layer boundary.
    float f = abs(fract(bandY) - 0.5);
    float fw = fwidth(bandY) * 1.5 + 1e-4;
    float seam = 1.0 - smoothstep(0.0, fw * 2.5, min(f, 0.5 - f));
    col *= 1.0 - seam * 0.5;

  } else if (mode == 15) {
    // Procedural matcap for a sculpted-clay response.
    vec2 muv = N.xy * 0.5 + 0.5;
    // Upper-left soft key.
    float d1 = length(muv - vec2(0.36, 0.66));
    float shade = smoothstep(0.95, 0.12, d1);
    // Lower bounce card.
    float d2 = length(muv - vec2(0.5, 0.08));
    float bounce = smoothstep(0.75, 0.2, d2) * 0.18;
    // Small upper highlight.
    float d3 = length(muv - vec2(0.40, 0.75));
    float hot = smoothstep(0.22, 0.0, d3) * 0.35;
    col = baseColor * (0.28 + shade * 0.78 + bounce) + vec3(1.0) * hot;

  } else {
    // Default VESTA: gamma-space Lambert plus broad Blinn highlight.
    float lum = clamp(uAmbient + uDiffuse * ndl, 0.0, 1.0);
    col = baseColor * lum;
    if (uSpecularStrength > 0.001) {
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), max(uShininess, 1.0));
      col += vec3(1.0) * spec * uSpecularStrength;
    }
  }

  // Shared Fresnel edge glow.
  if (uFresnel > 0.001 && mode != 6) {
    float fres = pow(1.0 - abs(N.z), 2.0);
    col += vec3(1.0) * fres * uFresnel;
  }

  // VESTA intentionally computes and outputs lighting directly in gamma space.
  gl_FragColor = vec4(col, alpha);
}
`

// Shading mode name -> uMode number
export const SHADING_MODE_MAP: Record<RenderStyle, number> = {
  vesta: 0,
  // Studio normally uses MeshPhysicalMaterial. If this shader is explicitly
  // requested, fall back to the safe VESTA branch instead of an invalid uniform.
  studio: 0,
  flat: 1,
  cel: 2,
  gooch: 3,
  hatch: 4,
  iridescent: 5,
  xray: 6,
  halftone: 7,
  thermal: 8,
  dither: 11,
  pixel8: 12,
  riso: 13,
  velvet: 14,
  matcap: 15,
}

// Polyhedral-specific mode number (does not appear in the atom shading drop-down)
export const POLY_MODE_GEM = 9
export const POLY_MODE_HOLOGRAM = 10
// Special for isosurfaces: world coordinate contour strips
export const ISO_MODE_BANDS = 16

export interface VestaMaterialOptions {
  color: string
  mode?: number
  shininess?: number
  ambient?: number
  diffuse?: number
  specularStrength?: number
  opacity?: number
  lightDir?: THREE.Vector3
  /** Use a constant view-space light direction and ignore `lightDir`. */
  headlight?: boolean
  transparent?: boolean
  side?: THREE.Side
  depthWrite?: boolean
  vertexColors?: boolean
  instanceColors?: boolean
}

export function createVestaMaterial(opts: VestaMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      // Preserve raw sRGB components for VESTA's gamma-space lighting.
      uColor: { value: new THREE.Color().setStyle(opts.color, THREE.NoColorSpace) },
      uMode: { value: opts.mode ?? 0 },
      uShininess: { value: opts.shininess ?? 15 },
      uAmbient: { value: opts.ambient ?? 0.55 },
      uDiffuse: { value: opts.diffuse ?? 0.47 },
      uSpecularStrength: { value: opts.specularStrength ?? 0.6 },
      uOpacity: { value: opts.opacity ?? 1 },
      uFresnel: { value: 0 },
      uLightDir: { value: opts.lightDir ?? new THREE.Vector3(-0.2, 0.25, 1).normalize() },
      uHeadlight: { value: opts.headlight ? 1 : 0 },
    },
    transparent: opts.transparent ?? false,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
    vertexColors: opts.vertexColors ?? false,
    // Geometry vertex colors and InstancedMesh.instanceColor are independent
    // shader inputs. USE_VERTEX_COLOR is intentionally ours: Three may also
    // define its broad USE_COLOR for an instance-only program. Three normally
    // derives USE_INSTANCING_COLOR from the object, but keep an explicit
    // instance contract so dynamic meshes compile correctly on the first frame.
    defines: {
      ...(opts.vertexColors ? { USE_VERTEX_COLOR: '' } : {}),
      ...(opts.instanceColors ? { USE_INSTANCING_COLOR: '' } : {}),
    },
    toneMapped: false,
    extensions: { derivatives: true },
    clipping: true,
  })
}

// Calculate the view space lighting direction from the azimuth/elevation angle
