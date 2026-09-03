// Camera-facing billboard whose fragment shader analytically ray-traces a sphere
// (view space) and writes gl_FragDepth. Adapted from hyper-stick-bonds.tsx.
// Per-instance attributes: aCenter (world xyz, zero-copy positions), aRadius, aColor.
// uLight is the VIEW-SPACE key-light direction (updated per frame so lighting is
// world-fixed). Handles both perspective and orthographic cameras.

export const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aCenterB;
attribute float aRadius;
attribute vec3 aColor;
attribute float aSelected;
uniform float uMix;
varying vec3 vColor;
varying vec3 vViewCenter;
varying float vRadius;
varying vec3 vViewPos;
varying float vSelected;
void main() {
  vColor = aColor;
  vSelected = aSelected;
  // Radius is data (element / van der Waals). Selection no longer inflates it —
  // the state cue lives entirely in the fragment-stage rim light, so a selected
  // atom stays comparable in size to its neighbours.
  vRadius = aRadius;
  // trajectory playback: lerp between frame i (aCenter) and i+1 (aCenterB).
  // Static mode keeps uMix=0 with aCenterB bound to the same buffer as aCenter.
  vec3 centerW = mix(aCenter, aCenterB, uMix);
  vec4 viewCenter = modelViewMatrix * vec4(centerW, 1.0);
  vViewCenter = viewCenter.xyz;
  // 'position' is the unit-quad corner in [-1,1] (z=0). Enlarge a touch (1.15) so
  // the billboard always covers the sphere silhouette under perspective.
  vec3 viewPos = viewCenter.xyz + vec3(position.xy * vRadius * 1.15, 0.0);
  vViewPos = viewPos;
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
}
`

export const FRAG = /* glsl */ `
precision highp float;
// projectionMatrix is auto-declared in the vertex stage only; redeclare for the
// fragment stage (three still uploads it) — needed for the ortho test + gl_FragDepth.
uniform mat4 projectionMatrix;
uniform vec3 uLight;
uniform float uAmbient, uKey, uFill;
varying vec3 vColor;
varying vec3 vViewCenter;
varying float vRadius;
varying vec3 vViewPos;
varying float vSelected;
void main() {
  bool isOrtho = projectionMatrix[3][3] == 1.0;
  vec3 ro, rd;
  if (isOrtho) { ro = vec3(vViewPos.xy, 0.0); rd = vec3(0.0, 0.0, -1.0); }
  else { ro = vec3(0.0); rd = normalize(vViewPos); }
  vec3 oc = ro - vViewCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - vRadius * vRadius;
  float h = b * b - c;
  if (h < 0.0) discard;
  float t = -b - sqrt(h);
  float inside = 0.0;
  if (t < 0.0) {
    // camera is inside this sphere: draw the back surface (flipped normal) so
    // close fly-through shows solid caps instead of hollow sliced shells
    t = -b + sqrt(h);
    if (t < 0.0) discard;
    inside = 1.0;
  }
  vec3 hit = ro + t * rd;
  vec3 n = normalize(hit - vViewCenter);
  if (inside > 0.5) n = -n;
  float df = max(dot(n, uLight), 0.0);
  float ff = max(dot(n, -uLight), 0.0);
  vec3 viewDir = normalize(-hit);
  vec3 hvec = normalize(uLight + viewDir);
  float sp = pow(max(dot(n, hvec), 0.0), 80.0);
  float lightStrength = 0.22 * uAmbient + 0.70 * uKey * df + 0.32 * uFill * ff;
  vec3 rgb = vColor * lightStrength + vec3(1.0) * sp * 0.45 * uKey;
  // selected atoms: rim light on the silhouette instead of tinting the whole sphere.
  // The old mix(rgb, blue, 0.55) overwrote the CPK fill colour: element identity is
  // data and must survive selection. Fresnel keeps the state cue on the outline only,
  // matching the detail path's AtomRimMaterial (see lib/render/selection-visual.ts).
  if (vSelected > 0.5) {
    float rim = pow(1.0 - abs(dot(n, viewDir)), 2.4);
    rgb += vec3(0.392, 0.824, 1.0) * rim * 0.95 + 0.06;
  }
  vec4 clip = projectionMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(rgb, 1.0);
}
`
