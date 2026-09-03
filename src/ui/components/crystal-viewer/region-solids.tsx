import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { regionsFromGrainId } from '../../../lib/render/grain-regions'
import { buildRegionHulls, type MergedRegionHulls } from '../../../lib/render/region-hulls'
import { buildVoronoiCells } from '../../../lib/render/region-voronoi-cells'
import { buildVoxelSurface } from '../../../lib/render/region-voxel-surface'
import {
  estimateNeighborCutoff, buildNeighborPairs, clusterFromPairs,
} from '../../../lib/render/region-cluster'
import type { PlaybackChannel } from '../../../lib/render/playback-channel'

/** Minimal structural input — CompactStructure satisfies it; normal (Atom[]) mode
 *  builds one from atom cartesians (+ grain_id props when present). */
export interface RegionSource {
  positions: Float32Array
  count: number
  grainId?: Uint32Array
}

interface RegionSolidsProps {
  source: RegionSource
  /** Live trajectory buffers (compact mode); omit for static structures. */
  playback?: MutableRefObject<PlaybackChannel>
}

/** clusters smaller than this are treated as noise (thermal flicker) in dynamic mode */
const MIN_REGION_ATOMS = 10

/**
 * Phase C: per-region translucent solids (grains / per-frame phases) — the
 * macroscopic "boundary" view. One merged vertex-colored mesh (single draw call) +
 * static edge lines. Two sources of regions:
 *  - STATIC: grainId passthrough, computed once;
 *  - DYNAMIC: a species trajectory supplies per-frame labels → equal-label connected
 *    clusters → hull or voxel surface, rebuilt as the displayed frame changes (the
 *    "decompose into blocks and play them" view; future MD label sources plug in here).
 * During playback hull/voxel vertices follow their atoms via the playback channel.
 */
export function RegionSolids({ source, playback }: RegionSolidsProps) {
  const showRegionSolids = useCrystalStore((s) => s.showRegionSolids)
  const regionOpacity = useCrystalStore((s) => s.regionOpacity)
  const trajectoryActive = useCrystalStore((s) => s.compactTrajectory !== null)
  const regionSeeds = useCrystalStore((s) => s.regionSeeds)
  const speciesSource = useCrystalStore((s) => s.compactSpeciesSource)
  const displayFrame = useCrystalStore((s) => s.compactTrajectoryDisplayFrame)
  const geometryMode = useCrystalStore((s) => s.regionGeometryMode)
  const hideMajority = useCrystalStore((s) => s.regionHideMajority)

  // Dynamic regions need per-frame labels: a species source whose atoms match this structure.
  const dynamicActive = showRegionSolids && !!speciesSource && speciesSource.atomCount === source.count

  // Static polycrystal path, computed once.
  const staticMerged = useMemo(() => {
    if (!showRegionSolids || dynamicActive || !source.grainId) return null
    const assignment = regionsFromGrainId(source.grainId)
    if (geometryMode === 'voxel') {
      const cell = estimateNeighborCutoff(source.positions, source.count) / 1.35
      return buildVoxelSurface(source.positions, source.count, assignment.regionOf, cell)
    }
    if (regionSeeds) {
      // exact Voronoi cells (half-space clipping) — gap-free tiling by construction
      const bbMin: [number, number, number] = [Infinity, Infinity, Infinity]
      const bbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < source.count; i++) {
        for (let a = 0; a < 3; a++) {
          const v = source.positions[i * 3 + a]
          if (v < bbMin[a]) bbMin[a] = v
          if (v > bbMax[a]) bbMax[a] = v
        }
      }
      return buildVoronoiCells(source.positions, assignment.regionOf, assignment.regionIds, regionSeeds, bbMin, bbMax)
    }
    return buildRegionHulls(source.positions, assignment.regionOf, assignment.regionIds, regionSeeds)
  }, [source, showRegionSolids, regionSeeds, dynamicActive, geometryMode])

  // ---- dynamic path: one-time neighbor graph (positions are static across frames) ----
  const dynInfra = useMemo(() => {
    if (!dynamicActive) return null
    const cutoff = estimateNeighborCutoff(source.positions, source.count)
    return {
      pairs: buildNeighborPairs(source.positions, source.count, cutoff),
      cell: cutoff / 1.35, // ≈ the lattice's nearest-neighbor spacing
      labels: new Uint8Array(source.count),
    }
  }, [dynamicActive, source])

  const [dynMerged, setDynMerged] = useState<MergedRegionHulls | null>(null)
  useEffect(() => {
    if (!dynInfra || !speciesSource) { setDynMerged(null); return }
    let cancelled = false
    const f = Math.max(0, Math.min(displayFrame, speciesSource.frameCount - 1))
    const rebuild = () => {
      if (cancelled) return
      const clusters = clusterFromPairs(dynInfra.pairs, dynInfra.labels, source.count, MIN_REGION_ATOMS)
      const regionOf = clusters.regionOf
      if (hideMajority && clusters.regionIds.length > 1) {
        // population per label → blank out regions of the most numerous label (background)
        const pop = new Map<number, number>()
        for (let i = 0; i < source.count; i++) {
          const r = regionOf[i]
          if (r >= 0) { const l = clusters.regionLabel[r]; pop.set(l, (pop.get(l) ?? 0) + 1) }
        }
        let majority = -1, best = -1
        for (const [l, n] of pop) if (n > best) { best = n; majority = l }
        for (let i = 0; i < source.count; i++) {
          const r = regionOf[i]
          if (r >= 0 && clusters.regionLabel[r] === majority) regionOf[i] = -1
        }
      }
      // color by LABEL (not region id) so colors stay stable as clusters split/merge per frame
      const colorIdOf = (rid: number) => clusters.regionLabel[rid]
      const mesh = geometryMode === 'hull'
        ? buildRegionHulls(source.positions, regionOf, clusters.regionIds, null)
        : buildVoxelSurface(source.positions, source.count, regionOf, dynInfra.cell, colorIdOf)
      setDynMerged(mesh)
    }
    if (speciesSource.tryGetSpecies(f, dynInfra.labels)) rebuild()
    else void speciesSource.prefetch(f).then(() => { if (speciesSource.tryGetSpecies(f, dynInfra.labels)) rebuild() })
    return () => { cancelled = true }
  }, [dynInfra, speciesSource, displayFrame, geometryMode, hideMajority, source])

  const merged = dynamicActive ? dynMerged : staticMerged

  const geometry = useMemo(() => {
    if (!merged || merged.vertexCount === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(merged.colors, 3))
    g.computeVertexNormals()
    return g
  }, [merged])

  // edge overlay only for static regions — per-frame edge rebuilds cost more than they show
  const edges = useMemo(
    () => (geometry && !dynamicActive ? new THREE.EdgesGeometry(geometry, 30) : null),
    [geometry, dynamicActive],
  )

  useEffect(() => () => { geometry?.dispose(); edges?.dispose() }, [geometry, edges])

  // flow: deform solid vertices with their atoms during playback (position tracks /
  // thermal vibration); species-only trajectories keep front/back null → no-op.
  const lastVersion = useRef(-1)
  useFrame(() => {
    if (!merged || !geometry || !playback) return
    const ch = playback.current
    if (!ch.front || !ch.back || ch.version === lastVersion.current) return
    lastVersion.current = ch.version
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const { atomIndex, offsets, vertexCount } = merged
    const f = ch.front, b = ch.back, m = ch.mix
    for (let v = 0; v < vertexCount; v++) {
      const ai = atomIndex[v]
      arr[v * 3] = f[ai * 3] + (b[ai * 3] - f[ai * 3]) * m + offsets[v * 3]
      arr[v * 3 + 1] = f[ai * 3 + 1] + (b[ai * 3 + 1] - f[ai * 3 + 1]) * m + offsets[v * 3 + 1]
      arr[v * 3 + 2] = f[ai * 3 + 2] + (b[ai * 3 + 2] - f[ai * 3 + 2]) * m + offsets[v * 3 + 2]
    }
    pos.needsUpdate = true
    geometry.computeVertexNormals()
  })

  if (!showRegionSolids || !geometry) return null
  return (
    <group>
      <mesh geometry={geometry} renderOrder={1}>
        {/* high opacity = "solid" look: depth-write + front faces only, so grains
            occlude each other correctly instead of see-through blend artifacts */}
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={regionOpacity}
          roughness={0.4}
          metalness={0.1}
          side={regionOpacity > 0.5 ? THREE.FrontSide : THREE.DoubleSide}
          depthWrite={regionOpacity > 0.5}
        />
      </mesh>
      {/* static boundary edges; hidden while flowing (per-frame edge rebuild not worth it) */}
      {edges && !trajectoryActive && (
        <lineSegments geometry={edges}>
          <lineBasicMaterial color="#202024" transparent opacity={0.55} />
        </lineSegments>
      )}
    </group>
  )
}
