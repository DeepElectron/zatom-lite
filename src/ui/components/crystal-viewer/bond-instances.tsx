'use client'

/**
 * InstancedBonds - High-performance bond rendering using THREE.InstancedMesh
 * Batches all bonds into single draw calls for better GPU performance
 * Uses bond.atom1Id and bond.atom2Id properties (not atomIds array)
 */

import { useRef, useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atom, Bond, ViewMode } from '../../../lib/crystal/types'
import { applyRadiusVariance } from '../../../lib/crystal/elements'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import {
  calculateBondEndpointInset,
  outlinedBondRadius,
} from '../../../lib/render/bond-contact'
import { buildBondSegments } from '../../../lib/crystal/display-periodic-images'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { useDisplayPositions } from './use-display-positions'
import { useDisplayImages } from './use-display-image-offsets'
import { StylizedMaterial } from './stylized-material'
import type { LayerRenderOverride } from './layer-render-override'

interface InstancedBondsProps {
  bonds: Bond[]
  atoms: Atom[]
  viewMode: ViewMode
  scale: number
  radialSegments?: number
  renderOverride?: LayerRenderOverride
}

export function InstancedBonds({ bonds, atoms, viewMode, scale, radialSegments = 6, renderOverride }: InstancedBondsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const outlineRef = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const elementOverrides = useCrystalStore(s => s.elementOverrides)
  const bondBicolor = useCrystalStore(s => s.bondBicolor)
  const bondColor = useCrystalStore(s => s.bondColor)
  const outline = useCrystalStore(s => s.outline)
  const outlineWidth = useCrystalStore(s => s.outlineWidth)
  const outlineColor = useCrystalStore(s => s.outlineColor)
  const sourceBondRadius = useCrystalStore(s => s.bondRadius)
  const latticeVectors = useCrystalStore(s => s.latticeVectors)

  const atomScale = useCrystalStore(s => s.atomScale)
  const elementRadiusVariance = useCrystalStore(s => s.elementRadiusVariance)

  // Create atom lookup map
  const atomMap = useMemo(() => {
    const map = new Map<string, Atom>()
    for (const atom of atoms) {
      map.set(atom.id, atom)
    }
    return map
  }, [atoms])

  const unwrapMap = useDisplayPositions(atoms, bonds)

  const { offsets: imageOffsets, displayBox } = useDisplayImages(atoms)
  const segments = useMemo(
    () => buildBondSegments({
      bonds,
      positionOf: (id) => unwrapMap?.get(id) ?? atomMap.get(id)?.cartesian,
      lattice: displayBox ?? latticeVectors,
      instances: imageOffsets,
    }),
    [bonds, unwrapMap, atomMap, displayBox, latticeVectors, imageOffsets],
  )

  // Calculate cylinder radius
  const cylinderRadius = useMemo(() => {
    if (renderOverride?.bondRadius !== undefined) return Math.max(0.001, renderOverride.bondRadius)
    switch (viewMode) {
      case 'stick': return sourceBondRadius
      case 'space-fill': return 0.08 * scale
      case 'wireframe': return 0.02 * scale
      default: return 0.08 * scale
    }
  }, [renderOverride?.bondRadius, sourceBondRadius, viewMode, scale])
  
  const atomRadius = (atom: Atom): number => {
    const exactRadius = renderOverride?.atomRadiusByAtomId?.get(atom.id)
    if (exactRadius !== undefined) return Math.max(0.001, exactRadius)
    const elementRadius = applyRadiusVariance(elementOverrides[atom.element]?.radius ?? getDefaultCrystalElementVisual(atom.element).radius, elementRadiusVariance)
    const base = elementRadius * 0.5
    if (viewMode === 'space-fill') return base * 2.5 * atomScale
    if (viewMode === 'wireframe') return base * 0.3 * atomScale
    if (viewMode === 'stick') return sourceBondRadius
    if (viewMode === 'hyper-stick') return 0.08 * scale
    return base * (renderOverride?.atomScale ?? atomScale)
  }

  // Process bonds - use atom1Id and atom2Id (NOT atomIds array)
  const validBonds = useMemo(() => {
    const result: Array<{
      midpoint: THREE.Vector3
      direction: THREE.Vector3
      length: number
      color: string
    }> = []

    for (const segment of segments) {
      const bond = segment.bond
      const a1 = atomMap.get(bond.atom1Id)
      const a2 = atomMap.get(bond.atom2Id)
      if (!a1 || !a2) continue

      const c1 = segment.p1
      const c2 = segment.p2
      const p1 = new THREE.Vector3(c1[0], c1[1], c1[2])
      const p2 = new THREE.Vector3(c2[0], c2[1], c2[2])
      const dir = new THREE.Vector3().subVectors(p2, p1)
      const fullLen = dir.length()

      const r1 = atomRadius(a1)
      const r2 = atomRadius(a2)
      const inset1 = calculateBondEndpointInset({
        atomRadius: r1,
        bondRadius: cylinderRadius,
        outline,
        outlineWidth,
      })
      const inset2 = calculateBondEndpointInset({
        atomRadius: r2,
        bondRadius: cylinderRadius,
        outline,
        outlineWidth,
      })
      const clip = inset1 + inset2 < fullLen * 0.95
      const t1 = clip ? inset1 / fullLen : 0
      const t2 = clip ? 1 - inset2 / fullLen : 1
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t
      const start = new THREE.Vector3(
        lerp(p1.x, p2.x, t1),
        lerp(p1.y, p2.y, t1),
        lerp(p1.z, p2.z, t1),
      )
      const end = new THREE.Vector3(
        lerp(p1.x, p2.x, t2),
        lerp(p1.y, p2.y, t2),
        lerp(p1.z, p2.z, t2),
      )
      const len = fullLen * (t2 - t1)
      const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      const firstMidpoint = new THREE.Vector3().addVectors(start, midpoint).multiplyScalar(0.5)
      const secondMidpoint = new THREE.Vector3().addVectors(midpoint, end).multiplyScalar(0.5)
      const firstColor = renderOverride?.colorByAtomId?.get(a1.id) ?? (bondBicolor
        ? elementOverrides[a1.element]?.color ?? getDefaultCrystalElementVisual(a1.element).color
        : bondColor
      )
      const secondColor = renderOverride?.colorByAtomId?.get(a2.id) ?? (bondBicolor
        ? elementOverrides[a2.element]?.color ?? getDefaultCrystalElementVisual(a2.element).color
        : bondColor
      )

      result.push({ midpoint: firstMidpoint, direction: dir, length: len / 2, color: firstColor })
      result.push({ midpoint: secondMidpoint, direction: dir, length: len / 2, color: secondColor })
    }

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, atomMap, viewMode, atomScale, elementRadiusVariance, elementOverrides, bondBicolor, bondColor, cylinderRadius, outline, outlineWidth, renderOverride?.atomScale, renderOverride?.atomRadiusByAtomId, renderOverride?.colorByAtomId, sourceBondRadius])

  // Allocate colors before the first render. THREE chooses its instancing-color
  // shader variant from whether instanceColor exists while compiling; creating
  // the attribute later through setColorAt can leave a white shader cached on a
  // demand-driven canvas.
  const instanceColors = useMemo(() => {
    const values = new Float32Array(validBonds.length * 3)
    const color = new THREE.Color()
    for (let i = 0; i < validBonds.length; i++) {
      color.setStyle(validBonds[i].color, THREE.NoColorSpace)
      color.toArray(values, i * 3)
    }
    return new THREE.InstancedBufferAttribute(values, 3)
  }, [validBonds])

  const wireGeometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const color = new THREE.Color()
    const wireSegments = viewMode === 'wireframe' ? segments : []
    for (const segment of wireSegments) {
      const atom1 = atomMap.get(segment.bond.atom1Id)
      const atom2 = atomMap.get(segment.bond.atom2Id)
      if (!atom1 || !atom2) continue

      const cartesian1 = segment.p1
      const cartesian2 = segment.p2
      const midpoint = [
        (cartesian1[0] + cartesian2[0]) / 2,
        (cartesian1[1] + cartesian2[1]) / 2,
        (cartesian1[2] + cartesian2[2]) / 2,
      ] as const
      const color1 = renderOverride?.colorByAtomId?.get(atom1.id) ?? (bondBicolor
        ? elementOverrides[atom1.element]?.color ?? getDefaultCrystalElementVisual(atom1.element).color
        : bondColor
      )
      const color2 = renderOverride?.colorByAtomId?.get(atom2.id) ?? (bondBicolor
        ? elementOverrides[atom2.element]?.color ?? getDefaultCrystalElementVisual(atom2.element).color
        : bondColor
      )

      positions.push(
        ...cartesian1,
        ...midpoint,
        ...midpoint,
        ...cartesian2,
      )
      color.set(color1)
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
      color.set(color2)
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geometry
  }, [atomMap, bondBicolor, bondColor, segments, elementOverrides, renderOverride?.colorByAtomId, viewMode])

  useEffect(() => () => wireGeometry.dispose(), [wireGeometry])
  
  // Update transforms
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || validBonds.length === 0) return
    const outlineMesh = outlineRef.current
    
    const mat = new THREE.Matrix4()
    const rot = new THREE.Matrix4()
    const scl = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    
    for (let i = 0; i < validBonds.length; i++) {
      const { midpoint, direction, length } = validBonds[i]
      
      const normDir = direction.clone().normalize()
      quat.setFromUnitVectors(up, normDir)
      
      rot.makeRotationFromQuaternion(quat)
      scl.makeScale(1, length, 1)
      mat.multiplyMatrices(rot, scl)
      mat.setPosition(midpoint)
      
      mesh.setMatrixAt(i, mat)
      outlineMesh?.setMatrixAt(i, mat)
    }
    
    mesh.instanceMatrix.needsUpdate = true
    if (outlineMesh) outlineMesh.instanceMatrix.needsUpdate = true
    invalidate()
  }, [invalidate, outline, validBonds])
  
  if (validBonds.length === 0) return null
  if (viewMode === 'wireframe') {
    return (
      <lineSegments geometry={wireGeometry}>
        <lineBasicMaterial vertexColors transparent={(renderOverride?.opacity ?? 1) < 1} opacity={renderOverride?.opacity ?? 1} depthWrite={(renderOverride?.opacity ?? 1) >= 1} />
      </lineSegments>
    )
  }
  
  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, validBonds.length]}
        instanceColor={instanceColors}
        frustumCulled={false}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[cylinderRadius, cylinderRadius, 1, radialSegments, 1, false]} />
        <StylizedMaterial
          color="#ffffff"
          instanceColors
          opacity={renderOverride?.opacity ?? 1}
          transparent={(renderOverride?.opacity ?? 1) < 1}
          depthWrite={(renderOverride?.opacity ?? 1) >= 1}
          mode={renderOverride?.mode}
          ambient={renderOverride?.ambient}
          diffuse={renderOverride?.diffuse}
          specularStrength={renderOverride?.specularStrength}
          shininess={renderOverride?.shininess}
          fresnel={renderOverride?.fresnel}
        />
      </instancedMesh>
      {outline && (
        <instancedMesh
          ref={outlineRef}
          args={[undefined, undefined, validBonds.length]}
          frustumCulled={false}
          raycast={() => {}}
          renderOrder={4}
        >
          <cylinderGeometry
            args={[
              outlinedBondRadius(cylinderRadius, outlineWidth),
              outlinedBondRadius(cylinderRadius, outlineWidth),
              1,
              radialSegments,
              1,
              true,
            ]}
          />
          <meshBasicMaterial color={outlineColor} side={THREE.BackSide} transparent={(renderOverride?.opacity ?? 1) < 1} opacity={renderOverride?.opacity ?? 1} depthWrite={(renderOverride?.opacity ?? 1) >= 1} />
        </instancedMesh>
      )}
    </>
  )
}
