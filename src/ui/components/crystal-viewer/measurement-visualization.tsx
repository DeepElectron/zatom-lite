'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { getElement } from '../../../lib/crystal/elements'

const MEASUREMENT_LABEL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [1, 0], [-1, 0],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]

// Helper to calculate midpoint
function midpoint(p1: [number, number, number], p2: [number, number, number]): [number, number, number] {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2]
}

// Helper to calculate centroid of points
function centroid(points: [number, number, number][]): [number, number, number] {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0] as [number, number, number])
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length]
}



function useMeasurementLabelTexture(text: string, color: string) {
  const label = useMemo(() => {
    const scale = 2
    const fontSize = 34
    const paddingX = 14
    const paddingY = 9
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null

    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    const width = Math.ceil(context.measureText(text).width + paddingX * 2)
    const height = fontSize + paddingY * 2
    canvas.width = width * scale
    canvas.height = height * scale

    context.scale(scale, scale)
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = 4
    context.strokeStyle = 'rgba(0, 0, 0, 0.82)'
    context.strokeText(text, width / 2, height / 2)
    context.fillStyle = color
    context.fillText(text, width / 2, height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return { texture, aspect: width / height }
  }, [text, color])

  useEffect(() => () => label?.texture.dispose(), [label])
  return label
}

// Local canvas texture: unlike drei/Text's default font, this never requests a
// remote font or suspends the entire crystal scene in an offline browser session.
function MeasurementLabel({
  position,
  text,
  color,
  faceCamera,
  offset,
  lane,
  fontSize = 0.25,
}: {
  position: [number, number, number]
  text: string
  color: string
  faceCamera: boolean
  offset: number
  lane: number
  points?: [number, number, number][]
  fontSize?: number
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const label = useMeasurementLabelTexture(text, color)
  
  // Keep each label offset toward the camera, then distribute multiple labels
  // into deterministic screen-space lanes so their values remain readable.
  useFrame(() => {
    if (groupRef.current) {
      const cameraPos = camera.position.clone()
      const labelPos = new THREE.Vector3(...position)
      const toCamera = cameraPos.sub(labelPos).normalize()
      const [laneX, laneY] = MEASUREMENT_LABEL_DIRECTIONS[lane % MEASUREMENT_LABEL_DIRECTIONS.length]
      const ring = Math.floor(lane / MEASUREMENT_LABEL_DIRECTIONS.length) + 1
      const spacing = fontSize * 2.1 * ring
      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
      const laneOffset = cameraRight.multiplyScalar(laneX * spacing)
        .add(camera.up.clone().normalize().multiplyScalar(laneY * spacing))
      groupRef.current.position
        .set(position[0], position[1], position[2])
        .addScaledVector(toCamera, offset)
        .add(laneOffset)
    }
  })
  
  if (!label) return null

  const height = fontSize * 1.35
  const width = height * label.aspect
  
  return (
    <group ref={groupRef} position={position}>
      {faceCamera ? (
        <sprite scale={[width, height, 1]} renderOrder={100}>
          <spriteMaterial map={label.texture} transparent depthTest={false} depthWrite={false} />
        </sprite>
      ) : (
        <mesh scale={[width, height, 1]} renderOrder={100}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={label.texture} transparent depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

// Distance visualization component
function DistanceVisualization({ 
  points, 
  value,
  labelOffset,
  faceCamera,
  fontSize = 0.25,
  lineWidth = 2,
  lane = 0,
  color,
}: { 
  points: [number, number, number][]
  value: number
  labelOffset: number
  faceCamera: boolean
  fontSize?: number
  lineWidth?: number
  lane?: number
  color: string
}) {
  if (points.length < 2) return null
  
  const [p1, p2] = points
  const mid = midpoint(p1, p2)
  
  return (
    <group>
      {/* Measurement line */}
      <Line
        points={[p1, p2]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />

      {/* End markers */}
      <mesh position={p1}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={p2}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      
      {/* Value label */}
      <MeasurementLabel
        position={mid}
        text={`${value.toFixed(3)} Å`}
        color={color}
        faceCamera={faceCamera}
        offset={labelOffset}
        lane={lane}
        fontSize={fontSize}
      />
    </group>
  )
}

type AngleVisualizationProps = {
  points: [number, number, number][]
  value: number
  labelOffset: number
  faceCamera: boolean
  vertexElement?: string
  fontSize?: number
  lineWidth?: number
  lane?: number
  color: string
}

// Angle visualization component
function AngleVisualization(props: AngleVisualizationProps) {
  if (props.points.length < 3) return null

  return <AngleVisualizationContent {...props} />
}

function AngleVisualizationContent({ 
  points, 
  value,
  labelOffset,
  faceCamera,
  vertexElement,
  fontSize = 0.25,
  lineWidth = 2,
  lane = 0,
  color,
}: AngleVisualizationProps) {
  const [p1, p2, p3] = points as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    ...[number, number, number][],
  ]
  
  // Get vertex atom radius to ensure arc is larger
  const vertexAtomRadius = useMemo(() => {
    if (vertexElement) {
      const elementData = getElement(vertexElement)
      return elementData?.radius || 0.5
    }
    return 0.5
  }, [vertexElement])
  
  // Create arc and filled sector to visualize angle
  const { arcPoints, sectorGeometry } = useMemo(() => {
    const v1 = new THREE.Vector3(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]).normalize()
    const v2 = new THREE.Vector3(p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]).normalize()
    
    // Arc radius should be larger than atom radius (add 0.3 buffer)
    const arcRadius = Math.max(vertexAtomRadius + 0.3, 0.6)
    const segments = 48
    const angleRad = value * (Math.PI / 180)
    
    const pts: [number, number, number][] = []
    
    // Create rotation axis
    const axis = new THREE.Vector3().crossVectors(v1, v2)
    if (axis.length() < 0.001) {
      // Vectors are parallel, can't create arc
      return { arcPoints: [], sectorGeometry: null }
    }
    axis.normalize()
    
    // Generate arc points
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = t * angleRad
      
      const rotatedV1 = v1.clone().applyAxisAngle(axis, angle)
      pts.push([
        p2[0] + rotatedV1.x * arcRadius,
        p2[1] + rotatedV1.y * arcRadius,
        p2[2] + rotatedV1.z * arcRadius,
      ])
    }
    
    // Create filled sector geometry
    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    
    // Add triangles from center to arc
    for (let i = 0; i < pts.length - 1; i++) {
      // Center point
      vertices.push(p2[0], p2[1], p2[2])
      // Current arc point
      vertices.push(pts[i][0], pts[i][1], pts[i][2])
      // Next arc point
      vertices.push(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2])
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()
    
    return { arcPoints: pts, sectorGeometry: geometry }
  }, [p1, p2, p3, value, vertexAtomRadius])
  
  // Calculate label position - at the middle of the arc
  const labelPosition = useMemo(() => {
    if (arcPoints.length < 2) return p2
    const midIndex = Math.floor(arcPoints.length / 2)
    return arcPoints[midIndex]
  }, [arcPoints, p2])
  
  return (
    <group>
      {/* Lines to endpoints - shorter partial lines near vertex */}
      <Line
        points={[p1, p2]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />
      <Line
        points={[p2, p3]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />
      
      {/* Filled sector (semi-transparent) */}
      {sectorGeometry && (
        <mesh geometry={sectorGeometry}>
          <meshBasicMaterial
            color={color}
            transparent 
            opacity={0.25} 
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      
      {/* Arc outline */}
      {arcPoints.length > 1 && (
        <Line
          points={arcPoints}
          color={color}
          lineWidth={lineWidth * 1.5}
        />
      )}
      
      {/* Vertex marker */}
      <mesh position={p2}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      
      {/* Endpoint markers */}
      <mesh position={p1}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={p3}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      
      {/* Value label - positioned at middle of arc */}
      <MeasurementLabel
        position={labelPosition}
        text={`${value.toFixed(1)}°`}
        color={color}
        faceCamera={faceCamera}
        offset={labelOffset * 0.5}
        lane={lane}
        fontSize={fontSize}
      />
    </group>
  )
}

// Dihedral angle visualization component
function DihedralVisualization({ 
  points, 
  value,
  labelOffset,
  faceCamera,
  fontSize = 0.25,
  lineWidth = 2,
  lane = 0,
  color,
}: { 
  points: [number, number, number][]
  value: number
  labelOffset: number
  faceCamera: boolean
  fontSize?: number
  lineWidth?: number
  lane?: number
  color: string
}) {
  if (points.length < 4) return null
  
  const [p1, p2, p3, p4] = points
  const center = centroid(points)
  
  return (
    <group>
      {/* Lines connecting all 4 atoms */}
      <Line
        points={[p1, p2]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />
      <Line
        points={[p2, p3]}
        color={color}
        lineWidth={lineWidth}
      />
      <Line
        points={[p3, p4]}
        color={color}
        lineWidth={lineWidth}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />
      
      {/* Markers */}
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      
      {/* Value label - positioned at center */}
      <MeasurementLabel
        position={center}
        text={`${value.toFixed(1)}°`}
        color={color}
        faceCamera={faceCamera}
        offset={labelOffset}
        lane={lane}
        fontSize={fontSize}
      />
    </group>
  )
}

// Pending measurement visualization (shows atoms selected so far)
function PendingMeasurementVisualization() {
  const atoms = useCrystalStore((s) => s.atoms)
  const measurementMode = useCrystalStore((s) => s.measurementMode)
  const pendingMeasurementAtoms = useCrystalStore((s) => s.pendingMeasurementAtoms)
  const color = useCrystalStore((s) => s.measurementColor)
  
  const points = useMemo(() => {
    return pendingMeasurementAtoms
      .map(id => atoms.find(a => a.id === id)?.cartesian)
      .filter((p): p is [number, number, number] => p !== undefined)
  }, [pendingMeasurementAtoms, atoms])
  
  if (points.length < 2 || measurementMode === 'none') return null
  
  return (
    <group>
      {/* Lines between pending atoms */}
      {points.slice(1).map((p, i) => (
        <Line
          key={i}
          points={[points[i], p]}
          color={color}
          lineWidth={1}
          opacity={0.5}
          transparent
          dashed
          dashSize={0.15}
          gapSize={0.1}
        />
      ))}
    </group>
  )
}

// Main measurement visualization component
export function MeasurementVisualization() {
  const atoms = useCrystalStore((s) => s.atoms)
  const measurements = useCrystalStore((s) => s.measurements)
  const labelOffset = useCrystalStore((s) => s.measurementLabelOffset)
  const faceCamera = useCrystalStore((s) => s.measurementLabelFaceCamera)
  const fontSize = useCrystalStore((s) => s.measurementFontSize)
  const lineWidth = useCrystalStore((s) => s.measurementLineWidth)
  const color = useCrystalStore((s) => s.measurementColor)
  
  const measurementData = useMemo(() => {
    return measurements.map(m => {
      const measurementAtoms = m.atomIds.map(id => atoms.find(a => a.id === id))
      const pts = measurementAtoms
        .map(a => a?.cartesian)
        .filter((p): p is [number, number, number] => p !== undefined)
      
      // For angle measurements, get the vertex atom (middle atom) element
      const vertexElement = m.type === 'angle' && measurementAtoms[1] 
        ? measurementAtoms[1].element 
        : undefined
      
      return { ...m, points: pts, vertexElement }
    })
  }, [measurements, atoms])
  
  return (
    <group>
      {/* Pending measurement */}
      <PendingMeasurementVisualization />
      
      {/* Completed measurements */}
      {measurementData.map((m, measurementIndex) => {
        if (m.type === 'distance') {
          return (
            <DistanceVisualization 
              key={m.id} 
              points={m.points} 
              value={m.value}
              labelOffset={labelOffset}
              faceCamera={faceCamera}
              fontSize={fontSize}
              lineWidth={lineWidth}
              lane={measurementIndex}
              color={color}
            />
          )
        }
        if (m.type === 'angle') {
          return (
            <AngleVisualization 
              key={m.id} 
              points={m.points} 
              value={m.value}
              labelOffset={labelOffset}
              faceCamera={faceCamera}
              vertexElement={m.vertexElement}
              fontSize={fontSize}
              lineWidth={lineWidth}
              lane={measurementIndex}
              color={color}
            />
          )
        }
        if (m.type === 'dihedral') {
          return (
            <DihedralVisualization 
              key={m.id} 
              points={m.points} 
              value={m.value}
              labelOffset={labelOffset}
              faceCamera={faceCamera}
              fontSize={fontSize}
              lineWidth={lineWidth}
              lane={measurementIndex}
              color={color}
            />
          )
        }
        return null
      })}
    </group>
  )
}
