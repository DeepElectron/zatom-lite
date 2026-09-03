'use client'

/** Isosurfaces plus arbitrary field slices rendered from procedural volume data. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CrystalVisualSettings } from '../../../lib/render/crystal-visuals'
import {
  generateProceduralVolume,
  MAX_PROCEDURAL_VOLUME_ATOMS,
  type ProceduralVolumeData,
  type ProceduralVolumeJob,
  type ProceduralVolumeResult,
  type ProceduralVolumeStructure,
} from '../../../lib/render/procedural-volume'
import type { MarchingCubesResult } from '../../../lib/molecular-orbitals/OptimizedMarchingCubes'
import { COLORMAP_GLSL, COLORMAP_INDEX } from '../../../lib/render/crystal-colormaps'
import { chaikinSmooth, extractContour } from '../../../lib/render/marching-squares'
import type {
  ProceduralVolumeWorkerRequest,
  ProceduralVolumeWorkerResponse,
} from '../../../lib/render/procedural-volume-worker-types'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  createVestaMaterial,
  SHADING_MODE_MAP,
  POLY_MODE_GEM,
  POLY_MODE_HOLOGRAM,
  ISO_MODE_BANDS,
} from '../../../lib/render/stylized-material'
import { lightDirectionFromAngles } from '../../../lib/lighting'
import { resolveStylizedLightIntensities } from '../../../lib/render/stylized-lighting'

type VolumeLayerSettings = CrystalVisualSettings & {
  lightAzimuth: number
  lightElevation: number
  lightAmbient: number | null
  lightKey: number | null
  lightFill: number | null
  lightFollowsCamera: boolean
}


export interface SlicePlaneDef {
  normal: THREE.Vector3
  point: THREE.Vector3
  quadSize: number
}

export function computeSlicePlane(built: ProceduralVolumeStructure, settings: VolumeLayerSettings, vol: ProceduralVolumeData): SlicePlaneDef | null {
  const [va, vb, vc] = built.latticeVectors
  const A = new THREE.Vector3(...va)
  const B = new THREE.Vector3(...vb)
  const C = new THREE.Vector3(...vc)
  const vol3 = A.clone().cross(B).dot(C)
  if (Math.abs(vol3) < 1e-9) return null
  const b1 = B.clone().cross(C).divideScalar(vol3)
  const b2 = C.clone().cross(A).divideScalar(vol3)
  const b3 = A.clone().cross(B).divideScalar(vol3)
  const n = b1
    .multiplyScalar(settings.sliceH)
    .add(b2.multiplyScalar(settings.sliceK))
    .add(b3.multiplyScalar(settings.sliceL))
  if (n.lengthSq() < 1e-12) return null
  n.normalize()

  const o = vol.origin
  const s = vol.size
  let dMin = Infinity
  let dMax = -Infinity
  for (let i = 0; i <= 1; i++)
    for (let j = 0; j <= 1; j++)
      for (let k = 0; k <= 1; k++) {
        const d = n.x * (o[0] + i * s[0]) + n.y * (o[1] + j * s[1]) + n.z * (o[2] + k * s[2])
        if (d < dMin) dMin = d
        if (d > dMax) dMax = d
      }
  const d = dMin + (dMax - dMin) * settings.sliceOffset
  const point = n.clone().multiplyScalar(d)
  const quadSize = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]) * 1.05
  return { normal: n, point, quadSize }
}


const STYLIZED_ISO_MODE: Partial<Record<VolumeLayerSettings['isoStyle'], number>> = {
  cel: SHADING_MODE_MAP.cel,
  gooch: SHADING_MODE_MAP.gooch,
  hatch: SHADING_MODE_MAP.hatch,
  halftone: SHADING_MODE_MAP.halftone,
  xray: SHADING_MODE_MAP.xray,
  iridescent: SHADING_MODE_MAP.iridescent,
  velvet: SHADING_MODE_MAP.velvet,
  matcap: SHADING_MODE_MAP.matcap,
  gem: POLY_MODE_GEM,
  hologram: POLY_MODE_HOLOGRAM,
  bands: ISO_MODE_BANDS,
  dither: SHADING_MODE_MAP.dither,
  pixel8: SHADING_MODE_MAP.pixel8,
  riso: SHADING_MODE_MAP.riso,
}

function IsoLobe({
  surface,
  color,
  settings,
  clipPlane,
}: {
  surface: MarchingCubesResult
  color: string
  settings: VolumeLayerSettings
  clipPlane: THREE.Plane | null
}) {
  const invalidate = useThree((state) => state.invalidate)
  const worldLightDirection = useMemo(
    () => new THREE.Vector3(...lightDirectionFromAngles(settings.lightAzimuth, settings.lightElevation, 1)).normalize(),
    [settings.lightAzimuth, settings.lightElevation],
  )
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(surface.vertices, 3))
    g.setIndex(new THREE.BufferAttribute(surface.faces, 1))
    if (surface.normals.length === surface.vertices.length) g.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3))
    else g.computeVertexNormals()
    return g
  }, [surface])

  const style = settings.isoStyle
  const stylizedMode = STYLIZED_ISO_MODE[style]
  const isStylized = stylizedMode !== undefined
  const isTransparentStylized = style === "xray" || style === "hologram"

  const material = useMemo(() => {
    if (isStylized) {
      return createVestaMaterial({
        color,
        mode: stylizedMode,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: !isTransparentStylized,
      })
    }
    const common = { side: THREE.DoubleSide as THREE.Side, clipShadows: false }
    if (style === "glass")
      return new THREE.MeshPhysicalMaterial({
        ...common,
        transparent: true,
        roughness: 0.08,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        depthWrite: false,
      })
    if (style === "wireframe") return new THREE.MeshBasicMaterial({ ...common, wireframe: true })
    if (style === "normals") return new THREE.MeshNormalMaterial({ ...common, transparent: true })
    if (style === "points")
      return new THREE.PointsMaterial({ size: 0.09, transparent: true, sizeAttenuation: true })
    const translucent = style === "translucent"
    return new THREE.MeshPhongMaterial({
      ...common,
      shininess: 42,
      transparent: translucent,
      depthWrite: !translucent,
    })
  }, [style, isStylized, stylizedMode, isTransparentStylized])

  const wireOverlay = style === "solidwire"

  useEffect(() => {
    if (isStylized) {
      const m = material as THREE.ShaderMaterial
      const lighting = resolveStylizedLightIntensities(settings)
      m.uniforms.uColor.value.setStyle(color, THREE.NoColorSpace)
      m.uniforms.uOpacity.value = settings.isoOpacity
      m.uniforms.uAmbient.value = lighting.ambient
      m.uniforms.uDiffuse.value = lighting.diffuse
      m.uniforms.uSpecularStrength.value = settings.specularIntensity
      m.uniforms.uShininess.value = settings.atomShininess * 2.8
      m.uniforms.uLightDir.value.copy(worldLightDirection)
      m.uniforms.uHeadlight.value = settings.lightFollowsCamera ? 1 : 0
      m.clippingPlanes = clipPlane ? [clipPlane] : null
      m.needsUpdate = true
      invalidate()
      return
    }
    if (style === "points") {
      const m = material as THREE.PointsMaterial
      m.color.set(color)
      m.opacity = settings.isoOpacity
      m.clippingPlanes = clipPlane ? [clipPlane] : null
      m.needsUpdate = true
      invalidate()
      return
    }
    const m = material as THREE.MeshPhongMaterial
    if ("color" in m) m.color.set(color)
    if ("opacity" in m) m.opacity = style === "glass" ? Math.min(0.65, settings.isoOpacity) : settings.isoOpacity
    m.clippingPlanes = clipPlane ? [clipPlane] : null
    m.needsUpdate = true
    invalidate()
  }, [material, color, settings, style, isStylized, clipPlane, invalidate, worldLightDirection])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  if (geometry.getAttribute("position").count === 0) return null
  if (style === "points") {
    return <points geometry={geometry} material={material as THREE.PointsMaterial} />
  }
  return (
    <group>
      <mesh geometry={geometry} material={material} />
      {wireOverlay && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            wireframe
            color={new THREE.Color(color).multiplyScalar(0.35)}
            clippingPlanes={clipPlane ? [clipPlane] : null}
          />
        </mesh>
      )}
    </group>
  )
}


const SLICE_STYLE_INDEX: Record<VolumeLayerSettings['sliceStyle'], number> = {
  smooth: 0,
  banded: 1,
  lines: 2,
  diverging: 3,
  pixel: 4,
  dots: 5,
  topo: 6,
  relief: 7,
  crosshatch: 8,
  crt: 9,
  blueprint: 10,
  interference: 11,
  marbled: 12,
  stipple: 13,
  neoncontour: 14,
  woodcut: 15,
  negative: 16,
  etching: 17,
}

const SLICE_VERT = /* glsl */ `
out vec3 vWorld;
#include <clipping_planes_pars_vertex>
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`

const SLICE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uTex;
uniform vec3 uOriginW;
uniform vec3 uInvSize;
uniform int uCmap;
uniform int uStyle;      // 0 smooth, 1 bands, 2 lines, 3 signed lines, 4 pixels, 5 halftone, 6 terrain
uniform float uContours;
uniform float uOpacity;
uniform int uDiverging;  // Bipolar fields place zero at 0.5.
uniform vec3 uLineCol;   // Custom color for line-based styles.
uniform vec3 uBgCol;     // Custom plane background for line-based styles.
uniform vec3 uTexel;     // 3D texture cell size (1 / dimensions).
in vec3 vWorld;
out vec4 fragColor;
#include <clipping_planes_pars_fragment>
${COLORMAP_GLSL}

float smoothSample(vec3 uvw) {
  float c = texture(uTex, uvw).r * 0.28;
  vec3 d1 = uTexel * 0.75;
  vec3 d2 = uTexel * 1.5;
  c += texture(uTex, uvw + vec3(d1.x, 0.0, 0.0)).r * 0.08;
  c += texture(uTex, uvw - vec3(d1.x, 0.0, 0.0)).r * 0.08;
  c += texture(uTex, uvw + vec3(0.0, d1.y, 0.0)).r * 0.08;
  c += texture(uTex, uvw - vec3(0.0, d1.y, 0.0)).r * 0.08;
  c += texture(uTex, uvw + vec3(0.0, 0.0, d1.z)).r * 0.08;
  c += texture(uTex, uvw - vec3(0.0, 0.0, d1.z)).r * 0.08;
  c += texture(uTex, uvw + vec3(d2.x, 0.0, 0.0)).r * 0.04;
  c += texture(uTex, uvw - vec3(d2.x, 0.0, 0.0)).r * 0.04;
  c += texture(uTex, uvw + vec3(0.0, d2.y, 0.0)).r * 0.04;
  c += texture(uTex, uvw - vec3(0.0, d2.y, 0.0)).r * 0.04;
  c += texture(uTex, uvw + vec3(0.0, 0.0, d2.z)).r * 0.04;
  c += texture(uTex, uvw - vec3(0.0, 0.0, d2.z)).r * 0.04;
  return c;
}

float contourLine(float t, float n, float widthMul) {
  float density = fwidth(t * n);
  float fw = density * 1.2 + 1e-4;
  float f = abs(fract(t * n + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, fw * widthMul, f);
  line *= smoothstep(0.0, 0.6 / n, t) * smoothstep(1.0, 1.0 - 0.6 / n, t);
  line *= 1.0 - smoothstep(0.35, 0.8, density);
  return line;
}

void main() {
  #include <clipping_planes_fragment>
  vec3 uvw = (vWorld - uOriginW) * uInvSize;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) discard;
  float n = max(uContours, 1.0);
  float alpha = uOpacity;
  vec3 col;

  if (uStyle == 1) {
    float ts = smoothSample(uvw);
    float tq = (floor(ts * n) + 0.5) / n;
    col = applyColormap(uCmap, tq);
    float line = contourLine(ts, n, 1.4);
    col = mix(col, col * 0.45, line);

  } else if (uStyle == 2) {
    col = uBgCol;

  } else if (uStyle == 3) {
    float t = smoothSample(uvw);
    bool pos = t >= 0.5;
    float dev = abs(t - 0.5) * 2.0;
    vec3 tint = pos ? vec3(1.0, 0.82, 0.80) : vec3(0.80, 0.86, 1.0);
    col = mix(uBgCol, tint, smoothstep(0.15, 1.0, dev) * 0.75);

  } else if (uStyle == 4) {
    float px = 28.0;
    vec3 uvq = floor(uvw * px) / px + 0.5 / px;
    float tq = texture(uTex, uvq).r;
    tq = floor(tq * 6.0 + 0.5) / 6.0;
    col = applyColormap(uCmap, tq);

  } else if (uStyle == 5) {
    float t = texture(uTex, uvw).r;
    vec2 grid = mod(gl_FragCoord.xy, 8.0) - 4.0;
    float r = t * 5.2;
    float ink = step(length(grid), r);
    vec3 paper = vec3(0.97, 0.95, 0.91);
    col = mix(paper, applyColormap(uCmap, t) * 0.85, ink);

  } else if (uStyle == 6) {
    float t = smoothSample(uvw);
    float tq = (floor(t * n) + 0.5) / n;
    col = mix(applyColormap(uCmap, t), applyColormap(uCmap, tq), 0.55);
    float minor = contourLine(t, n, 1.2);
    float major = contourLine(t, max(n / 5.0, 1.0), 2.2);
    col = mix(col, col * 0.55, minor * 0.6);
    col = mix(col, vec3(0.10, 0.08, 0.06), major * 0.8);

  } else if (uStyle == 7) {
    float t = texture(uTex, uvw).r;
    vec2 g = vec2(dFdx(t), dFdy(t));
    float shade = clamp(0.62 - (g.x - g.y) * 60.0, 0.0, 1.25);
    col = applyColormap(uCmap, t) * shade;
    float line = contourLine(t, n, 1.2);
    col = mix(col, col * 0.6, line * 0.5);

  } else if (uStyle == 8) {
    float t = texture(uTex, uvw).r;
    float ink = 0.0;
    vec2 p = gl_FragCoord.xy;
    if (t > 0.18) ink = max(ink, step(mod(p.x + p.y, 9.0), 1.6));          // 45°
    if (t > 0.42) ink = max(ink, step(mod(p.x - p.y, 9.0), 1.6));          // -45°
    if (t > 0.64) ink = max(ink, step(mod(p.x, 7.0), 1.4));
    if (t > 0.84) ink = max(ink, step(mod(p.y, 7.0), 1.4));
    vec3 paper = vec3(0.965, 0.945, 0.905);
    col = mix(paper, vec3(0.16, 0.13, 0.11), ink * 0.9);

  } else if (uStyle == 9) {
    float t = texture(uTex, uvw).r;
    vec3 glow = applyColormap(uCmap, t);
    float scan = 0.72 + 0.28 * step(mod(gl_FragCoord.y, 3.0), 1.5);
    float sub = mod(floor(gl_FragCoord.x), 3.0);
    vec3 mask = sub < 0.5 ? vec3(1.15, 0.9, 0.9) : (sub < 1.5 ? vec3(0.9, 1.15, 0.9) : vec3(0.9, 0.9, 1.15));
    col = glow * glow * 1.35 * scan * mask;
    col += glow * 0.12;

  } else if (uStyle == 10) {
    float t = texture(uTex, uvw).r;
    vec3 blue = vec3(0.05, 0.16, 0.38);
    float line = contourLine(t, n, 1.8);
    float major = contourLine(t, max(n / 5.0, 1.0), 2.4);
    vec2 gp = mod(gl_FragCoord.xy, 24.0);
    float grid = max(step(gp.x, 1.0), step(gp.y, 1.0));
    col = blue + vec3(0.04, 0.07, 0.12) * t;
    col = mix(col, blue * 0.75 + vec3(0.06), grid * 0.5);
    col = mix(col, vec3(0.62, 0.76, 0.92), line * 0.85);
    col = mix(col, vec3(0.96, 0.98, 1.0), major * 0.95);

  } else if (uStyle == 11) {
    float t = texture(uTex, uvw).r;
    float w1 = sin(t * n * 6.2832);
    float w2 = sin(length(gl_FragCoord.xy * 0.5) * 0.35);
    float inter = (w1 * w2) * 0.5 + 0.5;
    col = applyColormap(uCmap, t) * (0.45 + 0.65 * smoothstep(0.25, 0.85, inter));

  } else if (uStyle == 12) {
    float t = texture(uTex, uvw).r;
    float swirl = sin((uvw.x + uvw.y * 1.7 + t * 5.0) * 22.0 + sin(uvw.z * 31.0 + t * 9.0) * 3.0);
    float band = smoothstep(-0.15, 0.15, swirl);
    vec3 inkA = applyColormap(uCmap, t) * 0.8;
    vec3 paper = vec3(0.955, 0.94, 0.90);
    col = mix(paper, inkA, band * (0.25 + t * 0.75));

  } else if (uStyle == 13) {
    float t = texture(uTex, uvw).r;
    vec2 cell = floor(gl_FragCoord.xy / 7.0);
    float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
    vec2 jitter = (vec2(h1, h2) - 0.5) * 3.0;
    vec2 local = mod(gl_FragCoord.xy, 7.0) - 3.5 - jitter;
    float appear = step(h1, t * 1.25);
    float dot_ = step(length(local), 1.1 + t * 1.6) * appear;
    vec3 paper = vec3(0.965, 0.95, 0.915);
    vec3 ink = applyColormap(uCmap, clamp(t + (h2 - 0.5) * 0.18, 0.0, 1.0));
    col = mix(paper, ink * 0.9, dot_);

  } else if (uStyle == 14) {
    float t = texture(uTex, uvw).r;
    float density = fwidth(t * n);
    float f = abs(fract(t * n + 0.5) - 0.5);
    float fw = density * 1.2 + 1e-4;
    float core = 1.0 - smoothstep(0.0, fw * 1.6, f);
    float halo = 1.0 - smoothstep(0.0, fw * 7.0, f);
    float fade = smoothstep(0.0, 0.6 / n, t) * smoothstep(1.0, 1.0 - 0.6 / n, t);
    fade *= 1.0 - smoothstep(0.35, 0.8, density);
    vec3 glow = applyColormap(uCmap, t);
    col = vec3(0.02, 0.02, 0.045);
    col += glow * halo * halo * 0.55 * fade;
    col += (glow * 0.55 + vec3(0.45)) * core * fade;

  } else if (uStyle == 15) {
    float t = texture(uTex, uvw).r;
    float wave = sin(uvw.x * 40.0 + uvw.y * 8.0) * 0.12;
    float carve = sin((t + wave) * n * 3.1416);
    float ink = step(carve, t * 1.7 - 0.75);
    vec3 paper = vec3(0.94, 0.90, 0.83);
    col = mix(paper, vec3(0.10, 0.075, 0.06), ink);

  } else if (uStyle == 16) {
    float t = texture(uTex, uvw).r;
    vec3 neg = vec3(1.0) - applyColormap(uCmap, t);
    neg = neg * vec3(1.0, 0.82, 0.62) + vec3(0.12, 0.06, 0.0);
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col = neg + (grain - 0.5) * 0.08;

  } else if (uStyle == 17) {
    float t = texture(uTex, uvw).r;
    float fine = contourLine(t, n * 3.0, 1.1);
    float coarse = contourLine(t, n, 1.9);
    float shade = step(mod(gl_FragCoord.x + gl_FragCoord.y * 0.5, 5.0), 1.1) * smoothstep(0.55, 0.95, t);
    vec3 paper = vec3(0.93, 0.89, 0.80);
    col = paper;
    col = mix(col, vec3(0.42, 0.36, 0.28), fine * 0.55);
    col = mix(col, vec3(0.13, 0.10, 0.07), coarse * 0.9);
    col = mix(col, vec3(0.22, 0.18, 0.13), shade * 0.7);

  } else {
    float t = texture(uTex, uvw).r;
    col = applyColormap(uCmap, t);
    if (uContours > 0.5) {
      float line = contourLine(smoothSample(uvw), uContours, 1.6);
      col = mix(col, uLineCol, line * 0.85);
    }
  }

  fragColor = vec4(col, alpha);
}
`

function SlicePlane({
  vol,
  plane,
  settings,
}: {
  vol: ProceduralVolumeData
  plane: SlicePlaneDef
  settings: VolumeLayerSettings
}) {
  const invalidate = useThree((state) => state.invalidate)
  const texture = useMemo(() => {
    const [nx, ny, nz] = vol.dims
    // R16F avoids visible contour quantization while retaining core WebGL2 filtering support.
    const f16 = new Uint16Array(vol.data.length)
    for (let i = 0; i < vol.data.length; i++) f16[i] = THREE.DataUtils.toHalfFloat(Math.min(1, Math.max(0, vol.data[i])))
    const tex = new THREE.Data3DTexture(f16, nx, ny, nz)
    tex.format = THREE.RedFormat
    tex.type = THREE.HalfFloatType
    tex.internalFormat = "R16F"
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    return tex
  }, [vol])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SLICE_VERT,
        fragmentShader: SLICE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        clipping: true,
        uniforms: {
          uTex: { value: texture },
          uOriginW: { value: new THREE.Vector3() },
          uInvSize: { value: new THREE.Vector3() },
          uCmap: { value: 0 },
          uStyle: { value: 0 },
          uContours: { value: 0 },
          uOpacity: { value: 1 },
          uDiverging: { value: 0 },
          uLineCol: { value: new THREE.Color(0.15, 0.13, 0.11) },
          uBgCol: { value: new THREE.Color(0.97, 0.955, 0.92) },
          uTexel: { value: new THREE.Vector3(1 / 48, 1 / 48, 1 / 48) },
        },
      }),
    [],
  )

  useEffect(() => {
    material.uniforms.uTex.value = texture
    material.uniforms.uOriginW.value.set(
      vol.origin[0],
      vol.origin[1],
      vol.origin[2],
    )
    material.uniforms.uInvSize.value.set(1 / vol.size[0], 1 / vol.size[1], 1 / vol.size[2])
    material.uniforms.uCmap.value = COLORMAP_INDEX[settings.sliceColormap] ?? 0
    material.uniforms.uStyle.value = SLICE_STYLE_INDEX[settings.sliceStyle] ?? 0
    material.uniforms.uContours.value =
      settings.sliceStyle === "smooth" ? settings.sliceContours : Math.max(settings.sliceContours, 10)
    material.uniforms.uOpacity.value = settings.sliceOpacity
    material.uniforms.uDiverging.value = vol.diverging ? 1 : 0
    material.uniforms.uLineCol.value.setStyle(settings.sliceLineColor || "#26221c", THREE.NoColorSpace)
    material.uniforms.uBgCol.value.setStyle(settings.sliceBgColor || "#f7f4eb", THREE.NoColorSpace)
    material.uniforms.uTexel.value.set(1 / vol.dims[0], 1 / vol.dims[1], 1 / vol.dims[2])
    invalidate()
  }, [
    material,
    texture,
    vol,
    settings.sliceColormap,
    settings.sliceStyle,
    settings.sliceContours,
    settings.sliceOpacity,
    settings.sliceLineColor,
    settings.sliceBgColor,
    invalidate,
  ])

  useEffect(() => () => { texture.dispose() }, [texture])
  useEffect(() => () => { material.dispose() }, [material])

  const quat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal)
    return q
  }, [plane])

  const useGeomLines = settings.sliceStyle === "lines" || settings.sliceStyle === "diverging"

  return (
    <group>
      <mesh position={plane.point} quaternion={quat} material={material} renderOrder={2}>
        <planeGeometry args={[plane.quadSize, plane.quadSize]} />
      </mesh>
      {useGeomLines && <SliceContourGeom vol={vol} plane={plane} settings={settings} />}
    </group>
  )
}


/** Trilinearly sample the volume; coordinates outside its bounds return NaN. */
function sampleVolume(vol: ProceduralVolumeData, x: number, y: number, z: number): number {
  const [nx, ny, nz] = vol.dims
  const fx = ((x - vol.origin[0]) / vol.size[0]) * (nx - 1)
  const fy = ((y - vol.origin[1]) / vol.size[1]) * (ny - 1)
  const fz = ((z - vol.origin[2]) / vol.size[2]) * (nz - 1)
  if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return Number.NaN
  const ix = Math.min(Math.floor(fx), nx - 2)
  const iy = Math.min(Math.floor(fy), ny - 2)
  const iz = Math.min(Math.floor(fz), nz - 2)
  const tx = fx - ix, ty = fy - iy, tz = fz - iz
  const idx = (a: number, b: number, c: number) => a + b * nx + c * nx * ny
  const d = vol.data
  const c00 = d[idx(ix, iy, iz)] * (1 - tx) + d[idx(ix + 1, iy, iz)] * tx
  const c10 = d[idx(ix, iy + 1, iz)] * (1 - tx) + d[idx(ix + 1, iy + 1, iz)] * tx
  const c01 = d[idx(ix, iy, iz + 1)] * (1 - tx) + d[idx(ix + 1, iy, iz + 1)] * tx
  const c11 = d[idx(ix, iy + 1, iz + 1)] * (1 - tx) + d[idx(ix + 1, iy + 1, iz + 1)] * tx
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
}

function SliceContourGeom({
  vol,
  plane,
  settings,
}: {
  vol: ProceduralVolumeData
  plane: SlicePlaneDef
  settings: VolumeLayerSettings
}) {
  const n = Math.max(settings.sliceContours, 10)
  const diverging = vol.diverging
  const style = settings.sliceStyle

  const { solidGeom, dashGeom } = useMemo(() => {
    // Smooth a dense plane sample before marching squares to suppress voxel-edge kinks.
    const RES = 200
    const normal = plane.normal
    const helper = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
    const e1 = new THREE.Vector3().crossVectors(normal, helper).normalize()
    const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize()
    const half = plane.quadSize / 2

    const raw = new Float32Array(RES * RES)
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const u = (i / (RES - 1)) * 2 - 1
        const v = (j / (RES - 1)) * 2 - 1
        const px = plane.point.x + e1.x * u * half + e2.x * v * half
        const py = plane.point.y + e1.y * u * half + e2.y * v * half
        const pz = plane.point.z + e1.z * u * half + e2.z * v * half
        raw[i + j * RES] = sampleVolume(vol, px, py, pz)
      }
    }
    const grid = new Float32Array(RES * RES)
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        let sum = 0, cnt = 0
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj
          if (ii < 0 || jj < 0 || ii >= RES || jj >= RES) continue
          const val = raw[ii + jj * RES]
          if (!Number.isNaN(val)) { sum += val; cnt++ }
        }
        grid[i + j * RES] = cnt > 0 && !Number.isNaN(raw[i + j * RES]) ? sum / cnt : Number.NaN
      }
    }
    const sampleGrid = (i: number, j: number) => grid[i + j * RES]

    const lift = plane.quadSize * 0.002
    const toWorld = (u: number, v: number): [number, number, number] => {
      const uu = u * 2 - 1
      const vv = v * 2 - 1
      return [
        plane.point.x + e1.x * uu * half + e2.x * vv * half + normal.x * lift,
        plane.point.y + e1.y * uu * half + e2.y * vv * half + normal.y * lift,
        plane.point.z + e1.z * uu * half + e2.z * vv * half + normal.z * lift,
      ]
    }

    const solidPos: number[] = []
    const dashPos: number[] = []
    const dashDist: number[] = []
    const worldScale = plane.quadSize

    for (let k = 1; k < n; k++) {
      const level = k / n
      if (diverging && Math.abs(level - 0.5) < 0.7 / n) continue
      const isNeg = style === "diverging" && diverging && level < 0.5
      const polylines = extractContour(sampleGrid, RES, level)
      for (const rawLine of polylines) {
        if (rawLine.length < 4) continue
        // Chaikin smoothing turns marching-squares corners into stable display curves.
        const line = chaikinSmooth(rawLine, 3)
        if (isNeg) {
          let acc = 0
          for (let p = 0; p < line.length - 1; p++) {
            const a = toWorld(line[p][0], line[p][1])
            const b = toWorld(line[p + 1][0], line[p + 1][1])
            const segLen =
              Math.hypot(
                (line[p + 1][0] - line[p][0]) * worldScale,
                (line[p + 1][1] - line[p][1]) * worldScale,
              )
            dashPos.push(...a, ...b)
            dashDist.push(acc, acc + segLen)
            acc += segLen
          }
        } else {
          for (let p = 0; p < line.length - 1; p++) {
            solidPos.push(...toWorld(line[p][0], line[p][1]), ...toWorld(line[p + 1][0], line[p + 1][1]))
          }
        }
      }
    }

    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3))
      return g
    }
    const dg = mk(dashPos)
    dg.setAttribute("lineDistance", new THREE.Float32BufferAttribute(dashDist, 1))
    return { solidGeom: mk(solidPos), dashGeom: dg }
  }, [vol, plane, n, diverging, style])

  useEffect(
    () => () => { solidGeom.dispose(); dashGeom.dispose() },
    [solidGeom, dashGeom],
  )

  // Scale dash cadence with the plane so small closed contours remain legible.
  const dashLen = plane.quadSize * 0.011
  const posColor = style === "diverging" ? "#c41414" : settings.sliceLineColor || "#26221c"

  return (
    <group>
      <lineSegments geometry={solidGeom} renderOrder={3}>
        <lineBasicMaterial color={posColor} transparent opacity={settings.sliceOpacity} />
      </lineSegments>
      {style === "diverging" && (
        <lineSegments geometry={dashGeom} renderOrder={3}>
          <lineDashedMaterial
            color="#1a38b8"
            dashSize={dashLen}
            gapSize={dashLen * 0.7}
            transparent
            opacity={settings.sliceOpacity}
          />
        </lineSegments>
      )}
    </group>
  )
}

/* ---------- Worker-backed scene entry ---------- */

function VolumeLayerRenderer({
  built,
  settings,
  result,
}: {
  built: ProceduralVolumeStructure
  settings: VolumeLayerSettings
  result: ProceduralVolumeResult
}) {
  const isWebGL2 = useThree((state) => state.gl.capabilities.isWebGL2)
  const volume = result.volume
  const plane = useMemo(
    () => computeSlicePlane(built, settings, volume),
    [built, settings.sliceH, settings.sliceK, settings.sliceL, settings.sliceOffset, volume],
  )
  const clipPlane = useMemo(() => {
    if (!isWebGL2 || !plane || !settings.sliceEnabled || settings.sliceClip === 'none') return null
    const normal = plane.normal.clone()
    if (settings.sliceClip === 'front') normal.negate()
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, plane.point)
  }, [isWebGL2, plane, settings.sliceClip, settings.sliceEnabled])
  const isolate = settings.sliceEnabled && settings.sliceIsolate

  return (
    <group>
      {!isolate && result.positive && (
        <IsoLobe surface={result.positive} color={settings.isoColorPos} settings={settings} clipPlane={clipPlane} />
      )}
      {!isolate && result.negative && (
        <IsoLobe surface={result.negative} color={settings.isoColorNeg} settings={settings} clipPlane={clipPlane} />
      )}
      {isWebGL2 && settings.sliceEnabled && plane && (
        <SlicePlane vol={volume} plane={plane} settings={settings} />
      )}
    </group>
  )
}

export function ProceduralVolumeLayer({
  onRenderableChange,
}: {
  onRenderableChange?: (renderable: boolean) => void
}) {
  const state = useCrystalStore()
  const isWebGL2 = useThree((threeState) => threeState.gl.capabilities.isWebGL2)
  const workerRef = useRef<Worker | null>(null)
  const latestRequestRef = useRef<string | null>(null)
  const requestCounterRef = useRef(0)
  const [result, setResult] = useState<ProceduralVolumeResult | null>(null)

  const built = useMemo<ProceduralVolumeStructure | null>(() => {
    if (!state.periodic || state.compactStructure || state.atoms.length === 0 || state.atoms.length > MAX_PROCEDURAL_VOLUME_ATOMS) return null
    const atoms = state.atoms
      .filter((atom) => Boolean(atom.cartesian))
      .map((atom) => ({ element: atom.element, position: atom.cartesian! }))
    if (atoms.length !== state.atoms.length) return null
    const indexById = new Map(state.atoms.map((atom, index) => [atom.id, index]))
    const bonds = state.bonds.flatMap((bond) => {
      const a = indexById.get(bond.atom1Id)
      const b = indexById.get(bond.atom2Id)
      return a === undefined || b === undefined ? [] : [{ a, b }]
    })
    return {
      atoms,
      bonds,
      latticeVectors: [state.latticeVectors.a, state.latticeVectors.b, state.latticeVectors.c],
      supercell: [state.supercellParams.nx, state.supercellParams.ny, state.supercellParams.nz],
    }
  }, [state.atoms, state.bonds, state.compactStructure, state.latticeVectors, state.periodic, state.supercellParams])

  const settings = useMemo<VolumeLayerSettings>(() => ({
    stylePresetId: state.stylePresetId,
    radiusScale: state.radiusScale,
    bondRadius: state.bondRadius,
    background: state.background,
    outline: state.outline,
    outlineWidth: state.outlineWidth,
    outlineColor: state.outlineColor,
    sphereDetail: state.sphereDetail,
    vanDerWaalsSpaceFill: state.vanDerWaalsSpaceFill,
    fusedAtomSurface: state.fusedAtomSurface,
    elementOverrides: state.elementOverrides,
    atomShininess: state.atomShininess,
    bondBicolor: state.bondBicolor,
    bondColor: state.bondColor,
    polyStyle: state.polyStyle,
    polyColorSource: state.polyColorSource,
    polyElementColors: state.polyElementColors,
    polyColor: state.polyColor,
    showPolyEdges: state.showPolyEdges,
    polyEdgeColor: state.polyEdgeColor,
    polyEdgeOpacity: state.polyEdgeOpacity,
    polySpecular: state.polySpecular,
    polyShininess: state.polyShininess,
    polyFresnel: state.polyFresnel,
    cellColor: state.cellColor,
    cellLineWidth: state.cellLineWidth,
    showCrystalAxes: state.showCrystalAxes,
    autoRotate: state.autoRotate,
    ambientIntensity: state.ambientIntensity,
    diffuseIntensity: state.diffuseIntensity,
    specularIntensity: state.specularIntensity,
    rimIntensity: state.rimIntensity,
    volumeField: state.volumeField,
    volumeResolution: state.volumeResolution,
    isoLevel: state.isoLevel,
    isoStyle: state.isoStyle,
    isoOpacity: state.isoOpacity,
    isoColorPos: state.isoColorPos,
    isoColorNeg: state.isoColorNeg,
    sliceEnabled: state.sliceEnabled,
    sliceH: state.sliceH,
    sliceK: state.sliceK,
    sliceL: state.sliceL,
    sliceOffset: state.sliceOffset,
    sliceColormap: state.sliceColormap,
    sliceStyle: state.sliceStyle,
    sliceContours: state.sliceContours,
    sliceOpacity: state.sliceOpacity,
    sliceClip: state.sliceClip,
    sliceIsolate: state.sliceIsolate,
    sliceLineColor: state.sliceLineColor,
    sliceBgColor: state.sliceBgColor,
    lightAzimuth: state.lightAzimuth ?? 40,
    lightElevation: state.lightElevation ?? 25,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
    lightFill: state.lightFill,
    lightFollowsCamera: state.lightFollowsCamera,
  }), [
    state.ambientIntensity, state.atomShininess, state.autoRotate, state.background, state.bondBicolor,
    state.bondColor, state.bondRadius, state.cellColor, state.cellLineWidth, state.diffuseIntensity, state.elementOverrides,
    state.isoColorNeg, state.isoColorPos, state.isoLevel, state.isoOpacity, state.isoStyle,
    state.lightAmbient, state.lightAzimuth, state.lightElevation, state.lightFill, state.lightFollowsCamera, state.lightKey,
    state.outline, state.outlineColor, state.outlineWidth,
    state.polyColor, state.polyColorSource, state.polyEdgeColor, state.polyEdgeOpacity,
    state.polyElementColors, state.polyFresnel, state.polyShininess, state.polySpecular,
    state.polyStyle, state.radiusScale, state.rimIntensity, state.showCrystalAxes, state.showPolyEdges, state.sliceBgColor,
    state.sliceClip, state.sliceColormap, state.sliceContours, state.sliceEnabled, state.sliceH,
    state.sliceIsolate, state.sliceK, state.sliceL, state.sliceLineColor, state.sliceOffset,
    state.sliceOpacity, state.sliceStyle, state.specularIntensity, state.sphereDetail, state.stylePresetId,
    state.volumeField, state.volumeResolution,
  ])

  const job = useMemo<ProceduralVolumeJob | null>(() => {
    if (!built || state.volumeField === 'none') return null
    return {
      structure: built,
      field: state.volumeField,
      resolution: state.volumeResolution,
      isoLevel: state.isoLevel,
      generateSurface: !(state.sliceEnabled && state.sliceIsolate),
    }
  }, [built, state.isoLevel, state.sliceEnabled, state.sliceIsolate, state.volumeField, state.volumeResolution])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const hasValidSlicePlane = state.sliceH !== 0 || state.sliceK !== 0 || state.sliceL !== 0
  const renderable = Boolean(
    built
    && result
    && state.volumeField !== 'none'
    && (!state.sliceEnabled || (hasValidSlicePlane && isWebGL2)),
  )
  useEffect(() => {
    onRenderableChange?.(renderable)
  }, [onRenderableChange, renderable])
  useEffect(() => () => onRenderableChange?.(false), [onRenderableChange])

  useEffect(() => {
    if (!job) {
      latestRequestRef.current = null
      setResult(null)
      return
    }
    const requestId = `procedural-volume:${++requestCounterRef.current}`
    latestRequestRef.current = requestId
    setResult(null)

    if (typeof Worker === 'undefined') {
      try {
        setResult(generateProceduralVolume(job))
      } catch (error) {
        console.error('Failed to generate illustrative scalar field', error)
      }
      return
    }

    workerRef.current?.terminate()
    const worker = new Worker(
      new URL('../../../lib/render/procedural-volume.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    let disposed = false
    const handleMessage = (event: MessageEvent<ProceduralVolumeWorkerResponse>) => {
      if (disposed || event.data.requestId !== latestRequestRef.current) return
      if (event.data.error) {
        console.error('Illustrative scalar-field worker failed', event.data.error)
        setResult(null)
        return
      }
      setResult(event.data.result)
    }
    worker.addEventListener('message', handleMessage)
    const request: ProceduralVolumeWorkerRequest = { requestId, job }
    worker.postMessage(request)
    return () => {
      disposed = true
      worker.removeEventListener('message', handleMessage)
      if (workerRef.current === worker) {
        worker.terminate()
        workerRef.current = null
      }
    }
  }, [job])

  if (!built || !result || state.volumeField === 'none') return null
  return <VolumeLayerRenderer built={built} settings={settings} result={result} />
}
