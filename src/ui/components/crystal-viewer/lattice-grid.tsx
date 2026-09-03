'use client'

import { useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { AxisQuickMenu } from './axis-quick-menu'
import type { LatticeVectors, SupercellParams } from '../../../lib/crystal/types'
import { generateLatticeFaces, generateLatticeEdges } from '../../../lib/crystal/lattice'
import { isMobileLikeRuntime, shouldDisableGeometrySelection } from '../../../lib/performance/adaptive-performance'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { resolveLatticeEdges, resolveLatticeGridVisibility } from '../../../lib/render/lattice-visibility'

interface LatticeGridProps {
  latticeVectors: LatticeVectors
  supercell: SupercellParams
  visible: boolean
}

// Thin line for lattice edges using Line from drei
function ThinLine({
  start,
  end,
  color,
  lineWidth = 1,
  opacity = 1,
  dashed = false
}: {
  start: [number, number, number]
  end: [number, number, number]
  color: string
  lineWidth?: number
  opacity?: number
  /** Aperiodic-axis edges use dashes to distinguish them from periodic edges. */
  dashed?: boolean
}) {
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={lineWidth}
      transparent={opacity < 1}
      opacity={opacity}
      dashed={dashed}
      dashSize={0.35}
      gapSize={0.25}
    />
  )
}

// Invisible clickable cylinder for edge selection (larger hit area)
function ClickableEdgeArea({
  start,
  end,
  hitRadius = 0.35,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  start: [number, number, number]
  end: [number, number, number]
  hitRadius?: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: () => void
}) {
  const { position, quaternion, length } = useMemo(() => {
    const startVec = new THREE.Vector3(...start)
    const endVec = new THREE.Vector3(...end)
    const direction = new THREE.Vector3().subVectors(endVec, startVec)
    const length = direction.length()
    const position = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5)
    const quaternion = new THREE.Quaternion()
    if (length > 0) {
      const up = new THREE.Vector3(0, 1, 0)
      direction.normalize()
      quaternion.setFromUnitVectors(up, direction)
    }
    return { position, quaternion, length }
  }, [start, end])

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      renderOrder={-1}
    >
      <cylinderGeometry args={[hitRadius, hitRadius, length, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// Clickable lattice edge with thin line display but large hit area
function LatticeEdge({
  id,
  start,
  end,
  geometrySelectionEnabled,
  kind,
  dashed = false,
}: {
  id: string
  start: [number, number, number]
  end: [number, number, number]
  geometrySelectionEnabled: boolean
  kind: 'boundary' | 'cell-grid'
  dashed?: boolean
}) {
  const selectMode = useCrystalStore(s => s.selectMode)
  const faceSelectMethod = useCrystalStore(s => s.faceSelectMethod)
  const selectedEdgeIds = useCrystalStore(s => s.selectedEdgeIds)
  const selectEdge = useCrystalStore(s => s.selectEdge)
  const hoveredEdgeId = useCrystalStore(s => s.hoveredEdgeId)
  const setHoveredEdge = useCrystalStore(s => s.setHoveredEdge)
  const cellColor = useCrystalStore(s => s.cellColor)
  const cellLineWidth = useCrystalStore(s => s.cellLineWidth)

  const isSelected = selectedEdgeIds.has(id)
  const isHovered = hoveredEdgeId === id

  // Edges are operands for two-edge face construction, not an independent selection mode.
  const canSelectEdge = geometrySelectionEnabled &&
    selectMode === 'face' && faceSelectMethod === 'two-edges'

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!canSelectEdge) return
    e.stopPropagation()
    selectEdge(id, true)
  }

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!canSelectEdge) return
    e.stopPropagation()
    setHoveredEdge(id)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (hoveredEdgeId === id) {
      setHoveredEdge(null)
      document.body.style.cursor = 'default'
    }
  }

  // Visual style - keep thin and subtle, only change on selection/hover
  const color = isSelected
    ? '#FF9500'
    : isHovered
      ? '#5AC8FA'
      : cellColor
  const opacity = isSelected ? 0.9 : isHovered ? 0.6 : kind === 'boundary' ? 0.72 : 0.24
  const lineWidth = isSelected
    ? 1.5
    : isHovered
      ? 1.2
      : kind === 'boundary'
        ? cellLineWidth
        : Math.max(0.25, cellLineWidth * 0.55)

  return (
    <group>
      {/* Visual thin line */}
      <ThinLine
        start={start}
        end={end}
        color={color}
        lineWidth={lineWidth}
        opacity={opacity}
        dashed={dashed}
      />
      {/* Invisible larger hit area - always present when edge selection is possible */}
      {canSelectEdge && (
        <ClickableEdgeArea
          start={start}
          end={end}
          hitRadius={0.4}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      )}
    </group>
  )
}

// Clickable lattice face
function LatticeFace({
  id,
  vertices,
  geometrySelectionEnabled,
}: {
  id: string
  vertices: [number, number, number][]
  geometrySelectionEnabled: boolean
}) {
  const selectMode = useCrystalStore(s => s.selectMode)
  const faceSelectMethod = useCrystalStore(s => s.faceSelectMethod)
  const selectedFaceIds = useCrystalStore(s => s.selectedFaceIds)
  const selectFace = useCrystalStore(s => s.selectFace)
  const hoveredFaceId = useCrystalStore(s => s.hoveredFaceId)
  const setHoveredFace = useCrystalStore(s => s.setHoveredFace)

  const isSelected = selectedFaceIds.has(id)
  const isHovered = hoveredFaceId === id

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()

    // Create triangles from quad (4 vertices -> 2 triangles)
    if (vertices.length === 4) {
      const positions = new Float32Array([
        ...vertices[0], ...vertices[1], ...vertices[2],
        ...vertices[0], ...vertices[2], ...vertices[3],
      ])
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.computeVertexNormals()
    }

    return geo
  }, [vertices])

  // Only allow direct face click when method is 'direct'
  const canClick = geometrySelectionEnabled && selectMode === 'face' && faceSelectMethod === 'direct'

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!canClick) return
    e.stopPropagation()
    selectFace(id, e.nativeEvent.shiftKey)
  }

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!canClick) return
    e.stopPropagation()
    setHoveredFace(id)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (hoveredFaceId === id) {
      setHoveredFace(null)
      document.body.style.cursor = 'default'
    }
  }

  const color = isSelected ? '#FF9500' : isHovered ? '#5AC8FA' : '#0A84FF'
  const opacity = isSelected ? 0.35 : isHovered ? 0.2 : 0

  // Don't render faces when not selected or hovered (completely transparent)
  if (!isSelected && !isHovered && !canClick) return null

  return (
    <mesh
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// Axis line - thin and elegant, no arrows
function AxisLine({
  start,
  end,
  color,
}: {
  start: [number, number, number]
  end: [number, number, number]
  color: string
}) {
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={1.5}
      opacity={0.9}
      transparent
    />
  )
}

// Small sphere at axis end instead of arrow.
function AxisEndpoint({
  position,
  color,
  onPick,
}: {
  position: [number, number, number]
  color: string
  onPick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <group position={position}>
      <mesh renderOrder={15}>
        <sphereGeometry args={[hovered ? 0.09 : 0.06, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {onPick && (
        <mesh
          visible={false}
          onClick={(e) => {
            // A camera drag that ends over the handle is not an axis-menu click.
            if (e.delta > 5) return
            e.stopPropagation()
            onPick()
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(true)
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            setHovered(false)
            document.body.style.cursor = 'auto'
          }}
        >
          <sphereGeometry args={[0.35, 12, 12]} />
        </mesh>
      )}
    </group>
  )
}

function BatchedLatticeEdges({
  edges,
  kind,
  dashed = false,
}: {
  edges: Array<{ start: [number, number, number]; end: [number, number, number] }>
  kind: 'boundary' | 'cell-grid'
  dashed?: boolean
}) {
  const cellColor = useCrystalStore(s => s.cellColor)
  const cellLineWidth = useCrystalStore(s => s.cellLineWidth)
  const points = useMemo(
    () => edges.flatMap((edge) => [edge.start, edge.end]),
    [edges],
  )

  return (
    <Line
      points={points}
      segments
      color={cellColor}
      lineWidth={kind === 'boundary' ? cellLineWidth : Math.max(0.25, cellLineWidth * 0.55)}
      transparent
      opacity={kind === 'boundary' ? 0.72 : 0.24}
      dashed={dashed}
      dashSize={0.35}
      gapSize={0.25}
    />
  )
}

function LatticeEdgeSet({
  edges,
  kind,
  geometrySelectionEnabled,
  periodicDirs,
}: {
  edges: Array<{
    id: string
    start: [number, number, number]
    end: [number, number, number]
    direction: 'a' | 'b' | 'c'
  }>
  kind: 'boundary' | 'cell-grid'
  geometrySelectionEnabled: boolean
  periodicDirs: { a: boolean; b: boolean; c: boolean }
}) {
  const anyAperiodic = !periodicDirs.a || !periodicDirs.b || !periodicDirs.c
  if (edges.length > 100 && !geometrySelectionEnabled) {
    if (!anyAperiodic) return <BatchedLatticeEdges edges={edges} kind={kind} />
    const solid = edges.filter((e) => periodicDirs[e.direction])
    const dashedEdges = edges.filter((e) => !periodicDirs[e.direction])
    return (
      <>
        {solid.length > 0 && <BatchedLatticeEdges edges={solid} kind={kind} />}
        {dashedEdges.length > 0 && <BatchedLatticeEdges edges={dashedEdges} kind={kind} dashed />}
      </>
    )
  }
  return edges.map((edge) => (
    <LatticeEdge
      key={edge.id}
      id={edge.id}
      start={edge.start}
      end={edge.end}
      geometrySelectionEnabled={geometrySelectionEnabled}
      kind={kind}
      dashed={!periodicDirs[edge.direction]}
    />
  ))
}

export function LatticeGrid({ latticeVectors, supercell, visible }: LatticeGridProps) {
  const atoms = useCrystalStore(s => s.atoms)
  const selectMode = useCrystalStore(s => s.selectMode)
  const useLowDetailMode = useCrystalStore(s => s.useLowDetailMode)
  const useUltraLowMode = useCrystalStore(s => s.useUltraLowMode)
  const showCellGrid = useCrystalStore(s => s.showCellGrid)
  const showCrystalAxes = useCrystalStore(s => s.showCrystalAxes)
  const periodic = useCrystalStore(s => s.periodic)
  const periodicDirs = useCrystalStore(s => s.periodicDirs)
  const [axisMenu, setAxisMenu] = useState<'a' | 'b' | 'c' | null>(null)
  const geometrySelectionEnabled = !shouldDisableGeometrySelection(atoms.length, {
    mobileLike: isMobileLikeRuntime(),
  })

  // Generate lattice components
  const { edges, faces } = useMemo(() => {
    const edges = generateLatticeEdges(latticeVectors, supercell)
    const faces = generateLatticeFaces(latticeVectors, supercell)
    return { edges, faces }
  }, [latticeVectors, supercell])

  const visibleEdges = useMemo(
    () => resolveLatticeEdges(edges, supercell, showCellGrid),
    [edges, showCellGrid, supercell],
  )

  // Filter faces to only show exterior faces in low/ultra-low detail mode
  const visibleFaces = useMemo(() => {
    // In detail mode, show all faces
    if (!useLowDetailMode && !useUltraLowMode) return faces

    const { nx, ny, nz } = supercell

    return faces.filter(face => {
      const [i, j, k] = face.cellIndex

      // Only show exterior faces based on their plane orientation
      switch (face.plane) {
        case 'ab':
          // AB faces are on k=0 (bottom) or k=nz (top)
          return k === 0 || k === nz
        case 'bc':
          // BC faces are on i=0 (left) or i=nx (right)
          return i === 0 || i === nx
        case 'ac':
          // AC faces are on j=0 (front) or j=ny (back)
          return j === 0 || j === ny
        default:
          return false
      }
    })
  }, [faces, supercell, useLowDetailMode, useUltraLowMode])

  // Calculate axis endpoints - axes follow lattice vectors from origin
  const origin: [number, number, number] = [0, 0, 0]

  // Normalize and scale axis vectors
  const normalizeAndScale = (v: [number, number, number], scale: number): [number, number, number] => {
    const len = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
    if (len === 0) return [0, 0, 0]
    return [v[0] / len * scale, v[1] / len * scale, v[2] / len * scale]
  }

  const axisScale = 2.0
  const aEnd = normalizeAndScale(latticeVectors.a, axisScale)
  const bEnd = normalizeAndScale(latticeVectors.b, axisScale)
  const cEnd = normalizeAndScale(latticeVectors.c, axisScale)

  const visibility = resolveLatticeGridVisibility(visible, periodic && showCrystalAxes)
  if (!visibility.any) return null

  return (
    <group>
      {/* The supercell domain and its optional unit-cell subdivisions are distinct. */}
      {visibility.lattice && <>
        <LatticeEdgeSet edges={visibleEdges.boundary} kind="boundary" geometrySelectionEnabled={geometrySelectionEnabled} periodicDirs={periodicDirs} />
        <LatticeEdgeSet edges={visibleEdges.cellGrid} kind="cell-grid" geometrySelectionEnabled={geometrySelectionEnabled} periodicDirs={periodicDirs} />
      </>}

      {/* Lattice faces (only visible when in face select mode with direct method, or when selected) */}
      {/* In low detail mode, only exterior faces are shown for performance */}
      {visibility.lattice && (selectMode === 'face') && visibleFaces.map((face) => (
        <LatticeFace
          key={face.id}
          id={face.id}
          vertices={face.vertices}
          geometrySelectionEnabled={geometrySelectionEnabled}
        />
      ))}

      {visibility.axes && <group>
        {/* A axis - red */}
        <AxisLine start={origin} end={aEnd} color="#FF453A" />
        <AxisEndpoint position={aEnd} color="#FF453A" onPick={() => setAxisMenu('a')} />

        {/* B axis - green */}
        <AxisLine start={origin} end={bEnd} color="#30D158" />
        <AxisEndpoint position={bEnd} color="#30D158" onPick={() => setAxisMenu('b')} />

        {/* C axis - blue */}
        <AxisLine start={origin} end={cEnd} color="#0A84FF" />
        <AxisEndpoint position={cEnd} color="#0A84FF" onPick={() => setAxisMenu('c')} />

        {axisMenu && (
          <AxisQuickMenu
            axis={axisMenu}
            position={new THREE.Vector3(...(axisMenu === 'a' ? aEnd : axisMenu === 'b' ? bEnd : cEnd))}
            onClose={() => setAxisMenu(null)}
          />
        )}
      </group>}
    </group>
  )
}
