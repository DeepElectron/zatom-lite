'use client'

/** GPU ray-marched bond renderer with periodic image and selection-preview parity. */
import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atom, Bond } from '../../../lib/crystal/types'
import {
  getDefaultCrystalElementVisual,
  type ElementVisualOverride,
} from '../../../lib/render/crystal-visuals'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { applySelectionTransformPreviewToPosition } from '../../../lib/selection-transform-preview'
import { useDisplayPositions } from './use-display-positions'
import { useDisplayImages } from './use-display-image-offsets'
import { buildBondSegments, type BondSegment } from '../../../lib/crystal/display-periodic-images'
import { lightDirectionFromAngles } from '../../../lib/lighting'
import { SHADING_MODE_MAP } from '../../../lib/render/stylized-material'
import type { RenderStyle } from '../../../lib/render/crystal-visuals'
import type { LayerRenderOverride } from './layer-render-override'
import { AtomMesh } from './atom-renderer'

// Per-bond data (P1/P2/colors/radii) ships as InstancedBufferAttributes
// instead of per-mesh uniforms — one draw call for the entire bond list.
// Lighting + uShrink stay as scene-wide uniforms.
const VERT = /* glsl */ `
attribute vec3 aP1;
attribute vec3 aP2;
attribute vec3 aColor1;
attribute vec3 aColor2;
attribute float aR1;
attribute float aR2;
attribute float aAtomR1;
attribute float aAtomR2;
varying vec3 vWP, vP1, vP2;
varying vec3 vC1, vC2;
varying float vR1, vR2, vAtomR1, vAtomR2;
varying mat4 vPV;
void main() {
  vP1 = aP1; vP2 = aP2;
  vC1 = aColor1; vC2 = aColor2;
  vR1 = aR1; vR2 = aR2;
  vAtomR1 = aAtomR1; vAtomR2 = aAtomR2;
  vPV = projectionMatrix * viewMatrix;
  // instanceMatrix is auto-declared by three.js for InstancedMesh, but raw
  // ShaderMaterial does NOT auto-multiply it in (the standard chunks do).
  // Without this, every bond stacks at the mesh origin and the box rasterizes
  // straight through the SDF discard.
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const HYPER_STICK_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uLight;
uniform float uHeadlight;
uniform float uAmbient, uKey, uFill, uShrink;
uniform vec3 uBondColor;
uniform float uBondBicolor, uSpecular, uShininess, uRim, uOpacity, uMode;
varying vec3 vWP, vP1, vP2;
varying vec3 vC1, vC2;
varying float vR1, vR2, vAtomR1, vAtomR2;
varying mat4 vPV;
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdfStick(vec3 p,vec3 p1,vec3 p2,float r){vec3 ba=p2-p1;float bl=length(ba);vec3 bn=ba/bl;float h=clamp(dot(p-p1,bn)/bl,0.,1.);return length(p-p1-h*ba)-r;}
float sdf(vec3 p,vec3 p1,vec3 p2,float r1,float r2,float s){
  float d1=length(p-p1)-r1,d2=length(p-p2)-r2,ar=mix(r1,r2,.5);
  float dS=sdfStick(p,p1,p2,ar*s),k=ar*(.3+.7*s*s);
  return smin(smin(d1,dS,k),d2,k);
}

vec3 hsv2rgb(vec3 c){
  vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);
  return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);
}

float bayer4(vec2 p){
  vec2 q=floor(mod(p,4.));float i=q.x+q.y*4.;float m=0.;
  if(i<.5)m=0.;else if(i<1.5)m=8.;else if(i<2.5)m=2.;else if(i<3.5)m=10.;
  else if(i<4.5)m=12.;else if(i<5.5)m=4.;else if(i<6.5)m=14.;else if(i<7.5)m=6.;
  else if(i<8.5)m=3.;else if(i<9.5)m=11.;else if(i<10.5)m=1.;else if(i<11.5)m=9.;
  else if(i<12.5)m=15.;else if(i<13.5)m=7.;else if(i<14.5)m=13.;else m=5.;
  return(m+.5)/16.;
}

vec3 ironbow(float t){
  t=clamp(t,0.,1.);
  vec3 a=vec3(.02,0.,.12),b=vec3(.55,0.,.60),c=vec3(.95,.25,.05);
  vec3 d=vec3(1.,.80,.10),e=vec3(1.,1.,.95);
  if(t<.25)return mix(a,b,t/.25);if(t<.55)return mix(b,c,(t-.25)/.30);
  if(t<.85)return mix(c,d,(t-.55)/.30);return mix(d,e,(t-.85)/.15);
}

vec4 shadeNpr(vec3 baseColor,vec3 N,vec3 V,vec3 worldPos){
  // For a view-following headlight, the world-space surface-to-camera vector is the light vector.
  vec3 L=uHeadlight>.5?V:uLight;
  float ndl=max(dot(N,L),0.);
  float ambient=uAmbient+.18*uFill;
  float alpha=uOpacity;
  vec3 col;
  int mode=int(uMode+.5);
  vec3 viewN=normalize(mat3(viewMatrix)*N);
  vec3 viewL=normalize(mat3(viewMatrix)*L);

  if(mode==1){
    col=baseColor;
  }else if(mode==2){
    float band=ndl>.42?1.:0.;col=baseColor*clamp(ambient+uKey*band,0.,1.);
  }else if(mode==3){
    vec3 cool=vec3(.05,.10,.45)+.25*baseColor;
    vec3 warm=vec3(.45,.35,.05)+.85*baseColor;
    col=mix(cool,warm,.5*(dot(N,L)+1.));
    col+=vec3(1.)*pow(max(dot(N,normalize(L+V)),0.),64.)*.5*step(.01,uSpecular);
  }else if(mode==4){
    float lum=ambient+uKey*ndl;vec2 sc=gl_FragCoord.xy;float ink=0.;
    if(lum<.85)ink=max(ink,step(mod(sc.x+sc.y,9.),1.4));
    if(lum<.65)ink=max(ink,step(mod(sc.x-sc.y,9.),1.4));
    if(lum<.45)ink=max(ink,step(mod(sc.x+sc.y*.5,5.),1.2));
    if(lum<.28)ink=max(ink,step(mod(sc.y,4.),1.2));
    col=mix(mix(baseColor,vec3(.97),.72),vec3(.13,.11,.10),ink);
  }else if(mode==5){
    float fres=pow(1.-abs(dot(N,V)),1.5);float baseLum=ambient+uKey*ndl;
    float hueShift=fres*.45+dot(viewN,vec3(.3,.59,.11))*.08;
    float mx=max(baseColor.r,max(baseColor.g,baseColor.b));
    float mn=min(baseColor.r,min(baseColor.g,baseColor.b));float h=0.;float delta=mx-mn;
    if(delta>.001){if(mx==baseColor.r)h=mod((baseColor.g-baseColor.b)/delta,6.)/6.;
      else if(mx==baseColor.g)h=((baseColor.b-baseColor.r)/delta+2.)/6.;
      else h=((baseColor.r-baseColor.g)/delta+4.)/6.;}
    vec3 shifted=hsv2rgb(vec3(fract(h+hueShift),.75,1.));
    col=shifted*baseLum+vec3(1.)*pow(max(dot(N,normalize(L+V)),0.),90.)*.9+shifted*fres*.55;
  }else if(mode==6){
    float fres=pow(1.-abs(dot(N,V)),1.8);
    col=baseColor*(.35+.65*fres)+vec3(.6)*fres;
    alpha=uOpacity*clamp(.06+fres*1.1,0.,1.);
  }else if(mode==7){
    float lum=clamp(ambient+uKey*ndl,0.,1.);
    vec2 grid=mod(gl_FragCoord.xy,7.)-3.5;float ink=step(length(grid),(1.-lum)*4.2);
    col=mix(mix(baseColor,vec3(1.),.15),baseColor*.22,ink);
  }else if(mode==8){
    float t=ambient*.4+uKey*ndl+pow(1.-abs(dot(N,V)),2.)*-.25;
    col=ironbow(clamp(t+.15,0.,1.));
  }else if(mode==9){
    float q=floor(ndl*5.)/5.;float lum=clamp(ambient*.8+uKey*(q*.85+ndl*.15),0.,1.15);
    float fres=pow(1.-abs(dot(N,V)),2.2);
    col=baseColor*lum+vec3(1.)*pow(max(dot(N,normalize(L+V)),0.),220.)*1.2;
    col+=hsv2rgb(vec3(fract(fres*1.8+.55),.6,1.))*fres*.5;
  }else if(mode==10){
    float fres=pow(1.-abs(dot(N,V)),1.6);
    float scan=step(mod(gl_FragCoord.y,4.),1.6),band=step(mod(gl_FragCoord.y*.08,8.),.5);
    col=baseColor*(.5+.8*fres)+vec3(.45)*fres+baseColor*scan*.35+vec3(1.)*band*.25;
    alpha=uOpacity*clamp(.10+fres*.9+scan*.12,0.,1.);
  }else if(mode==11){
    float lum=clamp(ambient+uKey*ndl,0.,1.);
    lum*=dot(baseColor,vec3(.35,.5,.15))+.35;
    col=mix(vec3(.07,.07,.09),vec3(.93,.91,.86),step(bayer4(gl_FragCoord.xy*.5),lum));
  }else if(mode==12){
    vec2 cell=floor(gl_FragCoord.xy/6.)*6.+3.;vec2 dxy=(cell-gl_FragCoord.xy)*.004;
    vec3 Nq=normalize(viewN+vec3(dxy,0.));
    float lum=clamp(ambient+uKey*max(dot(Nq,viewL),0.),0.,1.);
    lum=floor(lum*4.+.5)/4.;vec3 cq=floor(baseColor*5.+.5)/5.;col=cq*(.35+.75*lum);
  }else if(mode==13){
    float lum=clamp(ambient+uKey*ndl,0.,1.);
    float grain=fract(sin(dot(floor(gl_FragCoord.xy*.7),vec2(12.9898,78.233)))*43758.5453);
    float ink=step(lum+(grain-.5)*.55,.62);
    col=mix(vec3(.96,.93,.86),baseColor*.75+vec3(.02),ink*.92);
  }else if(mode==14){
    float fres=pow(1.-abs(dot(N,V)),1.35);float lum=ambient*.55+uKey*ndl*.4;
    col=baseColor*lum+baseColor*fres*1.05+vec3(1.)*pow(fres,3.)*.22;
  }else if(mode==15){
    vec2 muv=viewN.xy*.5+.5;
    float shade=smoothstep(.95,.12,length(muv-vec2(.36,.66)));
    float bounce=smoothstep(.75,.2,length(muv-vec2(.5,.08)))*.18;
    float hot=smoothstep(.22,0.,length(muv-vec2(.40,.75)))*.35;
    col=baseColor*(.28+shade*.78+bounce)+vec3(1.)*hot;
  }else if(mode==16){
    float bandY=worldPos.y*6.;float band=step(fract(bandY),.5);
    float lum=clamp(ambient+uKey*ndl,0.,1.1);col=baseColor*lum*(.68+.44*band);
    float f=abs(fract(bandY)-.5),fw=fwidth(bandY)*1.5+1e-4;
    float seam=1.-smoothstep(0.,fw*2.5,min(f,.5-f));col*=1.-seam*.5;
  }else{
    // Preserve the original HyperStick lighting exactly for VESTA/default.
    float lightStrength=clamp(uAmbient+uKey*ndl+.18*uFill,0.,1.);
    float sp=pow(max(dot(N,normalize(L+V)),0.),max(uShininess,1.));
    col=baseColor*lightStrength+vec3(1.)*sp*uSpecular;
  }

  if(uRim>.001&&mode!=6){float rim=pow(1.-abs(dot(N,V)),2.);col+=vec3(1.)*rim*uRim;}
  return vec4(col,alpha);
}

void main(){
  vec3 ro=cameraPosition,rd=normalize(vWP-ro);
  // BackSide starts on the far face, so back up beyond the near face with a conservative bound.
  float maxR=max(vR1,vR2);
  float t=max(length(vWP-ro)-length(vP2-vP1)-5.*maxR,0.);
  vec3 hit;bool found=false;
  // 32 iters w/ step .8 — convergence within tightened bounding box is fine;
  // dropping from 48 saves ~33% of the dominant fragment cost.
  for(int i=0;i<32;i++){hit=ro+t*rd;float d=sdf(hit,vP1,vP2,vR1,vR2,uShrink);if(d<.001){found=true;break;}if(d>50.)break;t+=d*.8;}
  if(!found)discard;
  float d1=distance(hit,vP1),d2=distance(hit,vP2);
  vec4 hc=vPV*vec4(hit,1.);gl_FragDepth=(hc.z/hc.w)*.5+.5;
  // 4-tap tetrahedral SDF normal — 4 evals instead of the 6-tap central diff.
  vec2 K=vec2(1.0,-1.0);
  vec3 n=normalize(
    K.xyy*sdf(hit+K.xyy*.002,vP1,vP2,vR1,vR2,uShrink)
    +K.yyx*sdf(hit+K.yyx*.002,vP1,vP2,vR1,vR2,uShrink)
    +K.yxy*sdf(hit+K.yxy*.002,vP1,vP2,vR1,vR2,uShrink)
    +K.xxx*sdf(hit+K.xxx*.002,vP1,vP2,vR1,vR2,uShrink)
  );
  float px1=1.-clamp((d1-vAtomR1)/(vAtomR1*.3),0.,1.),px2=1.-clamp((d2-vAtomR2)/(vAtomR2*.3),0.,1.);
  n=mix(n,normalize(hit-vP1),px1*px1);n=mix(n,normalize(hit-vP2),px2*px2);n=normalize(n);
  float ex1=max(d1-vAtomR1,0.),ex2=max(d2-vAtomR2,0.);
  float bl=smoothstep(0.,1.,ex2/max(ex1+ex2,.0001));
  vec3 col=mix(vC2,vC1,bl);
  if(uBondBicolor<.5){
    col=uBondColor;
    col=mix(col,vC1,px1*px1);
    col=mix(col,vC2,px2*px2);
  }
  vec3 viewDir=normalize(ro-hit);
  gl_FragColor=shadeNpr(col,n,viewDir,hit);
}
`

const UNIT_Z = new THREE.Vector3(0, 0, 1)
const BOX_GEOMETRY_ARGS: [number, number, number] = [1, 1, 1]

interface InstanceFrame {
  midpoint: THREE.Vector3
  quaternion: THREE.Quaternion
  scaleX: number
  scaleY: number
  scaleZ: number
  p1x: number; p1y: number; p1z: number
  p2x: number; p2y: number; p2z: number
  c1r: number; c1g: number; c1b: number
  c2r: number; c2g: number; c2b: number
  r1: number
  r2: number
  atomR1: number
  atomR2: number
}

function buildInstanceFrames(
  segments: readonly BondSegment[],
  atomMap: ReadonlyMap<string, Atom>,
  atomScale: number,
  elementOverrides: Readonly<Record<string, ElementVisualOverride>>,
  colorByAtomId: ReadonlyMap<string, string> | undefined,
  stickScale: number,
  atomRadiusByAtomId: ReadonlyMap<string, number> | undefined,
  bondRadius: number | null,
): InstanceFrame[] {
  const out: InstanceFrame[] = []
  const tmpP1 = new THREE.Vector3()
  const tmpP2 = new THREE.Vector3()
  const tmpDir = new THREE.Vector3()
  const tmpColor = new THREE.Color()

  for (const segment of segments) {
    const bond = segment.bond
    const a1 = atomMap.get(bond.atom1Id)
    const a2 = atomMap.get(bond.atom2Id)
    if (!a1?.cartesian || !a2?.cartesian) continue

    tmpP1.fromArray(segment.p1 as number[])
    tmpP2.fromArray(segment.p2 as number[])
    const length = tmpP1.distanceTo(tmpP2)
    if (length < 0.01) continue

    const e1 = elementOverrides[a1.element] ?? getDefaultCrystalElementVisual(a1.element)
    const e2 = elementOverrides[a2.element] ?? getDefaultCrystalElementVisual(a2.element)
    const presentation: HyperStickPresentation = {
      atomScale,
      stickScale,
      bondRadius,
      opacity: 1,
    }
    const r1 = resolveHyperStickAtomRadius(e1.radius, atomScale, a1.id, presentation, atomRadiusByAtomId)
    const r2 = resolveHyperStickAtomRadius(e2.radius, atomScale, a2.id, presentation, atomRadiusByAtomId)
    const maxRadius = Math.max(r1, r2)

    const midpoint = new THREE.Vector3(
      (tmpP1.x + tmpP2.x) * 0.5,
      (tmpP1.y + tmpP2.y) * 0.5,
      (tmpP1.z + tmpP2.z) * 0.5,
    )
    tmpDir.subVectors(tmpP2, tmpP1).normalize()
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UNIT_Z, tmpDir)

    const c1 = tmpColor.setStyle(colorByAtomId?.get(a1.id) ?? e1.color, THREE.NoColorSpace)
    const c1r = c1.r, c1g = c1.g, c1b = c1.b
    const c2 = tmpColor.setStyle(colorByAtomId?.get(a2.id) ?? e2.color, THREE.NoColorSpace)
    const c2r = c2.r, c2g = c2.g, c2b = c2.b

    const surfaceRadius = maxRadius * Math.max(1, stickScale)
    out.push({
      midpoint,
      quaternion,
      scaleX: surfaceRadius * 2.5,
      scaleY: surfaceRadius * 2.5,
      scaleZ: length + surfaceRadius * 2.5,
      p1x: tmpP1.x, p1y: tmpP1.y, p1z: tmpP1.z,
      p2x: tmpP2.x, p2y: tmpP2.y, p2z: tmpP2.z,
      c1r, c1g, c1b, c2r, c2g, c2b,
      r1, r2,
      atomR1: r1 * 0.98,
      atomR2: r2 * 0.98,
    })
  }
  return out
}

export interface HyperStickPresentation {
  atomScale: number
  stickScale: number
  bondRadius: number | null
  opacity: number
}

export function resolveHyperStickShadingMode(
  renderStyle: RenderStyle,
  renderOverride?: LayerRenderOverride,
): number {
  return renderOverride?.mode ?? SHADING_MODE_MAP[renderStyle]
}

export function resolveHyperStickPresentation(
  atomScale: number,
  renderOverride?: LayerRenderOverride,
): HyperStickPresentation {
  const effectiveAtomScale = Math.max(0.01, renderOverride?.atomScale ?? atomScale)
  const effectiveBondScale = Math.max(0.01, renderOverride?.bondScale ?? effectiveAtomScale)
  const bondRadius = renderOverride?.bondRadius
  return {
    atomScale: effectiveAtomScale,
    stickScale: bondRadius === undefined
      ? Math.max(0.05, Math.min(1.5, 0.45 * effectiveBondScale / effectiveAtomScale))
      : 1,
    bondRadius: bondRadius === undefined ? null : Math.max(0.001, bondRadius),
    opacity: Math.max(0, Math.min(1, renderOverride?.opacity ?? 1)),
  }
}

/** Pure frame contract used by tests and both ordinary/instanced HyperStick paths. */
export function resolveHyperStickAtomRadius(
  elementRadius: number,
  atomScale: number,
  atomId: string,
  presentation: HyperStickPresentation,
  atomRadiusByAtomId?: ReadonlyMap<string, number>,
): number {
  return atomRadiusByAtomId?.get(atomId)
    ?? presentation.bondRadius
    ?? elementRadius * atomScale * .3
}

/** AtomMesh scale for pick/fallback spheres; exact radii must never be scaled twice. */
export function resolveHyperStickAtomMeshScale(
  presentation: HyperStickPresentation,
  renderOverride?: LayerRenderOverride,
): number {
  return renderOverride?.atomRadiusByAtomId ? 1 : presentation.atomScale
}

/**
 * Atom ids represented by one of the SDF bonds. Atoms outside this set need a
 * visible fallback sphere; atoms inside it still need a transparent pick mesh
 * because the deliberately non-raycastable bond boxes identify bonds, not atom
 * endpoints.
 */
export function hyperStickBondedAtomIds(
  atoms: readonly Atom[],
  bonds: readonly Bond[],
): ReadonlySet<string> {
  const atomIds = new Set(atoms.map((atom) => atom.id))
  const bonded = new Set<string>()
  for (const bond of bonds) {
    if (!atomIds.has(bond.atom1Id) || !atomIds.has(bond.atom2Id)) continue
    bonded.add(bond.atom1Id)
    bonded.add(bond.atom2Id)
  }
  return bonded
}

/**
 * Canonical HyperStick presentation: the SDF renderer owns bonded geometry,
 * while canonical AtomMesh instances own endpoint picking, selection feedback,
 * and visible isolated atoms. The SDF bond boxes remain non-raycastable.
 */
export function HyperStickPresentationLayer({
  atoms,
  bonds,
  atomScale,
  renderOverride,
  onAtomClick,
  onAtomDoubleClick,
  atomKeyPrefix = 'hyper-stick-atom',
}: {
  atoms: Atom[]
  bonds: Bond[]
  atomScale: number
  renderOverride?: LayerRenderOverride
  onAtomClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  onAtomDoubleClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  atomKeyPrefix?: string
}) {
  const presentation = useMemo(
    () => resolveHyperStickPresentation(atomScale, renderOverride),
    [atomScale, renderOverride],
  )
  const bondedAtomIds = useMemo(
    () => hyperStickBondedAtomIds(atoms, bonds),
    [atoms, bonds],
  )

  return <>
    <HyperStickBonds
      atoms={atoms}
      bonds={bonds}
      atomScale={atomScale}
      renderOverride={renderOverride}
    />
    {atoms.map((atom) => (
      <AtomMesh
        key={`${atomKeyPrefix}-${atom.id}`}
        atom={atom}
        viewMode={bondedAtomIds.has(atom.id) ? 'hyper-stick' : 'ball-stick'}
        // Exact radii are already world-space values; ordinary HyperStick
        // passes still fall through to their resolved presentation scale.
        scale={resolveHyperStickAtomMeshScale(presentation, renderOverride)}
        renderOverride={renderOverride}
        onAtomClick={onAtomClick}
        onAtomDoubleClick={onAtomDoubleClick}
      />
    ))}
  </>
}

export function HyperStickBonds({ atoms, bonds, atomScale, renderOverride }: {
  atoms: Atom[]
  bonds: Bond[]
  atomScale: number
  renderOverride?: LayerRenderOverride
}) {
  const invalidate = useThree((state) => state.invalidate)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const translationPreview = useCrystalStore((state) => state.translationPreview)
  const rotationPreview = useCrystalStore((state) => state.rotationPreview)
  const selectionTransformOrigin = useCrystalStore((state) => state.selectionTransformOrigin)
  const lightAmbient = useCrystalStore((state) => state.lightAmbient)
  const lightKey = useCrystalStore((state) => state.lightKey)
  const lightFill = useCrystalStore((state) => state.lightFill)
  const lightAzimuth = useCrystalStore((state) => state.lightAzimuth)
  const lightElevation = useCrystalStore((state) => state.lightElevation)
  const headlight = useCrystalStore((state) => state.lightFollowsCamera)
  const ambientIntensity = useCrystalStore((state) => state.ambientIntensity)
  const diffuseIntensity = useCrystalStore((state) => state.diffuseIntensity)
  const specularIntensity = useCrystalStore((state) => state.specularIntensity)
  const atomShininess = useCrystalStore((state) => state.atomShininess)
  const rimIntensity = useCrystalStore((state) => state.rimIntensity)
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const bondBicolor = useCrystalStore((state) => state.bondBicolor)
  const bondColor = useCrystalStore((state) => state.bondColor)
  const renderStyle = useCrystalStore((state) => state.renderStyle)
  const latticeVectors = useCrystalStore((state) => state.latticeVectors)
  const presentation = useMemo(
    () => resolveHyperStickPresentation(atomScale, renderOverride),
    [atomScale, renderOverride],
  )
  const lightDir = useMemo<[number, number, number]>(
    () => lightDirectionFromAngles(lightAzimuth, lightElevation, 1),
    [lightAzimuth, lightElevation],
  )
  const lighting = useMemo(() => ({
    ambient: renderOverride?.ambient ?? lightAmbient ?? ambientIntensity,
    key: renderOverride?.diffuse ?? lightKey ?? diffuseIntensity,
    fill: lightFill ?? 0,
  }), [ambientIntensity, diffuseIntensity, lightAmbient, lightKey, lightFill, renderOverride?.ambient, renderOverride?.diffuse])
  const shadingMode = resolveHyperStickShadingMode(renderStyle, renderOverride)

  const atomMap = useMemo(() => {
    const m = new Map<string, Atom>()
    for (const atom of atoms) m.set(atom.id, atom)
    return m
  }, [atoms])
  const unwrapMap = useDisplayPositions(atoms, bonds)
  const displayImages = useDisplayImages(atoms)
  const previewPositionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    for (const atom of atoms) {
      if (!atom.cartesian) continue
      map.set(
        atom.id,
        applySelectionTransformPreviewToPosition(
          atom.cartesian,
          selectedAtomIds.has(atom.id),
          selectionTransformOrigin,
          translationPreview,
          rotationPreview,
          unwrapMap?.get(atom.id) ?? null,
        ),
      )
    }
    return map
  }, [atoms, unwrapMap, selectedAtomIds, selectionTransformOrigin, translationPreview, rotationPreview])

  const segments = useMemo(
    () => buildBondSegments({
      bonds,
      positionOf: (id) => previewPositionMap.get(id),
      lattice: displayImages.displayBox ?? latticeVectors,
      instances: displayImages.offsets,
    }),
    [bonds, previewPositionMap, displayImages.displayBox, latticeVectors, displayImages.offsets],
  )

  const frames = useMemo(
    () => buildInstanceFrames(
      segments,
      atomMap,
      presentation.atomScale,
      elementOverrides,
      renderOverride?.colorByAtomId,
      presentation.stickScale,
      renderOverride?.atomRadiusByAtomId,
      presentation.bondRadius,
    ),
    [segments, atomMap, presentation.atomScale, presentation.bondRadius, presentation.stickScale, elementOverrides, renderOverride?.atomRadiusByAtomId, renderOverride?.colorByAtomId],
  )

  const meshRef = useRef<THREE.InstancedMesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uLight: { value: new THREE.Vector3() },
      uHeadlight: { value: 0 },
      uAmbient: { value: 0 },
      uKey: { value: 0 },
      uFill: { value: 0 },
      uShrink: { value: 0.45 },
      uBondColor: { value: new THREE.Color() },
      uBondBicolor: { value: 1 },
      uSpecular: { value: 0.6 },
      uShininess: { value: 280 },
      uRim: { value: 0 },
      uOpacity: { value: 1 },
      uMode: { value: SHADING_MODE_MAP.vesta },
    }),
    [],
  )

  // Push per-instance buffers + transforms whenever the bond topology changes.
  // Instance count is keyed off the `<instancedMesh args=…>` so R3F recreates
  // the underlying THREE.InstancedMesh when the count changes — we just need
  // to repopulate matrices and attributes.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const count = frames.length
    mesh.count = count
    if (count === 0) {
      mesh.instanceMatrix.needsUpdate = true
      invalidate()
      return
    }

    const aP1 = new Float32Array(count * 3)
    const aP2 = new Float32Array(count * 3)
    const aC1 = new Float32Array(count * 3)
    const aC2 = new Float32Array(count * 3)
    const aR1 = new Float32Array(count)
    const aR2 = new Float32Array(count)
    const aAtomR1 = new Float32Array(count)
    const aAtomR2 = new Float32Array(count)
    const tmpMat = new THREE.Matrix4()
    const tmpScale = new THREE.Vector3()

    for (let i = 0; i < count; i++) {
      const f = frames[i]
      tmpScale.set(f.scaleX, f.scaleY, f.scaleZ)
      tmpMat.compose(f.midpoint, f.quaternion, tmpScale)
      mesh.setMatrixAt(i, tmpMat)
      const i3 = i * 3
      aP1[i3] = f.p1x; aP1[i3 + 1] = f.p1y; aP1[i3 + 2] = f.p1z
      aP2[i3] = f.p2x; aP2[i3 + 1] = f.p2y; aP2[i3 + 2] = f.p2z
      aC1[i3] = f.c1r; aC1[i3 + 1] = f.c1g; aC1[i3 + 2] = f.c1b
      aC2[i3] = f.c2r; aC2[i3 + 1] = f.c2g; aC2[i3 + 2] = f.c2b
      aR1[i] = f.r1
      aR2[i] = f.r2
      aAtomR1[i] = f.atomR1
      aAtomR2[i] = f.atomR2
    }

    mesh.instanceMatrix.needsUpdate = true
    const geom = mesh.geometry
    geom.setAttribute('aP1', new THREE.InstancedBufferAttribute(aP1, 3))
    geom.setAttribute('aP2', new THREE.InstancedBufferAttribute(aP2, 3))
    geom.setAttribute('aColor1', new THREE.InstancedBufferAttribute(aC1, 3))
    geom.setAttribute('aColor2', new THREE.InstancedBufferAttribute(aC2, 3))
    geom.setAttribute('aR1', new THREE.InstancedBufferAttribute(aR1, 1))
    geom.setAttribute('aR2', new THREE.InstancedBufferAttribute(aR2, 1))
    geom.setAttribute('aAtomR1', new THREE.InstancedBufferAttribute(aAtomR1, 1))
    geom.setAttribute('aAtomR2', new THREE.InstancedBufferAttribute(aAtomR2, 1))
    invalidate()
  }, [frames, invalidate])

  useEffect(() => {
    uniforms.uLight.value.set(lightDir[0], lightDir[1], lightDir[2]).normalize()
    uniforms.uHeadlight.value = headlight ? 1 : 0
    uniforms.uAmbient.value = lighting.ambient
    uniforms.uKey.value = lighting.key
    uniforms.uFill.value = lighting.fill
    uniforms.uShrink.value = presentation.stickScale
    uniforms.uBondColor.value.setStyle(bondColor, THREE.NoColorSpace)
    uniforms.uBondBicolor.value = renderOverride?.colorByAtomId || bondBicolor ? 1 : 0
    uniforms.uSpecular.value = renderOverride?.specularStrength ?? specularIntensity
    uniforms.uShininess.value = (renderOverride?.shininess ?? atomShininess) * 2.8
    uniforms.uRim.value = renderOverride?.fresnel ?? rimIntensity
    uniforms.uOpacity.value = presentation.opacity
    uniforms.uMode.value = shadingMode
    if (materialRef.current) {
      materialRef.current.uniformsNeedUpdate = true
    }
    invalidate()
  }, [atomShininess, bondBicolor, bondColor, headlight, invalidate, lightDir, lighting, presentation.opacity, presentation.stickScale, renderOverride?.colorByAtomId, renderOverride?.fresnel, renderOverride?.shininess, renderOverride?.specularStrength, rimIntensity, shadingMode, specularIntensity, uniforms])

  if (frames.length === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, frames.length]}
      frustumCulled={false}
      raycast={() => {}}
    >
      <boxGeometry args={BOX_GEOMETRY_ARGS} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={HYPER_STICK_FRAGMENT_SHADER}
        transparent={presentation.opacity < 1 || shadingMode === SHADING_MODE_MAP.xray || shadingMode === 10}
        side={THREE.BackSide}
        depthWrite={presentation.opacity >= 1}
      />
    </instancedMesh>
  )
}
