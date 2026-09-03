// Self-contained billboard + analytic-sphere id pass (no aSelected/lighting).
// Same silhouette + gl_FragDepth as the lit impostor so picking is occlusion-correct.

export const ID_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aRadius;
attribute float aId;
varying vec3 vViewCenter;
varying float vRadius;
varying vec3 vViewPos;
varying float vId;
void main() {
  vId = aId;
  vRadius = aRadius;
  vec4 viewCenter = modelViewMatrix * vec4(aCenter, 1.0);
  vViewCenter = viewCenter.xyz;
  vec3 viewPos = viewCenter.xyz + vec3(position.xy * aRadius * 1.15, 0.0);
  vViewPos = viewPos;
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
}
`

export const ID_FRAG = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
varying vec3 vViewCenter;
varying float vRadius;
varying vec3 vViewPos;
varying float vId;
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
  if (t < 0.0) {
    t = -b + sqrt(h); // camera inside: pick the back surface (matches the lit pass)
    if (t < 0.0) discard;
  }
  vec3 hit = ro + t * rd;
  vec4 clip = projectionMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  float v = vId + 1.0;
  float r = mod(v, 256.0);
  float g = mod(floor(v / 256.0), 256.0);
  float bb = mod(floor(v / 65536.0), 256.0);
  gl_FragColor = vec4(r / 255.0, g / 255.0, bb / 255.0, 1.0);
}
`
