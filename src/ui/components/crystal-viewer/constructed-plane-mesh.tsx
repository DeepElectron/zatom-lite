"use client"

/** Render a constructed plane, outline, source-point highlights, and optional field slice. */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  createCubePlaneBasis,
  cubeFieldRange,
  rasterizeCubeFieldPlane,
  sampleCubeFieldOnPlane,
  type CubeFieldSliceFailureReason,
  type CubePlaneFrame,
} from '../../../lib/molecular-orbitals/cube-field-slice'
import { symmetricRange, type ColorRange } from '../../../lib/molecular-orbitals/surface-coloring'

function roundedPlaneShape(size: number) {
  const shape = new THREE.Shape()
  const radius = size * 0.12
  shape.moveTo(-size + radius, -size)
  shape.lineTo(size - radius, -size)
  shape.absarc(size - radius, -size + radius, radius, -Math.PI / 2, 0, false)
  shape.lineTo(size, size - radius)
  shape.absarc(size - radius, size - radius, radius, 0, Math.PI / 2, false)
  shape.lineTo(-size + radius, size)
  shape.absarc(-size + radius, size - radius, radius, Math.PI / 2, Math.PI, false)
  shape.lineTo(-size, -size + radius)
  shape.absarc(-size + radius, -size + radius, radius, Math.PI, Math.PI * 1.5, false)
  return shape
}

function createSliceTexture(data: Uint8Array<ArrayBuffer>, width: number, height: number) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function ConstructedPlaneMesh() {
  const constructedPlane = useCrystalStore(s => s.constructedPlane)
  const colorField = useCrystalStore(s => s.molecularOrbital.colorField)
  const colorStats = useCrystalStore(s => s.molecularOrbital.colorFieldStats)
  const fieldSlice = useCrystalStore(s => s.molecularOrbital.fieldSlice)
  const setFieldSliceSample = useCrystalStore(s => s.setFieldSliceSample)

  const { fillGeo, outlineGeo, planeFrame } = useMemo(() => {
    if (!constructedPlane) return { fillGeo: null, outlineGeo: null, planeFrame: null }

    const { normal, center, localRadius } = constructedPlane
    const size = localRadius ?? 15
    const frame: CubePlaneFrame = {
      center: { x: center[0], y: center[1], z: center[2] },
      normal: { x: normal[0], y: normal[1], z: normal[2] },
      radius: size,
    }
    const basisVectors = createCubePlaneBasis(frame.normal)
    if (!basisVectors) return { fillGeo: null, outlineGeo: null, planeFrame: null }

    const shape = roundedPlaneShape(size)

    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(basisVectors.u.x, basisVectors.u.y, basisVectors.u.z),
      new THREE.Vector3(basisVectors.v.x, basisVectors.v.y, basisVectors.v.z),
      new THREE.Vector3(basisVectors.normal.x, basisVectors.normal.y, basisVectors.normal.z),
    )
    basis.setPosition(new THREE.Vector3(...center))

    const fill = new THREE.ShapeGeometry(shape, 16)
    const positions = fill.getAttribute('position')
    const uv = new Float32Array(positions.count * 2)
    for (let index = 0; index < positions.count; index++) {
      uv[index * 2] = (positions.getX(index) + size) / (size * 2)
      uv[index * 2 + 1] = (positions.getY(index) + size) / (size * 2)
    }
    fill.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    fill.applyMatrix4(basis)

    const outlinePts = shape.getPoints(48).map(p => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(basis))
    const outline = new THREE.BufferGeometry().setFromPoints(outlinePts)

    return { fillGeo: fill, outlineGeo: outline, planeFrame: frame }
  }, [constructedPlane])

  const sliceCube = colorField?.cubData ?? null
  const sliceColormap = colorField?.colormap ?? null
  const manualRange = colorField?.range ?? null
  const surfaceRange = colorStats?.range ?? null

  // Sampling is the expensive geometric step. Presentation controls such as
  // opacity and contours must not repeat 128² trilinear lookups.
  const sampleResult = useMemo(() => {
    if (!planeFrame || !fieldSlice.enabled || !sliceCube) {
      return { sampled: null, failureReason: null as CubeFieldSliceFailureReason | null }
    }
    try {
      const sampled = sampleCubeFieldOnPlane(sliceCube, planeFrame)
      return {
        sampled,
        failureReason: sampled ? null : 'no-valid-samples' as CubeFieldSliceFailureReason,
      }
    } catch (error) {
      console.error('Failed to sample cube field on the reference plane', error)
      return { sampled: null, failureReason: 'sampling-failed' as CubeFieldSliceFailureReason }
    }
  }, [fieldSlice.enabled, planeFrame, sliceCube])

  // Use the same explicit/surface range when available. The full-volume
  // fallback is cached by volumeData, so an 8M-voxel Cube is scanned once.
  const sliceRange = useMemo<ColorRange | null>(() => {
    if (!fieldSlice.enabled || !sampleResult.sampled || !sliceCube) return null
    return manualRange ?? surfaceRange ?? symmetricRange(cubeFieldRange(sliceCube))
  }, [fieldSlice.enabled, manualRange, sampleResult.sampled, sliceCube, surfaceRange])

  const rasterResult = useMemo(() => {
    if (!sampleResult.sampled || !sliceColormap || !sliceRange) {
      return { rgba: null, failureReason: sampleResult.failureReason }
    }
    try {
      return {
        rgba: rasterizeCubeFieldPlane(
          sampleResult.sampled,
          sliceColormap,
          sliceRange,
          fieldSlice.contours,
        ),
        failureReason: null,
      }
    } catch (error) {
      console.error('Failed to rasterize cube field on the reference plane', error)
      return { rgba: null, failureReason: 'render-failed' as CubeFieldSliceFailureReason }
    }
  }, [fieldSlice.contours, sampleResult, sliceColormap, sliceRange])

  const textureResult = useMemo(() => {
    if (!rasterResult.rgba || !sampleResult.sampled) {
      return { texture: null, failureReason: rasterResult.failureReason }
    }
    try {
      return {
        texture: createSliceTexture(
          rasterResult.rgba,
          sampleResult.sampled.width,
          sampleResult.sampled.height,
        ),
        failureReason: null,
      }
    } catch (error) {
      console.error('Failed to create the reference-plane field texture', error)
      return { texture: null, failureReason: 'render-failed' as CubeFieldSliceFailureReason }
    }
  }, [rasterResult, sampleResult.sampled])
  const heatmapTexture = textureResult.texture

  useEffect(() => {
    const active = fieldSlice.enabled && Boolean(constructedPlane) && Boolean(sliceCube)
    const validFraction = sampleResult.sampled
      ? sampleResult.sampled.validCount / sampleResult.sampled.valid.length
      : 0
    setFieldSliceSample({
      phase: !active ? 'inactive' : heatmapTexture ? 'ready' : 'unavailable',
      planeId: active ? constructedPlane?.id ?? null : null,
      volumeData: active ? sliceCube?.volumeData ?? null : null,
      validFraction,
      failureReason: active && !heatmapTexture
        ? textureResult.failureReason ?? sampleResult.failureReason ?? 'sampling-failed'
        : null,
    })
  }, [
    constructedPlane,
    fieldSlice.enabled,
    heatmapTexture,
    sampleResult.failureReason,
    sampleResult.sampled,
    setFieldSliceSample,
    sliceCube,
    textureResult.failureReason,
  ])

  useEffect(() => () => {
    fillGeo?.dispose()
    outlineGeo?.dispose()
  }, [fillGeo, outlineGeo])
  useEffect(() => () => heatmapTexture?.dispose(), [heatmapTexture])

  if (!constructedPlane || !fillGeo || !outlineGeo) return null

  const { points } = constructedPlane

  return (
    <group>
      <mesh geometry={fillGeo} renderOrder={19}>
        <meshBasicMaterial
          color={heatmapTexture ? '#FFFFFF' : '#0A84FF'}
          map={heatmapTexture ?? undefined}
          transparent
          opacity={heatmapTexture ? (fieldSlice.mode === 'slice-only' ? 1 : fieldSlice.opacity) : 0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
          alphaTest={heatmapTexture ? 0.01 : 0}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          toneMapped={false}
        />
      </mesh>

      <lineLoop geometry={outlineGeo} renderOrder={20}>
        <lineBasicMaterial color="#0A84FF" transparent opacity={0.45} toneMapped={false} />
      </lineLoop>

      {points.map((p, i) => (
        <mesh key={`src-${i}`} position={p}>
          <sphereGeometry args={[0.9, 32, 24]} />
          <meshBasicMaterial color="#FF9F0A" transparent opacity={0.3} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
