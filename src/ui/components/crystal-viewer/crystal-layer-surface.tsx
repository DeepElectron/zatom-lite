import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import {
  buildBioSurfaceGeometryFromJob,
  type BioSurfaceMeshData,
  type BioSurfaceWorkerJob,
} from '../../../lib/biomolecule/surface-geometry'
import type {
  BioSurfaceWorkerRequest,
  BioSurfaceWorkerResponse,
} from '../../../lib/biomolecule/surface-worker-types'
import type { Atom } from '../../../lib/crystal/types'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import type { LayerRenderOverride } from './layer-render-override'
import { StylizedMaterial } from './stylized-material'

const CRYSTAL_LAYER_SURFACE_SPACING = .6

/** Build the bounded worker payload shared by the browser and deterministic tests. */
export function createCrystalLayerSurfaceJob(
  atoms: readonly Atom[],
  selectedAtomIds: ReadonlySet<string>,
  colorByAtomId: ReadonlyMap<string, string> | undefined,
  elementColors: Readonly<Record<string, string>>,
): BioSurfaceWorkerJob | null {
  const selected = atoms.filter((atom) => selectedAtomIds.has(atom.id) && atom.cartesian)
  if (selected.length === 0) return null
  const positions = new Float32Array(selected.length * 3)
  const elements = new Array<string>(selected.length)
  const colors = new Array<string>(selected.length)
  const center: [number, number, number] = [0, 0, 0]
  selected.forEach((atom, index) => {
    const position = atom.cartesian!
    const offset = index * 3
    positions[offset] = position[0]
    positions[offset + 1] = position[1]
    positions[offset + 2] = position[2]
    elements[index] = atom.element
    colors[index] = colorByAtomId?.get(atom.id)
      ?? elementColors[atom.element]
      ?? getDefaultCrystalElementVisual(atom.element).color
    center[0] += position[0]
    center[1] += position[1]
    center[2] += position[2]
  })
  center[0] /= selected.length
  center[1] /= selected.length
  center[2] /= selected.length
  return { positions, elements, colors, spacing: CRYSTAL_LAYER_SURFACE_SPACING, center }
}

/** QuickSurf-style selected-atom surface, generated off the UI thread in browsers. */
export function CrystalLayerSurface({
  atoms,
  selectedAtomIds,
  opacity,
  renderOverride,
}: {
  atoms: readonly Atom[]
  selectedAtomIds: ReadonlySet<string>
  opacity: number
  renderOverride: LayerRenderOverride
}) {
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const elementColors = useMemo(
    () => Object.fromEntries(Object.entries(elementOverrides).map(([element, visual]) => [element, visual.color])),
    [elementOverrides],
  )
  const job = useMemo(() => createCrystalLayerSurfaceJob(
    atoms,
    selectedAtomIds,
    renderOverride.colorByAtomId,
    elementColors,
  ), [atoms, elementColors, renderOverride.colorByAtomId, selectedAtomIds])
  const workerRef = useRef<Worker | null>(null)
  const requestSequence = useRef(0)
  const latestRequest = useRef<string | null>(null)
  const [mesh, setMesh] = useState<BioSurfaceMeshData | null>(null)

  useEffect(() => () => workerRef.current?.terminate(), [])
  useEffect(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setMesh(null)
    if (!job) {
      latestRequest.current = null
      return
    }
    const requestId = `crystal-layer-surface:${++requestSequence.current}`
    latestRequest.current = requestId
    if (typeof Worker === 'undefined') {
      setMesh(buildBioSurfaceGeometryFromJob(job))
      return
    }
    const worker = new Worker(
      new URL('../../../lib/biomolecule/surface.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    let disposed = false
    const handleMessage = (event: MessageEvent<BioSurfaceWorkerResponse>) => {
      if (disposed || event.data.requestId !== latestRequest.current) return
      if (event.data.error) console.error('Crystal layer surface worker failed', event.data.error)
      setMesh(event.data.error ? null : event.data.result)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    const handleError = (event: ErrorEvent) => {
      if (disposed || requestId !== latestRequest.current) return
      console.error('Crystal layer surface worker failed', event.message)
      setMesh(null)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    const request: BioSurfaceWorkerRequest = { requestId, job }
    worker.postMessage(request)
    return () => {
      disposed = true
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      if (workerRef.current === worker) {
        worker.terminate()
        workerRef.current = null
      }
    }
  }, [job])

  const geometry = useMemo(() => {
    if (!mesh) return null
    const value = new THREE.BufferGeometry()
    value.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    value.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
    value.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
    value.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    return value
  }, [mesh])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return <mesh geometry={geometry} renderOrder={10} raycast={() => {}}>
    <StylizedMaterial
      color="#ffffff"
      vertexColors
      side={THREE.DoubleSide}
      opacity={opacity}
      transparent={opacity < .999}
      depthWrite={opacity >= .999}
      mode={renderOverride.mode}
      ambient={renderOverride.ambient}
      diffuse={renderOverride.diffuse}
      specularStrength={renderOverride.specularStrength}
      shininess={renderOverride.shininess}
      fresnel={renderOverride.fresnel}
    />
  </mesh>
}
