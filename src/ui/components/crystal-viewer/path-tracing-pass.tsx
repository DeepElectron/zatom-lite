/**
 * Progressive path tracing for stationary studio views. It is mutually exclusive
 * with GTAO, uses tiled low-resolution interaction previews, and resets accumulation
 * whenever the camera changes.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  PATH_TRACING_BOUNCES,
  PATH_TRACING_TARGET_SAMPLES,
  disposePathTracer,
  ensurePathTracerSceneCompat,
  findPathTracingBlocker,
} from '../../../lib/render/path-tracing'

export function PathTracingPass() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  const reportStatus = useCrystalStore((s) => s.reportPathTracingStatus)

  const tracerRef = useRef<WebGLPathTracer | null>(null)
  const lastCameraMatrix = useRef<string>('')
  const buildingRef = useRef(false)

  useEffect(() => {
    const blocker = findPathTracingBlocker(scene)
    reportStatus({ blocker })
    if (blocker) return

    ensurePathTracerSceneCompat()

    const tracer = new WebGLPathTracer(gl)
    tracer.bounces = PATH_TRACING_BOUNCES
    tracer.renderScale = 0.5
    tracer.tiles.set(8, 8)
    tracer.dynamicLowRes = true
    tracer.renderToCanvas = true
    tracerRef.current = tracer
    buildingRef.current = true

    // Use the synchronous scene build; the asynchronous path requires a BVH worker.
    try {
      tracer.setScene(scene, camera)
      buildingRef.current = false
      invalidate()
    } catch (error) {
      console.warn('[zatom] Path tracer scene build failed', error)
      buildingRef.current = false
      tracerRef.current = null
      disposePathTracer(tracer)
      reportStatus({ blocker: 'scene-build-failed' })
      return
    }

    return () => {
      tracerRef.current = null
      disposePathTracer(tracer)
      reportStatus({ samples: 0 })
    }
  }, [gl, scene, camera, invalidate, reportStatus])

  useFrame(() => {
    const tracer = tracerRef.current
    if (!tracer || buildingRef.current) return

    const matrix = camera.matrixWorld.elements.join(',')
    if (matrix !== lastCameraMatrix.current) {
      lastCameraMatrix.current = matrix
      tracer.updateCamera()
    }

    tracer.renderSample()
    reportStatus({ samples: tracer.samples })

    if (tracer.samples < PATH_TRACING_TARGET_SAMPLES) invalidate()
  }, 1)

  return null
}
