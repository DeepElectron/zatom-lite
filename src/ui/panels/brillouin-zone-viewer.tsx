'use client'

import { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Line, Html, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { 
  conventionalToPrimitiveLattice,
  hexagonalToRhombohedralPrimitive,
} from '../../lib/crystal/brillouin-zone'
import {
  constructBrillouinZone,
  reciprocalLattice as calculateReciprocalLattice,
  type BrillouinZone,
} from '../../lib/brillouin/wigner-seitz'
import { 
  getKPointsForLattice, 
  getKPathForLattice,
  getKPointDisplayLabel,
  formatKPointCoords,
} from '../../lib/crystal/kpath'
import type { KPoint, KPath } from '../../lib/crystal/kpath'
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'

type V3 = [number, number, number]

/**
 * HPKOT k-points and path for a cell. The k-path library throws rather than
 * substitute a wrong lattice's points; here that becomes an empty result plus
 * a message, so the Brillouin zone itself still renders.
 */
function computeKPathData(
  a1: V3, a2: V3, a3: V3, b1: V3, b2: V3, b3: V3,
  centering: 'P' | 'F' | 'I' | 'C' | 'A' | 'R' | undefined,
  spaceGroupNumber: number | undefined,
): { kpoints: KPoint[]; kpath: KPath | null; error: string | null } {
  try {
    return {
      kpoints: getKPointsForLattice(a1, a2, a3, b1, b2, b3, centering, spaceGroupNumber),
      kpath: getKPathForLattice(a1, a2, a3, b1, b2, b3, centering, spaceGroupNumber),
      error: null,
    }
  } catch (error) {
    return { kpoints: [], kpath: null, error: error instanceof Error ? error.message : String(error) }
  }
}

// Brillouin zone mesh with faces and edges
function BrillouinZoneMesh({ 
  bzData, 
  showFaces = true,
  showEdges = true,
  opacity = 0.15 
}: { 
  bzData: BrillouinZone
  showFaces?: boolean
  showEdges?: boolean
  opacity?: number
}) {
  const meshRef = useRef<THREE.Group>(null)
  
  return (
    <group ref={meshRef}>
      {/* Render faces */}
      {showFaces && bzData.faces.map((face, faceIdx) => {
        if (face.length < 3) return null
        
        const vertices = face.map(idx => bzData.vertices[idx])
        const positions: number[] = []
        
        // Triangulate using fan from first vertex
        for (let i = 1; i < face.length - 1; i++) {
          positions.push(...vertices[0])
          positions.push(...vertices[i])
          positions.push(...vertices[i + 1])
        }
        
        return (
          <mesh key={`face-${faceIdx}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={positions.length / 3}
                array={new Float32Array(positions)}
                itemSize={3}
              />
            </bufferGeometry>
            <meshBasicMaterial 
              color="#0A84FF" 
              transparent 
              opacity={opacity}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )
      })}
      
      {/* Render edges */}
      {showEdges && bzData.edges.map(([i, j], edgeIdx) => (
        <Line
          key={`edge-${edgeIdx}`}
          points={[bzData.vertices[i], bzData.vertices[j]]}
          color="#0A84FF"
          lineWidth={1.5}
        />
      ))}
    </group>
  )
}

// K-points visualization
function KPointsViz({ 
  kpoints, 
  showLabels = true 
}: { 
  kpoints: KPoint[]
  showLabels?: boolean
}) {
  return (
    <group>
      {kpoints.map((kpoint, idx) => (
        <group key={idx} position={kpoint.cartesian}>
          {/* K-point sphere */}
          <mesh>
            <sphereGeometry args={[0.08, 16, 12]} />
            <meshBasicMaterial color="#FF9F0A" />
          </mesh>
          
          {/* Label */}
          {showLabels && (
            <Html
              position={[0.15, 0.15, 0]}
              style={{ pointerEvents: 'none' }}
              center
            >
              <div className="bg-black/80 text-[#FF9F0A] text-[11px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                {getKPointDisplayLabel(kpoint.label)}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  )
}

// K-path visualization
function KPathViz({ kpath }: { kpath: KPath }) {
  const kpointMap = useMemo(() => 
    new Map(kpath.points.map(p => [p.label, p])),
    [kpath.points]
  )
  
  return (
    <group>
      {kpath.segments.map(([startLabel, endLabel], idx) => {
        const start = kpointMap.get(startLabel)
        const end = kpointMap.get(endLabel)
        
        if (!start || !end) return null
        
        return (
          <Line
            key={idx}
            points={[start.cartesian, end.cartesian]}
            color="#30D158"
            lineWidth={2}
          />
        )
      })}
    </group>
  )
}

// Reciprocal lattice vectors visualization
function ReciprocalLatticeViz({ 
  b1, b2, b3 
}: { 
  b1: [number, number, number]
  b2: [number, number, number]
  b3: [number, number, number]
}) {
  const scale = 0.5 // Scale down for visibility
  
  return (
    <group>
      {/* b1 vector - red */}
      <Line
        points={[[0, 0, 0], [b1[0] * scale, b1[1] * scale, b1[2] * scale]]}
        color="#FF453A"
        lineWidth={2}
      />
      <Html position={[b1[0] * scale * 1.1, b1[1] * scale * 1.1, b1[2] * scale * 1.1]} center>
        <div className="text-[10px] text-[#FF453A] font-bold">b₁</div>
      </Html>
      
      {/* b2 vector - green */}
      <Line
        points={[[0, 0, 0], [b2[0] * scale, b2[1] * scale, b2[2] * scale]]}
        color="#30D158"
        lineWidth={2}
      />
      <Html position={[b2[0] * scale * 1.1, b2[1] * scale * 1.1, b2[2] * scale * 1.1]} center>
        <div className="text-[10px] text-[#30D158] font-bold">b₂</div>
      </Html>
      
      {/* b3 vector - blue */}
      <Line
        points={[[0, 0, 0], [b3[0] * scale, b3[1] * scale, b3[2] * scale]]}
        color="#0A84FF"
        lineWidth={2}
      />
      <Html position={[b3[0] * scale * 1.1, b3[1] * scale * 1.1, b3[2] * scale * 1.1]} center>
        <div className="text-[10px] text-[#0A84FF] font-bold">b₃</div>
      </Html>
    </group>
  )
}

// Auto-rotate camera
function AutoRotate({ enabled }: { enabled: boolean }) {
  const orbitRef = useRef<any>(null)
  
  useFrame(() => {
    if (enabled && orbitRef.current) {
      orbitRef.current.autoRotate = true
      orbitRef.current.autoRotateSpeed = 1
      orbitRef.current.update()
    }
  })
  
  return (
    <OrbitControls
      ref={orbitRef}
      enablePan
      enableZoom
      enableRotate
      autoRotate={enabled}
      autoRotateSpeed={1}
    />
  )
}

// Main scene
function BrillouinZoneScene({
  latticeVectors,
  latticeParams,
  showBZ,
  showKPath,
  showKPoints,
  showReciprocal,
  opacity,
  }: {
  latticeVectors: { a: number[]; b: number[]; c: number[] }
  latticeParams?: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number; centeringType?: string; spaceGroupNumber?: number }
  showBZ: boolean
  showKPath: boolean
  showKPoints: boolean
  showReciprocal: boolean
  opacity: number
  }) {
  const autoRotate = false
  
// Calculate reciprocal lattice and BZ
  const { reciprocalLattice, bzData, kpoints, kpath } = useMemo(() => {
    const a1 = latticeVectors.a as [number, number, number]
    const a2 = latticeVectors.b as [number, number, number]
    const a3 = latticeVectors.c as [number, number, number]
    const centeringType = latticeParams?.centeringType as 'P' | 'F' | 'I' | 'C' | 'A' | 'R' | undefined
    const sgNum = latticeParams?.spaceGroupNumber

    // For R-centered lattices, use primitive rhombohedral cell for BZ construction
    let effectiveA1 = a1
    let effectiveA2 = a2
    let effectiveA3 = a3

    if (centeringType === 'R' && latticeParams) {
      const rhomPrim = hexagonalToRhombohedralPrimitive(latticeParams.a, latticeParams.c)
      effectiveA1 = rhomPrim.latticeVectors[0]
      effectiveA2 = rhomPrim.latticeVectors[1]
      effectiveA3 = rhomPrim.latticeVectors[2]
    } else {
      const primitive = conventionalToPrimitiveLattice(a1, a2, a3, centeringType)
      effectiveA1 = primitive[0]
      effectiveA2 = primitive[1]
      effectiveA3 = primitive[2]
    }

    const reciprocal = calculateReciprocalLattice(effectiveA1, effectiveA2, effectiveA3)
    const b1 = [...reciprocal[0]] as [number, number, number]
    const b2 = [...reciprocal[1]] as [number, number, number]
    const b3 = [...reciprocal[2]] as [number, number, number]
    const bz = constructBrillouinZone(b1, b2, b3)
    const { kpoints: kpts, kpath: path } = computeKPathData(a1, a2, a3, b1, b2, b3, centeringType, sgNum)
    
    return {
      reciprocalLattice: { b1, b2, b3 },
      bzData: bz,
      kpoints: kpts,
      kpath: path,
    }
  }, [latticeVectors, latticeParams])
  
  return (
    <>
      <PerspectiveCamera makeDefault position={[3, 3, 3]} fov={50} />
      <AutoRotate enabled={autoRotate} />
      
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      
      {/* Reciprocal lattice vectors */}
      {showReciprocal && (
        <ReciprocalLatticeViz 
          b1={reciprocalLattice.b1} 
          b2={reciprocalLattice.b2} 
          b3={reciprocalLattice.b3} 
        />
      )}
      
      {/* Brillouin zone */}
      {showBZ && bzData && (
        <BrillouinZoneMesh bzData={bzData} opacity={opacity} />
      )}
      
      {/* K-points */}
      {showKPoints && kpoints && (
        <KPointsViz kpoints={kpoints} />
      )}
      
      {/* K-path */}
      {showKPath && kpath && (
        <KPathViz kpath={kpath} />
      )}
      
      {/* Coordinate axes */}
      <axesHelper args={[0.5]} />
    </>
  )
}

// K-points table component
function KPointsTable({ kpoints }: { kpoints: KPoint[] }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      <button
        onClick={() => {
          setExpanded(!expanded)
        }}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-white/70 hover:bg-white/5 transition-colors"
      >
        <span>K-Points ({kpoints.length})</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      
      {expanded && (
        <div className="max-h-40 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-white/5 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left text-white/50">Label</th>
                <th className="px-2 py-1 text-left text-white/50">Coordinates</th>
              </tr>
            </thead>
            <tbody>
              {kpoints.map((kpoint, idx) => (
                <tr key={idx} className="border-t border-white/5">
                  <td className="px-2 py-1 text-[#FF9F0A] font-medium">
                    {getKPointDisplayLabel(kpoint.label)}
                  </td>
                  <td className="px-2 py-1 text-white/70 font-mono">
                    {formatKPointCoords(kpoint.coords)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// K-path display component
function KPathDisplay({ kpath }: { kpath: KPath }) {
  const pathString = kpath.segments
    .map(([start, end], idx) => {
      const startLabel = getKPointDisplayLabel(start)
      if (idx === 0) {
        return `${startLabel}-${getKPointDisplayLabel(end)}`
      }
      return getKPointDisplayLabel(end)
    })
    .join('-')
  
  return (
    <div className="bg-white/5 rounded-lg px-3 py-2">
      <div className="text-[10px] text-white/50 mb-1">K-Path</div>
      <div className="text-xs text-[#30D158] font-mono break-all">
        {pathString}
      </div>
    </div>
  )
}

// Helper to convert lattice params to vectors
function latticeParamsToVectors(params: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number }) {
  const { a, b, c, alpha, beta, gamma } = params
  
  // Convert angles to radians
  const alphaRad = alpha * Math.PI / 180
  const betaRad = beta * Math.PI / 180
  const gammaRad = gamma * Math.PI / 180
  
  // Calculate lattice vectors
  // a1 along x-axis
  const a1: [number, number, number] = [a, 0, 0]
  
  // a2 in xy-plane
  const a2: [number, number, number] = [
    b * Math.cos(gammaRad),
    b * Math.sin(gammaRad),
    0
  ]
  
  // a3 determined by all angles
  const cosAlpha = Math.cos(alphaRad)
  const cosBeta = Math.cos(betaRad)
  const cosGamma = Math.cos(gammaRad)
  const sinGamma = Math.sin(gammaRad)
  
  const cx = c * cosBeta
  const cy = c * (cosAlpha - cosBeta * cosGamma) / sinGamma
  const cz = Math.sqrt(c * c - cx * cx - cy * cy)
  
  const a3: [number, number, number] = [cx, cy, cz]
  
  return { a: a1, b: a2, c: a3 }
}

// Main exported component
export function BrillouinZoneViewer() {
  // Get lattice parameters from store
  const latticeParams = useCrystalStore((s) => s.latticeParams)
  const unitCellAtoms = useCrystalStore((s) => s.unitCellAtoms)
  
  const showBZ = useCrystalStore((s) => s.bzShowZone)
  const setShowBZ = useCrystalStore((s) => s.setBZShowZone)
  const showKPath = useCrystalStore((s) => s.bzShowKPath)
  const setShowKPath = useCrystalStore((s) => s.setBZShowKPath)
  const showKPoints = useCrystalStore((s) => s.bzShowKPoints)
  const setShowKPoints = useCrystalStore((s) => s.setBZShowKPoints)
  const showReciprocal = useCrystalStore((s) => s.bzShowReciprocal)
  const setShowReciprocal = useCrystalStore((s) => s.setBZShowReciprocal)
  const opacity = useCrystalStore((s) => s.bzOpacity)
  const setOpacity = useCrystalStore((s) => s.setBZOpacity)
  
  // Check if we have valid lattice parameters
  const hasLattice = latticeParams.a > 0 && latticeParams.b > 0 && latticeParams.c > 0 && unitCellAtoms.length > 0
  
  // Convert lattice params to vectors
  const latticeVectors = useMemo(() => {
    if (!hasLattice) return null
    return latticeParamsToVectors(latticeParams)
  }, [hasLattice, latticeParams])
  
  // Calculate data for the table
  const { kpoints, kpath, kpathError } = useMemo(() => {
    if (!hasLattice || !latticeVectors) {
      return { kpoints: [], kpath: null, kpathError: null }
    }
    
    const a1 = latticeVectors.a
    const a2 = latticeVectors.b
    const a3 = latticeVectors.c
    const centeringType = latticeParams?.centeringType as 'P' | 'F' | 'I' | 'C' | 'A' | 'R' | undefined
    const sgNum2 = (latticeParams as { spaceGroupNumber?: number } | undefined)?.spaceGroupNumber

    let effectiveA1 = a1
    let effectiveA2 = a2
    let effectiveA3 = a3

    if (centeringType === 'R') {
      const rhomPrim = hexagonalToRhombohedralPrimitive(latticeParams.a, latticeParams.c)
      effectiveA1 = rhomPrim.latticeVectors[0]
      effectiveA2 = rhomPrim.latticeVectors[1]
      effectiveA3 = rhomPrim.latticeVectors[2]
    } else {
      const primitive = conventionalToPrimitiveLattice(a1, a2, a3, centeringType)
      effectiveA1 = primitive[0]
      effectiveA2 = primitive[1]
      effectiveA3 = primitive[2]
    }

    const reciprocal = calculateReciprocalLattice(effectiveA1, effectiveA2, effectiveA3)
    const b1 = [...reciprocal[0]] as [number, number, number]
    const b2 = [...reciprocal[1]] as [number, number, number]
    const b3 = [...reciprocal[2]] as [number, number, number]
    const { kpoints: kpts, kpath: path, error } = computeKPathData(a1, a2, a3, b1, b2, b3, centeringType, sgNum2)
    return { kpoints: kpts, kpath: path, kpathError: error }
  }, [hasLattice, latticeVectors, latticeParams])
  
  if (!hasLattice || !latticeVectors) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-white/40 text-sm">
        <div className="mb-2">No crystal structure</div>
        <div className="text-xs">Load a template to view Brillouin zone</div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-3 space-y-2 border-b border-white/10">
        <div className="text-xs text-white/50 mb-2">Display Options</div>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setShowBZ(!showBZ)
            }}
            aria-pressed={showBZ}
            data-selected={showBZ}
            className="zatom-choice zatom-pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]"
          >
            {showBZ ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Brillouin Zone
          </button>
          
          <button
            onClick={() => {
              setShowKPath(!showKPath)
            }}
            aria-pressed={showKPath}
            data-selected={showKPath}
            className="zatom-choice zatom-pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]"
          >
            {showKPath ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            K-Path
          </button>
          
          <button
            onClick={() => {
              setShowKPoints(!showKPoints)
            }}
            aria-pressed={showKPoints}
            data-selected={showKPoints}
            className="zatom-choice zatom-pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]"
          >
            {showKPoints ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            K-Points
          </button>
          
          <button
            onClick={() => {
              setShowReciprocal(!showReciprocal)
            }}
            aria-pressed={showReciprocal}
            data-selected={showReciprocal}
            className="zatom-choice zatom-pressable flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]"
          >
            {showReciprocal ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            b₁b₂b₃
          </button>
        </div>
        
        {/* Opacity slider */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 w-12">Opacity</span>
          <input
            type="range"
            min="0.05"
            max="0.5"
            step="0.05"
            value={opacity}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              setOpacity(val)
            }}
            className="h-1 flex-1 accent-[var(--panel-accent)]"
          />
          <span className="text-[10px] text-white/50 w-8 text-right">{Math.round(opacity * 100)}%</span>
        </div>
      </div>
      
      {/* 3D Viewer */}
      <div  className="flex-1 min-h-[200px] select-none">
        <Canvas
          gl={{ antialias: true, alpha: true }}
          dpr={[1, 2]}
          style={{ background: 'transparent' }}
        >
          <BrillouinZoneScene
            latticeVectors={latticeVectors}
            latticeParams={latticeParams}
            showBZ={showBZ}
            showKPath={showKPath}
            showKPoints={showKPoints}
            showReciprocal={showReciprocal}
            opacity={opacity}
          />
        </Canvas>
      </div>
      
      {/* Info panel */}
      <div className="p-3 space-y-2 border-t border-white/10">
        {kpathError && (
          <p role="alert" className="text-xs leading-relaxed" style={{ color: 'var(--status-red)' }}>
            Band path unavailable: {kpathError}
          </p>
        )}
        {kpath && <KPathDisplay kpath={kpath} />}
        {kpoints.length > 0 && <KPointsTable kpoints={kpoints} />}
      </div>
    </div>
  )
}
