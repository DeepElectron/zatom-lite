'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { generateOrbitalSurface } from '../../../lib/molecular-orbitals/orbital-surface-generator'
import type { MarchingCubesResult } from '../../../lib/molecular-orbitals/OptimizedMarchingCubes'
import { CubParser } from '../../../lib/molecular-orbitals/CubParser'
import {
  mapValuesToColors,
  sampleFieldAtVertices,
  symmetricRange,
  type ColorRange,
} from '../../../lib/molecular-orbitals/surface-coloring'
import { findSurfaceExtrema } from '../../../lib/molecular-orbitals/surface-extrema'
import type { SurfaceColorStats } from '../../../lib/molecular-orbitals/state'
import { isCubeFieldSliceSampleReady } from '../../../lib/molecular-orbitals/cube-field-slice'

function concatFloat32(parts: readonly Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
import type {
  OrbitalSurfaceJob,
  OrbitalSurfaceResult,
  OrbitalSurfaceWorkerRequest,
  OrbitalSurfaceWorkerResponse,
  SerializedGaussianBasisFunction,
} from '../../../lib/molecular-orbitals/orbital-surface-worker-types'

function createGeometry(result: MarchingCubesResult) {
  if (result.vertices.length === 0 || result.faces.length === 0) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(result.vertices, 3))
  geometry.setIndex(new THREE.BufferAttribute(result.faces, 1))

  if (result.normals.length === result.vertices.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  return geometry
}

export function MolecularOrbitalLayer() {
  const periodic = useCrystalStore((state) => state.periodic)
  const atoms = useCrystalStore((state) => state.atoms)
  const sourceType = useCrystalStore((state) => state.molecularOrbital.sourceType)
  const cubData = useCrystalStore((state) => state.molecularOrbital.cubData)
  const moldenData = useCrystalStore((state) => state.molecularOrbital.moldenData)
  const selectedOrbitalIndex = useCrystalStore((state) => state.molecularOrbital.selectedOrbitalIndex)
  const isoValue = useCrystalStore((state) => state.molecularOrbital.isoValue)
  const resolution = useCrystalStore((state) => state.molecularOrbital.resolution)
  const orbitalOpacity = useCrystalStore((state) => state.molecularOrbital.opacity)
  const positiveColor = useCrystalStore((state) => state.molecularOrbital.positiveColor)
  const negativeColor = useCrystalStore((state) => state.molecularOrbital.negativeColor)
  const visible = useCrystalStore((state) => state.molecularOrbital.visible)
  const colorField = useCrystalStore((state) => state.molecularOrbital.colorField)
  const fieldSlice = useCrystalStore((state) => state.molecularOrbital.fieldSlice)
  const fieldSliceSample = useCrystalStore((state) => state.molecularOrbital.fieldSliceSample)
  const constructedPlane = useCrystalStore((state) => state.constructedPlane)
  const setSurfaceColorStats = useCrystalStore((state) => state.setSurfaceColorStats)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const focusedAtomIds = useCrystalStore((state) => state.focusedAtomIds)
  const focusedAtomOpacity = useCrystalStore((state) => state.focusedAtomOpacity)
  const workerRef = useRef<Worker | null>(null)
  const latestRequestIdRef = useRef<string | null>(null)
  const [surfaceResult, setSurfaceResult] = useState<OrbitalSurfaceResult | null>(null)

  // Keep scientific geometry stable through direct camera manipulation.
  // OrbitControls toggles a transient performance flag on pointer-down/up, but
  // changing this sampling resolution at those boundaries rebuilds the surface;
  // fixed smoothing then contracts the coarse mesh and makes it visibly shrink.
  // Interaction performance may reduce DPR, never the world-space isosurface.
  const surfaceJob = useMemo<OrbitalSurfaceJob | null>(() => {
    if (periodic || !sourceType || !visible) {
      return null
    }

    if (sourceType === 'cub' && cubData) {
      return {
        sourceType: 'cub',
        cubData,
        resolution,
        isoValue,
      }
    }

    if (sourceType === 'molden' && moldenData) {
      const orbital = moldenData.orbitals[selectedOrbitalIndex]
      if (!orbital) {
        return null
      }

      const atomPositions = atoms
        .map((atom) => atom.cartesian)
        .filter((position): position is [number, number, number] => Boolean(position))

      const fallbackPositions = moldenData.atoms.map(
        (atom) => [atom.x, atom.y, atom.z] as [number, number, number],
      )

      return {
        sourceType: 'molden',
        atomPositions,
        fallbackPositions,
        orbitalCoefficients: orbital.coefficients,
        gtos: moldenData.gtos.map<SerializedGaussianBasisFunction>((gto) => ({
          center: gto.center,
          exponents: [...gto.exponents],
          coefficients: [...gto.coefficients],
          l: gto.l,
          m: gto.m,
          n: gto.n,
        })),
        resolution,
        isoValue,
      }
    }

    return null
  }, [atoms, periodic, cubData, isoValue, moldenData, resolution, selectedOrbitalIndex, sourceType, visible])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!surfaceJob) {
      setSurfaceResult(null)
      return
    }

    const requestId = [
      surfaceJob.sourceType,
      selectedOrbitalIndex,
      resolution,
      isoValue.toFixed(6),
      Date.now().toString(36),
    ].join(':')
    latestRequestIdRef.current = requestId

    if (typeof Worker === 'undefined') {
      try {
        setSurfaceResult(generateOrbitalSurface(surfaceJob))
      } catch (error) {
        console.error('Failed to generate orbital surface on main thread', error)
        setSurfaceResult(null)
      }
      return
    }

    const worker =
      workerRef.current
      ?? new Worker(
        new URL('../../../lib/molecular-orbitals/orbital-surface.worker.ts', import.meta.url),
        { type: 'module' },
      )
    workerRef.current = worker

    let disposed = false

    const handleMessage = (event: MessageEvent<OrbitalSurfaceWorkerResponse>) => {
      if (disposed || event.data.requestId !== latestRequestIdRef.current) {
        return
      }

      if (event.data.error) {
        console.error('Orbital surface worker failed', event.data.error)
        try {
          setSurfaceResult(generateOrbitalSurface(surfaceJob))
        } catch (fallbackError) {
          console.error('Failed to generate orbital surface on fallback path', fallbackError)
          setSurfaceResult(null)
        }
        return
      }

      setSurfaceResult(event.data.result)
    }

    const handleError = () => {
      if (disposed) {
        return
      }

      try {
        setSurfaceResult(generateOrbitalSurface(surfaceJob))
      } catch (fallbackError) {
        console.error('Failed to generate orbital surface on worker error fallback', fallbackError)
        setSurfaceResult(null)
      }
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)

    const request: OrbitalSurfaceWorkerRequest = {
      requestId,
      job: surfaceJob,
    }
    worker.postMessage(request)

    return () => {
      disposed = true
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
    }
  }, [isoValue, resolution, selectedOrbitalIndex, surfaceJob])

  const geometries = useMemo(() => {
    if (!surfaceResult) {
      return {
        positive: null as THREE.BufferGeometry | null,
        negative: null as THREE.BufferGeometry | null,
        stats: null as SurfaceColorStats | null,
      }
    }

    const positive = surfaceResult.positive ? createGeometry(surfaceResult.positive) : null
    const negative = surfaceResult.negative ? createGeometry(surfaceResult.negative) : null
    let stats: SurfaceColorStats | null = null

    if (colorField) {
      // Both lobes share one value range so equal field values map to equal colors.
      const sampler = new CubParser().createVolumeFunction(colorField.cubData)
      const parts = [positive, negative].filter((g): g is THREE.BufferGeometry => g !== null)
      const verts = parts.map((g) => g.getAttribute('position').array as Float32Array)
      const samples = verts.map((v) => sampleFieldAtVertices(v, sampler))
      const sampled: ColorRange = samples.reduce(
        (acc, s) => ({ min: Math.min(acc.min, s.sampled.min), max: Math.max(acc.max, s.sampled.max) }),
        { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      )
      const range = colorField.range ?? symmetricRange(sampled)
      parts.forEach((g, i) => {
        g.setAttribute('color', new THREE.BufferAttribute(mapValuesToColors(samples[i].values, colorField.colormap, range), 3))
      })
      // Detect extrema after combining lobes to avoid reporting one maximum per lobe.
      const allVerts = concatFloat32(verts)
      const allValues = concatFloat32(samples.map((s) => s.values))
      stats = { range, sampled, extrema: findSurfaceExtrema(allVerts, allValues) }
    }

    return { positive, negative, stats }
  }, [surfaceResult, colorField])

  // The external color bar and in-scene extrema markers consume the same statistics.
  useEffect(() => {
    return () => {
      geometries.positive?.dispose()
      geometries.negative?.dispose()
    }
  }, [geometries])

  useEffect(() => {
    setSurfaceColorStats(geometries.stats)
  }, [geometries.stats, setSurfaceColorStats])

  const hasFocusLikeState = focusedAtomIds.size > 0 || selectedAtomIds.size > 0
  const effectiveOpacity = hasFocusLikeState
    ? THREE.MathUtils.lerp(0.02, orbitalOpacity, focusedAtomOpacity)
    : orbitalOpacity

  // Vertex colors carry the complete field palette; a white base avoids tinting.
  const fieldColored = colorField !== null
  const hideSurfaceForSlice = fieldColored
    && fieldSlice.enabled
    && fieldSlice.mode === 'slice-only'
    && isCubeFieldSliceSampleReady(fieldSliceSample, constructedPlane?.id, colorField?.cubData)
  const positiveEmissive = useMemo(
    () => (fieldColored ? new THREE.Color(0x000000) : new THREE.Color(positiveColor).multiplyScalar(0.18)),
    [positiveColor, fieldColored],
  )
  const negativeEmissive = useMemo(
    () => (fieldColored ? new THREE.Color(0x000000) : new THREE.Color(negativeColor).multiplyScalar(0.18)),
    [negativeColor, fieldColored],
  )
  const materialVersion = [
    fieldColored ? 'field' : 'lobe',
    positiveColor,
    negativeColor,
    effectiveOpacity.toFixed(3),
    focusedAtomOpacity.toFixed(3),
    selectedAtomIds.size,
    focusedAtomIds.size,
  ].join(':')

  if (!geometries.positive && !geometries.negative) {
    return null
  }

  return (
    <group renderOrder={20} visible={!hideSurfaceForSlice}>
      {geometries.positive && (
        <mesh geometry={geometries.positive}>
          <meshStandardMaterial
            key={`positive:${materialVersion}`}
            color={fieldColored ? '#ffffff' : positiveColor}
            vertexColors={fieldColored}
            transparent
            opacity={effectiveOpacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            roughness={0.24}
            metalness={0.08}
            emissive={positiveEmissive}
            emissiveIntensity={fieldColored ? 0 : 0.85}
          />
        </mesh>
      )}
      {geometries.negative && (
        <mesh geometry={geometries.negative}>
          <meshStandardMaterial
            key={`negative:${materialVersion}`}
            color={fieldColored ? '#ffffff' : negativeColor}
            vertexColors={fieldColored}
            transparent
            opacity={effectiveOpacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            roughness={0.24}
            metalness={0.08}
            emissive={negativeEmissive}
            emissiveIntensity={fieldColored ? 0 : 0.85}
          />
        </mesh>
      )}
    </group>
  )
}
