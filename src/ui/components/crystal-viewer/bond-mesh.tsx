'use client'

/**
 * Per-bond renderer using shared unit cylinders and rounded caps. Periodic bond
 * segments are emitted only where both endpoint atom images are actually visible.
 */
import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Bond, Atom, ViewMode } from '../../../lib/crystal/types'
import { applyRadiusVariance } from '../../../lib/crystal/elements'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import {
  calculateBondEndpointInset,
  outlinedBondRadius,
} from '../../../lib/render/bond-contact'
import { calculateDistance, calculateMidpoint, calculateBondDirection } from '../../../lib/crystal/bonds'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { useDisplayPositions } from './use-display-positions'
import { useDisplayImages } from './use-display-image-offsets'
import { buildBondSegments } from '../../../lib/crystal/display-periodic-images'
import { StylizedMaterial } from './stylized-material'
import type { LayerRenderOverride } from './layer-render-override'

interface BondMeshProps {
  bond: Bond
  atoms: Atom[]
  viewMode: ViewMode
  scale: number
  atomMap?: ReadonlyMap<string, Atom>
  radialSegments?: number
  dashedSegmentCount?: number
  renderOverride?: LayerRenderOverride
}

// Closed unit cylinders are cached by radial detail and scaled per bond.
const unitCylinderCache = new Map<number, THREE.CylinderGeometry>()

function getUnitCylinder(radialSegments: number): THREE.CylinderGeometry {
  let geo = unitCylinderCache.get(radialSegments)
  if (!geo) {
    geo = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, false)
    unitCylinderCache.set(radialSegments, geo)
  }
  return geo
}

// A shallow dome rounds the cap without turning the bond into a capsule.
const CAP_BULGE = 0.4

// Unit domes share an equator with the cylinder and scale only with bond radius.
const unitDomeCache = new Map<number, THREE.SphereGeometry>()

function getUnitDome(radialSegments: number): THREE.SphereGeometry {
  let geo = unitDomeCache.get(radialSegments)
  if (!geo) {
    const heightSegments = Math.max(2, Math.round(radialSegments / 3))
    geo = new THREE.SphereGeometry(1, radialSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2)
    unitDomeCache.set(radialSegments, geo)
  }
  return geo
}

function BondSurface({
  color,
  opacity,
  renderOverride,
}: {
  color: string
  opacity: number
  renderOverride?: LayerRenderOverride
}) {
  return <StylizedMaterial
    color={color}
    transparent={opacity < 1}
    opacity={opacity}
    depthWrite={opacity >= 1}
    mode={renderOverride?.mode}
    ambient={renderOverride?.ambient}
    diffuse={renderOverride?.diffuse}
    specularStrength={renderOverride?.specularStrength}
    shininess={renderOverride?.shininess}
    fresnel={renderOverride?.fresnel}
  />
}

function BondCylinder({
  position,
  rotation,
  radius,
  length,
  radialSegments,
  color,
  opacity,
  outline,
  outlineWidth,
  outlineColor,
  renderOverride,
}: {
  position: [number, number, number]
  rotation: [number, number, number]
  radius: number
  length: number
  radialSegments: number
  color: string
  opacity: number
  outline: boolean
  outlineWidth: number
  outlineColor: string
  renderOverride?: LayerRenderOverride
}) {
  const outlineRadius = outlinedBondRadius(radius, outlineWidth)
  const unit = getUnitCylinder(radialSegments)
  const dome = getUnitDome(radialSegments)
  const halfLength = length / 2
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow={opacity >= 1} receiveShadow geometry={unit} scale={[radius, length, radius]}>
        <BondSurface color={color} opacity={opacity} renderOverride={renderOverride} />
      </mesh>
      <mesh
        castShadow={opacity >= 1}
        receiveShadow
        geometry={dome}
        position={[0, halfLength, 0]}
        scale={[radius, radius * CAP_BULGE, radius]}
      >
        <BondSurface color={color} opacity={opacity} renderOverride={renderOverride} />
      </mesh>
      <mesh
        castShadow={opacity >= 1}
        receiveShadow
        geometry={dome}
        position={[0, -halfLength, 0]}
        rotation={[Math.PI, 0, 0]}
        scale={[radius, radius * CAP_BULGE, radius]}
      >
        <BondSurface color={color} opacity={opacity} renderOverride={renderOverride} />
      </mesh>
      {outline && (
        <>
          <mesh
            raycast={() => {}}
            renderOrder={4}
            geometry={unit}
            scale={[outlineRadius, length, outlineRadius]}
          >
            <meshBasicMaterial
              color={outlineColor}
              side={THREE.BackSide}
              transparent={opacity < 1}
              opacity={opacity}
              depthWrite={opacity >= 1}
            />
          </mesh>
          <mesh
            raycast={() => {}}
            renderOrder={4}
            geometry={dome}
            position={[0, halfLength, 0]}
            scale={[outlineRadius, outlineRadius * CAP_BULGE, outlineRadius]}
          >
            <meshBasicMaterial
              color={outlineColor}
              side={THREE.BackSide}
              transparent={opacity < 1}
              opacity={opacity}
              depthWrite={opacity >= 1}
            />
          </mesh>
          <mesh
            raycast={() => {}}
            renderOrder={4}
            geometry={dome}
            position={[0, -halfLength, 0]}
            rotation={[Math.PI, 0, 0]}
            scale={[outlineRadius, outlineRadius * CAP_BULGE, outlineRadius]}
          >
            <meshBasicMaterial
              color={outlineColor}
              side={THREE.BackSide}
              transparent={opacity < 1}
              opacity={opacity}
              depthWrite={opacity >= 1}
            />
          </mesh>
        </>
      )}
    </group>
  )
}

function BondSegmentMesh({ bond, atoms, viewMode, scale, atomMap, radialSegments = 12, dashedSegmentCount = 5, renderOverride, p1, p2 }: BondMeshProps & {
  p1: readonly number[]
  p2: readonly number[]
}) {
  const atom1 = useMemo(() => atomMap?.get(bond.atom1Id) ?? atoms.find(a => a.id === bond.atom1Id), [atomMap, atoms, bond.atom1Id])
  const atom2 = useMemo(() => atomMap?.get(bond.atom2Id) ?? atoms.find(a => a.id === bond.atom2Id), [atomMap, atoms, bond.atom2Id])

  const atomScale = useCrystalStore(s => s.atomScale)
  const elementRadiusVariance = useCrystalStore(s => s.elementRadiusVariance)
  const sourceBondRadius = useCrystalStore(s => s.bondRadius)

  const selectMode = useCrystalStore(s => s.selectMode)
  const toolMode = useCrystalStore(s => s.toolMode)
  const isSelected = useCrystalStore(s => s.selectedBondIds.has(bond.id))
  const isHovered = useCrystalStore(s => s.hoveredBondId === bond.id)
  const selectBond = useCrystalStore(s => s.selectBond)
  const setHoveredBond = useCrystalStore(s => s.setHoveredBond)
  const deleteBond = useCrystalStore(s => s.deleteBond)
  const hasFocusedAtoms = useCrystalStore(s => s.focusedAtomIds.size > 0)
  const isBondFocused = useCrystalStore(s =>
    Boolean(atom1 && atom2 && (s.focusedAtomIds.has(atom1.id) || s.focusedAtomIds.has(atom2.id))))
  const focusFadesBonds = useCrystalStore(s => s.focusFadesBonds)
  const focusedAtomOpacity = useCrystalStore(s => s.focusedAtomOpacity)
  const elementOverrides = useCrystalStore(s => s.elementOverrides)
  const bondBicolor = useCrystalStore(s => s.bondBicolor)
  const bondColor = useCrystalStore(s => s.bondColor)
  const outline = useCrystalStore(s => s.outline)
  const outlineWidth = useCrystalStore(s => s.outlineWidth)
  const outlineColor = useCrystalStore(s => s.outlineColor)
  
  // Bond can be selected in bond mode, deleted in delete mode
  const canSelectBond = selectMode === 'bond'
  const canDeleteBond = toolMode === 'delete'
  
  // Check if this bond should be faded (when focusFadesBonds is on and atoms are focused)
  const isFaded = !renderOverride?.suppressGlobalFocusFade
    && focusFadesBonds
    && hasFocusedAtoms
    && !isBondFocused

  const bondGeometry = useMemo(() => {
    if (!atom1?.cartesian || !atom2?.cartesian) return null

    const pos1: [number, number, number] = [p1[0], p1[1], p1[2]]
    const pos2: [number, number, number] = [p2[0], p2[1], p2[2]]
    const distance = calculateDistance(pos1, pos2)
    const midpoint = calculateMidpoint(pos1, pos2)
    const direction = calculateBondDirection(pos1, pos2)
    
    // Calculate quaternion for rotation
    const up = new THREE.Vector3(0, 1, 0)
    const dir = new THREE.Vector3(...direction)
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(up, dir)
    
    const euler = new THREE.Euler().setFromQuaternion(quaternion)
    
    // Calculate perpendicular vectors for double/triple bond offsets
    // Find a vector perpendicular to the bond direction
    let perpendicular1 = new THREE.Vector3()
    if (Math.abs(dir.x) < 0.9) {
      perpendicular1.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize()
    } else {
      perpendicular1.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    }
    const perpendicular2 = new THREE.Vector3().crossVectors(dir, perpendicular1).normalize()
    
    return {
      distance,
      midpoint,
      rotation: [euler.x, euler.y, euler.z] as [number, number, number],
      quaternion,
      perpendicular1: [perpendicular1.x, perpendicular1.y, perpendicular1.z] as [number, number, number],
      perpendicular2: [perpendicular2.x, perpendicular2.y, perpendicular2.z] as [number, number, number],
      color1: renderOverride?.colorByAtomId?.get(atom1.id) ?? elementOverrides[atom1.element]?.color ?? getDefaultCrystalElementVisual(atom1.element).color,
      color2: renderOverride?.colorByAtomId?.get(atom2.id) ?? elementOverrides[atom2.element]?.color ?? getDefaultCrystalElementVisual(atom2.element).color,
    }
  }, [atom1, atom2, elementOverrides, renderOverride?.colorByAtomId, p1, p2])
  
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    
    // Delete mode - delete this bond
    if (canDeleteBond) {
      deleteBond(bond.id)
      return
    }
    
    if (!canSelectBond) return
    selectBond(bond.id, e.nativeEvent.shiftKey)
  }
  
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!canSelectBond && !canDeleteBond) return
    e.stopPropagation()
    setHoveredBond(bond.id)
    document.body.style.cursor = canDeleteBond ? 'not-allowed' : 'pointer'
  }
  
  const handlePointerOut = () => {
    if (isHovered) {
      setHoveredBond(null)
      document.body.style.cursor = 'auto'
    }
  }
  
  if (!bondGeometry || !atom1?.cartesian || !atom2?.cartesian) return null

  const { distance, rotation, perpendicular1, color1, color2 } = bondGeometry

  const atomRadius = (atom: typeof atom1) => {
    if (!atom) return 0
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
  const r1 = atomRadius(atom1)
  const r2 = atomRadius(atom2)

  // Adjust radius for selection/hover states
  const canonicalRadius = renderOverride?.bondRadius ?? (viewMode === 'stick' ? sourceBondRadius : 0.08 * scale)
  const baseRadius = Math.max(0.001, canonicalRadius) * (isSelected || isHovered ? 1.3 : 1)
  const bondSpacing = 0.15 * scale
  
  // Override colors when selected/hovered/deleting
  const deleteHover = canDeleteBond && isHovered
  const restingColor1 = bondBicolor ? color1 : bondColor
  const restingColor2 = bondBicolor ? color2 : bondColor
  const finalColor1 = deleteHover ? '#FF453A' : isSelected ? '#FF9500' : isHovered ? '#0A84FF' : restingColor1
  const finalColor2 = deleteHover ? '#FF453A' : isSelected ? '#FF9500' : isHovered ? '#0A84FF' : restingColor2
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const lerp3 = (a: [number, number, number] | number[], b: [number, number, number] | number[], t: number): [number, number, number] => [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ]
  const a1 = p1 as [number, number, number]
  const a2 = p2 as [number, number, number]

  if (viewMode === 'wireframe') {
    const first = new THREE.Color(finalColor1)
    const second = new THREE.Color(finalColor2)
    const centerMidpoint = lerp3(a1, a2, 0.5)
    const positions = new Float32Array([...a1, ...centerMidpoint, ...centerMidpoint, ...a2])
    const vertexColors = new Float32Array([
      first.r, first.g, first.b,
      first.r, first.g, first.b,
      second.r, second.g, second.b,
      second.r, second.g, second.b,
    ])
    return (
      <lineSegments onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[vertexColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent={isFaded || (renderOverride?.opacity ?? 1) < 1} opacity={(isFaded ? focusedAtomOpacity : 1) * (renderOverride?.opacity ?? 1)} depthWrite={!isFaded && (renderOverride?.opacity ?? 1) >= 1} />
      </lineSegments>
    )
  }
  
  if (isFaded) {
    const dim = new THREE.Color(finalColor1)
    const positions = new Float32Array([...a1, ...a2])
    return (
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={dim}
          transparent
          opacity={focusedAtomOpacity * (renderOverride?.opacity ?? 1)}
          depthWrite={false}
        />
      </lineSegments>
    )
  }

  // Get bond cylinder configurations with perpendicular offsets
  const getBondCylinders = (): Array<{ offsetX: number; offsetY: number; offsetZ: number; radius: number; isDashed?: boolean }> => {
    const perp = perpendicular1
    switch (bond.type) {
      case 'single':
        return [{ offsetX: 0, offsetY: 0, offsetZ: 0, radius: baseRadius }]
      case 'double':
        return [
          { 
            offsetX: -bondSpacing / 2 * perp[0], 
            offsetY: -bondSpacing / 2 * perp[1], 
            offsetZ: -bondSpacing / 2 * perp[2], 
            radius: baseRadius * 0.75 
          },
          { 
            offsetX: bondSpacing / 2 * perp[0], 
            offsetY: bondSpacing / 2 * perp[1], 
            offsetZ: bondSpacing / 2 * perp[2], 
            radius: baseRadius * 0.75 
          },
        ]
      case 'triple':
        return [
          { offsetX: 0, offsetY: 0, offsetZ: 0, radius: baseRadius * 0.65 },
          { 
            offsetX: -bondSpacing * perp[0], 
            offsetY: -bondSpacing * perp[1], 
            offsetZ: -bondSpacing * perp[2], 
            radius: baseRadius * 0.65 
          },
          { 
            offsetX: bondSpacing * perp[0], 
            offsetY: bondSpacing * perp[1], 
            offsetZ: bondSpacing * perp[2], 
            radius: baseRadius * 0.65 
          },
        ]
      case 'partial':
        // Partial bond: one solid + one dashed
        return [
          { 
            offsetX: -bondSpacing / 2 * perp[0], 
            offsetY: -bondSpacing / 2 * perp[1], 
            offsetZ: -bondSpacing / 2 * perp[2], 
            radius: baseRadius * 0.75,
            isDashed: false
          },
          { 
            offsetX: bondSpacing / 2 * perp[0], 
            offsetY: bondSpacing / 2 * perp[1], 
            offsetZ: bondSpacing / 2 * perp[2], 
            radius: baseRadius * 0.75,
            isDashed: true
          },
        ]
      default:
        return [{ offsetX: 0, offsetY: 0, offsetZ: 0, radius: baseRadius }]
    }
  }
  
  const cylinders = getBondCylinders()

  // Stop each cylinder at the sphere/cylinder intersection, not at the sphere's
  // axial tangent. Taking the deepest inset across offset cylinders keeps all
  // double/triple-bond strands covered by the atom and its optional outline.
  const endpointInset = (radius: number) => Math.min(...cylinders.map((cyl) => (
    calculateBondEndpointInset({
      atomRadius: radius,
      bondRadius: cyl.radius,
      radialOffset: Math.hypot(cyl.offsetX, cyl.offsetY, cyl.offsetZ),
      outline,
      outlineWidth,
    })
  )))
  const inset1 = endpointInset(r1)
  const inset2 = endpointInset(r2)
  const clipEnabled = inset1 + inset2 < distance * 0.95
  const t1 = clipEnabled ? inset1 / distance : 0
  const t2 = clipEnabled ? 1 - inset2 / distance : 1
  const bondStart = lerp3(a1, a2, t1)
  const bondEnd = lerp3(a1, a2, t2)
  const midpoint = lerp3(a1, a2, (t1 + t2) / 2)
  
  // For ball-stick, render two-toned bond (half in each atom's color).
  const effectiveLength = distance * (t2 - t1)
  const halfLength = effectiveLength / 2

  const firstHalfCenter: [number, number, number] = [
    (bondStart[0] + midpoint[0]) / 2,
    (bondStart[1] + midpoint[1]) / 2,
    (bondStart[2] + midpoint[2]) / 2,
  ]

  const secondHalfCenter: [number, number, number] = [
    (midpoint[0] + bondEnd[0]) / 2,
    (midpoint[1] + bondEnd[1]) / 2,
    (midpoint[2] + bondEnd[2]) / 2,
  ]
  
  // Generate dashed segments for partial bond
  const generateDashedSegments = (
    start: [number, number, number],
    end: [number, number, number],
    numDashes: number = dashedSegmentCount
  ) => {
    const segments: Array<{ center: [number, number, number]; length: number }> = []
    const totalLength = Math.sqrt(
      (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2 + (end[2] - start[2]) ** 2
    )
    const dashLength = totalLength / (numDashes * 2 - 1) // dash + gap pattern
    
    for (let i = 0; i < numDashes; i++) {
      const t = (i * 2) / (numDashes * 2 - 1) + 0.5 / (numDashes * 2 - 1)
      const center: [number, number, number] = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
      ]
      segments.push({ center, length: dashLength * 0.8 })
    }
    return segments
  }
  
  return (
    <group
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {cylinders.map((cyl, idx) => (
        <group key={idx}>
          {/* Render solid or dashed based on isDashed flag */}
          {cyl.isDashed ? (
            <>
              {/* Dashed first half */}
              {generateDashedSegments(
                [bondStart[0] + cyl.offsetX, bondStart[1] + cyl.offsetY, bondStart[2] + cyl.offsetZ],
                [midpoint[0] + cyl.offsetX, midpoint[1] + cyl.offsetY, midpoint[2] + cyl.offsetZ],
                3
              ).map((seg, segIdx) => (
                <BondCylinder
                  key={`dash1-${segIdx}`}
                  position={seg.center}
                  rotation={rotation}
                  radius={cyl.radius}
                  length={seg.length}
                  radialSegments={radialSegments}
                  color={finalColor1}
                  opacity={(isFaded ? focusedAtomOpacity : 1) * (renderOverride?.opacity ?? 1)}
                  outline={outline}
                  outlineWidth={outlineWidth}
                  outlineColor={outlineColor}
                  renderOverride={renderOverride}
                />
              ))}
              {/* Dashed second half */}
              {generateDashedSegments(
                [midpoint[0] + cyl.offsetX, midpoint[1] + cyl.offsetY, midpoint[2] + cyl.offsetZ],
                [bondEnd[0] + cyl.offsetX, bondEnd[1] + cyl.offsetY, bondEnd[2] + cyl.offsetZ],
                3
              ).map((seg, segIdx) => (
                <BondCylinder
                  key={`dash2-${segIdx}`}
                  position={seg.center}
                  rotation={rotation}
                  radius={cyl.radius}
                  length={seg.length}
                  radialSegments={radialSegments}
                  color={finalColor2}
                  opacity={(isFaded ? focusedAtomOpacity : 1) * (renderOverride?.opacity ?? 1)}
                  outline={outline}
                  outlineWidth={outlineWidth}
                  outlineColor={outlineColor}
                  renderOverride={renderOverride}
                />
              ))}
            </>
          ) : (
            <>
              {/* First half - atom1 color (solid) */}
              <BondCylinder
                position={[
                  firstHalfCenter[0] + cyl.offsetX,
                  firstHalfCenter[1] + cyl.offsetY,
                  firstHalfCenter[2] + cyl.offsetZ,
                ]}
                rotation={rotation}
                radius={cyl.radius}
                length={halfLength}
                radialSegments={radialSegments}
                color={finalColor1}
                opacity={(isFaded ? focusedAtomOpacity : 1) * (renderOverride?.opacity ?? 1)}
                outline={outline}
                outlineWidth={outlineWidth}
                outlineColor={outlineColor}
                renderOverride={renderOverride}
              />
              
              {/* Second half - atom2 color (solid) */}
              <BondCylinder
                position={[
                  secondHalfCenter[0] + cyl.offsetX,
                  secondHalfCenter[1] + cyl.offsetY,
                  secondHalfCenter[2] + cyl.offsetZ,
                ]}
                rotation={rotation}
                radius={cyl.radius}
                length={halfLength}
                radialSegments={radialSegments}
                color={finalColor2}
                opacity={(isFaded ? focusedAtomOpacity : 1) * (renderOverride?.opacity ?? 1)}
                outline={outline}
                outlineWidth={outlineWidth}
                outlineColor={outlineColor}
                renderOverride={renderOverride}
              />
            </>
          )}
          
        </group>
      ))}
    </group>
  )
}

// Expand one logical bond into only those periodic segments whose atom images exist.
export function BondMesh(props: BondMeshProps) {
  const { bond, atoms } = props
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)

  const allBonds = useCrystalStore((s) => s.bonds)
  const unwrapMap = useDisplayPositions(atoms, allBonds)
  const { offsets: imageOffsets, displayBox } = useDisplayImages(atoms)

  const atomMap = props.atomMap
  const segments = useMemo(() => {
    const find = (id: string) => atomMap?.get(id) ?? atoms.find((a) => a.id === id)
    return buildBondSegments({
      bonds: [bond],
      positionOf: (id) => unwrapMap?.get(id) ?? find(id)?.cartesian,
      lattice: displayBox ?? latticeVectors,
      instances: imageOffsets,
    })
  }, [bond, atoms, atomMap, unwrapMap, displayBox, latticeVectors, imageOffsets])

  return (
    <>
      {segments.map((segment) => (
        <BondSegmentMesh key={segment.key} {...props} p1={segment.p1} p2={segment.p2} />
      ))}
    </>
  )
}
