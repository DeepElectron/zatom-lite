'use client'
/* BrillouinZoneOverlay - Renders BZ, k-path and k-points in 3D viewer */
/* Updated: forces cache rebuild */

import { useMemo } from 'react'
import { Html, Line, Cone } from '@react-three/drei'
import * as THREE from 'three'

import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  conventionalToPrimitiveLattice,
  fitBrillouinZoneToCell,
  hexagonalToRhombohedralPrimitive,
} from '../../../lib/crystal/brillouin-zone'
import {
  constructBrillouinZone,
  reciprocalLattice,
} from '../../../lib/brillouin/wigner-seitz'
import { getKPointDisplayLabel, getKPointsForLattice, getKPathForLattice, type KPoint } from '../../../lib/crystal/kpath'
import type { CenteringType } from '../../../lib/crystal/types'

function latticeParamsToVectors(params: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number }) {
  const { a, b, c, alpha, beta, gamma } = params
  const alphaRad = alpha * Math.PI / 180
  const betaRad = beta * Math.PI / 180
  const gammaRad = gamma * Math.PI / 180
  
  const a1: [number, number, number] = [a, 0, 0]
  const a2: [number, number, number] = [b * Math.cos(gammaRad), b * Math.sin(gammaRad), 0]
  
  const cosAlpha = Math.cos(alphaRad)
  const cosBeta = Math.cos(betaRad)
  const cosGamma = Math.cos(gammaRad)
  const sinGamma = Math.sin(gammaRad)
  
  const cx = c * cosBeta
  const cy = c * (cosAlpha - cosBeta * cosGamma) / sinGamma
  const cz = Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy))
  const a3: [number, number, number] = [cx, cy, cz]
  
  return { a: a1, b: a2, c: a3 }
}

export function BrillouinZoneOverlay() {
  const latticeParams = useCrystalStore((s) => s.latticeParams)
  const showBZOverlay = useCrystalStore((s) => s.showBZOverlay)
  const bzShowZone = useCrystalStore((s) => s.bzShowZone)
  const bzShowKPath = useCrystalStore((s) => s.bzShowKPath)
  const bzShowKPoints = useCrystalStore((s) => s.bzShowKPoints)
  const bzShowReciprocal = useCrystalStore((s) => s.bzShowReciprocal)
  const bzOpacity = useCrystalStore((s) => s.bzOpacity)
  const focusedKPoint = useCrystalStore((s) => s.focusedKPoint)
  const setFocusedKPoint = useCrystalStore((s) => s.setFocusedKPoint)
  const setCameraTarget = useCrystalStore((s) => s.setCameraTarget)
  const setIsAnimatingCamera = useCrystalStore((s) => s.setIsAnimatingCamera)
  
  const latticeVectors = useMemo(() => {
    if (!latticeParams || latticeParams.a <= 0) return null
    return latticeParamsToVectors(latticeParams)
  }, [latticeParams])
  
  const latticeA = latticeParams?.a ?? 0
  const latticeC = latticeParams?.c ?? 0
  const centeringType = latticeParams?.centeringType as CenteringType | undefined
  const spaceGroupNumber = latticeParams?.spaceGroupNumber
  
  const bzData = useMemo(() => {
    if (!latticeVectors || latticeA <= 0) return null
    try {
      const a1 = latticeVectors.a
      const a2 = latticeVectors.b
      const a3 = latticeVectors.c
      
      // For R-centered lattices in hexagonal setting, use primitive rhombohedral cell
      // This ensures BZ, k-points, and visualization are all in the same coordinate system
      let effectiveA1 = a1
      let effectiveA2 = a2
      let effectiveA3 = a3
      let primitiveLatticeVectors = latticeVectors
      
      if (centeringType === 'R') {
        const rhomPrim = hexagonalToRhombohedralPrimitive(latticeA, latticeC)
        effectiveA1 = rhomPrim.latticeVectors[0]
        effectiveA2 = rhomPrim.latticeVectors[1]
        effectiveA3 = rhomPrim.latticeVectors[2]
        primitiveLatticeVectors = {
          a: effectiveA1,
          b: effectiveA2,
          c: effectiveA3
        }
      } else {
        const primitive = conventionalToPrimitiveLattice(
          a1,
          a2,
          a3,
          centeringType,
        )
        effectiveA1 = primitive[0]
        effectiveA2 = primitive[1]
        effectiveA3 = primitive[2]
        primitiveLatticeVectors = {
          a: effectiveA1,
          b: effectiveA2,
          c: effectiveA3,
        }
      }
      
      // Calculate reciprocal lattice (primitive rhombohedral for R-centered)
      const reciprocal = reciprocalLattice(effectiveA1, effectiveA2, effectiveA3)
      const recip = {
        b1: [...reciprocal[0]] as [number, number, number],
        b2: [...reciprocal[1]] as [number, number, number],
        b3: [...reciprocal[2]] as [number, number, number],
      }
      
      // Construct Brillouin zone in the appropriate reciprocal space
      const constructed = constructBrillouinZone(recip.b1, recip.b2, recip.b3)
      const bz = {
        ...constructed,
        vertices: constructed.vertices.map((vertex) => [...vertex] as [number, number, number]),
      }
      
      // Get k-points and k-path using HPKOT algorithm
      // For R-centered, uses primitive rhombohedral reciprocal basis
      const kpoints = getKPointsForLattice(a1, a2, a3, recip.b1, recip.b2, recip.b3, centeringType, spaceGroupNumber)
      const kpath = getKPathForLattice(a1, a2, a3, recip.b1, recip.b2, recip.b3, centeringType, spaceGroupNumber)
      
      return { recip, bz, kpoints, kpath, centeringType, primitiveLatticeVectors }
    } catch (e) {
      console.error('BZ calculation error:', e)
      return null
    }
  }, [latticeVectors, latticeA, latticeC, centeringType, spaceGroupNumber])
  
  const displayTransform = useMemo(() => {
    if (!bzData?.bz?.vertices || !bzData.primitiveLatticeVectors) return null
    const { a, b, c } = bzData.primitiveLatticeVectors
    try {
      return fitBrillouinZoneToCell(bzData.bz.vertices, a, b, c)
    } catch {
      return null
    }
  }, [bzData])

  const kpointReciprocalPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    bzData?.kpoints.forEach((kpoint) => map.set(kpoint.label, kpoint.cartesian))
    return map
  }, [bzData])

  const kpointDisplayPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    if (!displayTransform) return map
    for (const [label, position] of kpointReciprocalPositions) {
      map.set(label, [
        displayTransform.origin[0] + position[0] * displayTransform.scale,
        displayTransform.origin[1] + position[1] * displayTransform.scale,
        displayTransform.origin[2] + position[2] * displayTransform.scale,
      ])
    }
    return map
  }, [displayTransform, kpointReciprocalPositions])
  
  const kpathSegments = useMemo(() => {
    if (!bzData?.kpath || kpointReciprocalPositions.size === 0) return []
    const segments: Array<{ points: [[number, number, number], [number, number, number]]; color: string }> = []
    const colors = ['#FF453A', '#FF9500', '#30D158', '#0A84FF', '#BF5AF2', '#FF375F']
    // segments is [string, string][] - array of [startLabel, endLabel] tuples
    bzData.kpath.segments.forEach((seg, idx) => {
      const startLabel = seg[0]
      const endLabel = seg[1]
      const start = kpointReciprocalPositions.get(startLabel)
      const end = kpointReciprocalPositions.get(endLabel)
      if (start && end) {
        segments.push({ points: [start, end], color: colors[idx % colors.length] })
      }
    })
    return segments
  }, [bzData, kpointReciprocalPositions])
  
  const handleKPointClick = (kpoint: KPoint, isDoubleClick: boolean) => {
    if (isDoubleClick || focusedKPoint === kpoint.label) {
      setFocusedKPoint(null)
    } else {
      setFocusedKPoint(kpoint.label)
      const pos = kpointDisplayPositions.get(kpoint.label)
      if (pos) {
        setCameraTarget({ position: [pos[0] + 8, pos[1] + 5, pos[2] + 8], lookAt: pos })
        setIsAnimatingCamera(true)
      }
    }
  }
  
  const bzEdges = useMemo(() => {
    if (!bzData?.bz?.edges || bzData.bz.vertices.length === 0) return []
    return bzData.bz.edges
      .filter(([i, j]) => i < bzData.bz.vertices.length && j < bzData.bz.vertices.length)
      .map(([i, j]) => [bzData.bz.vertices[i], bzData.bz.vertices[j]] as [[number, number, number], [number, number, number]])
  }, [bzData])

  const reciprocalDisplayVectors = useMemo(() => {
    const reciprocal = bzData?.recip
    if (!reciprocal || !displayTransform) return []
    const origin: [number, number, number] = [0, 0, 0]
    return [
      { label: 'b₁', color: '#FF453A', vector: reciprocal.b1 },
      { label: 'b₂', color: '#30D158', vector: reciprocal.b2 },
      { label: 'b₃', color: '#0A84FF', vector: reciprocal.b3 },
    ].map(({ label, color, vector }) => {
      const end: [number, number, number] = [
        vector[0] * 0.42,
        vector[1] * 0.42,
        vector[2] * 0.42,
      ]
      const direction = new THREE.Vector3(end[0] - origin[0], end[1] - origin[1], end[2] - origin[2])
      const length = direction.length()
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      )
      return {
        label,
        color,
        origin,
        end,
        rotation: new THREE.Euler().setFromQuaternion(quaternion),
        headLength: Math.max(displayTransform.reciprocalRadius * 0.04, length * 0.1),
      }
    })
  }, [bzData, displayTransform])
  
  // Build BZ faces for rendering (as triangles)
  const bzFacesGeometry = useMemo(() => {
    if (!bzData?.bz?.faces || bzData.bz.vertices.length === 0) return null
    
    const positions: number[] = []
    
    bzData.bz.faces.forEach(faceIndices => {
      if (faceIndices.length < 3) return
      // Validate all indices
      if (faceIndices.some(i => i >= bzData.bz.vertices.length)) return
      
      // Triangulate the face (fan triangulation from first vertex)
      const v0 = bzData.bz.vertices[faceIndices[0]]
      for (let i = 1; i < faceIndices.length - 1; i++) {
        const v1 = bzData.bz.vertices[faceIndices[i]]
        const v2 = bzData.bz.vertices[faceIndices[i + 1]]
        positions.push(v0[0], v0[1], v0[2])
        positions.push(v1[0], v1[1], v1[2])
        positions.push(v2[0], v2[1], v2[2])
      }
    })
    
    if (positions.length === 0) return null
    
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    return geometry
  }, [bzData])
  
  if (!showBZOverlay || !bzData || !displayTransform) return null
  const { bz, kpoints } = bzData
  if (!bz || !kpoints || kpoints.length === 0) return null
  const markerRadius = displayTransform.reciprocalRadius * 0.032
  const arrowLength = displayTransform.reciprocalRadius * 0.075
  
  // Helper to validate a point is [number, number, number]
  const isValidPoint = (p: unknown): p is [number, number, number] => {
    return Array.isArray(p) && p.length === 3 && p.every(v => typeof v === 'number' && isFinite(v))
  }
  
  // Filter valid k-path segments
  const validKPathSegments = kpathSegments.filter(seg => 
    seg && Array.isArray(seg.points) && seg.points.length === 2 && 
    isValidPoint(seg.points[0]) && isValidPoint(seg.points[1])
  )
  
  return (
    <group position={displayTransform.origin} scale={displayTransform.scale}>
      {/* BZ Zone polyhedron - edges and semi-transparent faces */}
      {bzShowZone && bzEdges.length > 0 && (
        <>
          {/* BZ Edges */}
          {bzEdges.map((edge, i) => (
            <Line
              key={`bz-edge-${i}`}
              points={edge}
              color="#0EA5E9"
              lineWidth={1.5}
              opacity={0.8}
              transparent
            />
          ))}
          {/* BZ Faces */}
          {bzFacesGeometry && (
            <mesh geometry={bzFacesGeometry}>
              <meshBasicMaterial
                color="#0EA5E9"
                transparent
                opacity={bzOpacity}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          )}
        </>
      )}

      {bzShowReciprocal && reciprocalDisplayVectors.map((vector) => (
        <group key={vector.label}>
          <Line points={[vector.origin, vector.end]} color={vector.color} lineWidth={2} />
          <group position={vector.end} rotation={[vector.rotation.x, vector.rotation.y, vector.rotation.z]}>
              <Cone args={[vector.headLength * 0.3, vector.headLength, 8]}>
              <meshBasicMaterial color={vector.color} />
            </Cone>
          </group>
          <Html position={vector.end} center style={{ pointerEvents: 'none' }}>
            <div
              style={{
                padding: '1px 4px',
                borderRadius: 5,
                border: '1px solid var(--panel-border)',
                background: 'var(--panel-elevated)',
                color: vector.color,
                fontSize: 11,
                fontWeight: 650,
                lineHeight: '16px',
                whiteSpace: 'nowrap',
              }}
            >
              {vector.label}
            </div>
          </Html>
        </group>
      ))}
      
      {/* K-path dashed lines with direction arrows */}
      {bzShowKPath && validKPathSegments.map((seg, i) => {
        const [start, end] = seg.points
        const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
        const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2])
        if (len < 0.01) return null
        
        // Normalized direction
        const normDir = [dir[0] / len, dir[1] / len, dir[2] / len]
        
        // Position arrow at 80% along the line (closer to end)
        const arrowPos: [number, number, number] = [
          start[0] + dir[0] * 0.8,
          start[1] + dir[1] * 0.8,
          start[2] + dir[2] * 0.8
        ]
        
        // Calculate rotation to point arrow in direction of travel
        const up = new THREE.Vector3(0, 1, 0)
        const dirVec = new THREE.Vector3(normDir[0], normDir[1], normDir[2])
        const quaternion = new THREE.Quaternion()
        quaternion.setFromUnitVectors(up, dirVec)
        const euler = new THREE.Euler().setFromQuaternion(quaternion)
        
        return (
          <group key={`path-${i}`}>
            {/* Dashed line segment */}
            <Line 
              points={seg.points} 
              color={seg.color} 
              lineWidth={2} 
              dashed 
              dashSize={displayTransform.reciprocalRadius * 0.045}
              gapSize={displayTransform.reciprocalRadius * 0.025}
            />
            {/* Static direction arrow pointing from start to end */}
            <group position={arrowPos} rotation={[euler.x, euler.y, euler.z]}>
              <Cone args={[arrowLength * 0.38, arrowLength, 6]}>
                <meshBasicMaterial color={seg.color} />
              </Cone>
            </group>
          </group>
        )
      })}
      
      {/* K-point spheres with labels */}
      {bzShowKPoints && kpoints.map((kp, i) => {
        const reciprocalPos = kpointReciprocalPositions.get(kp.label)
        if (!reciprocalPos) return null
        const isFocused = focusedKPoint === kp.label
        return (
          <group key={`kp-${i}`} position={reciprocalPos}>
            <mesh onClick={(e) => { e.stopPropagation(); handleKPointClick(kp, false) }} onDoubleClick={(e) => { e.stopPropagation(); handleKPointClick(kp, true) }}>
              <sphereGeometry args={[isFocused ? markerRadius * 1.35 : markerRadius, 16, 16]} />
              <meshBasicMaterial color={isFocused ? '#FF9500' : '#0A84FF'} />
            </mesh>
            {isFocused && (
              <mesh>
                <sphereGeometry args={[markerRadius * 2, 16, 16]} />
                <meshBasicMaterial color="#FF9500" transparent opacity={0.3} />
              </mesh>
            )}
            <Html center style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 6,
                  border: `1px solid ${isFocused ? 'rgba(255,149,0,0.52)' : 'var(--panel-border)'}`,
                  background: isFocused ? '#FF9500' : 'var(--panel-elevated)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
                  color: isFocused ? '#1C1200' : 'var(--panel-text)',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: '18px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {getKPointDisplayLabel(kp.label)}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
