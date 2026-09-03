/**
 * Canonical selection appearance shared by mesh and impostor renderers. A rim
 * communicates selection without replacing CPK element color or changing the
 * apparent atomic radius.
 */

/** Bright cyan remains distinct from every dark CPK element color. */
export const SELECTION_RIM_COLOR = '#64D2FF'
export const SELECTION_RIM_RGB: readonly [number, number, number] = [0.392, 0.824, 1.0]

/** Semantic rim colors for pending and destructive interactions. */
export const PENDING_BOND_RIM_COLOR = '#30D158'
export const PENDING_MEASURE_RIM_COLOR = '#00E5A0'
export const DELETE_HOVER_RIM_COLOR = '#FF453A'
export const HOVER_RIM_COLOR = '#FFFFFF'

/** Rim shells stay close enough not to alter perceived atomic radius. */
export const SELECTION_RIM_SCALE = 1.045
export const HOVER_RIM_SCALE = 1.03

/** Fresnel powers controlling rim width and strength. */
export const SELECTION_RIM_POWER = 3.0
export const SELECTION_RIM_STRENGTH = 1.0
export const HOVER_RIM_STRENGTH = 0.55

/** Impostor rim parameters with only a minimal whole-sphere lift. */
export const IMPOSTOR_RIM_POWER = 2.4
export const IMPOSTOR_RIM_GAIN = 0.95
export const IMPOSTOR_SELECTED_LIFT = 0.06

/** Back-face Fresnel shell whose center remains transparent. */
export const RIM_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = viewPos.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPos;
}
`

export const RIM_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uStrength;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  // The BackSide shell has inward normals; abs restores the view-angle magnitude.
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPosition);
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, uPower);
  float alpha = clamp(rim * uStrength, 0.0, 1.0) * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`
