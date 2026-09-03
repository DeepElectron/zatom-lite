/**
 * Shared three-point rig for crystal and assembly viewports. A camera-following
 * key light updates directly in the frame loop without React or store churn.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { fillFromKey, lightDirectionFromAngles } from '../../lib/lighting'
import type { ViewportLighting } from '../../lib/lighting'
import {
  computeSceneBounds,
  fitDirectionalShadow,
  releaseDirectionalShadow,
  sceneGeometryFingerprint,
} from '../../lib/render/studio-shadows'

export function ViewportLights({
  lighting,
  azimuth,
  elevation,
  followCamera,
  castShadows = false,
}: {
  lighting: ViewportLighting
  azimuth: number | null
  elevation: number | null
  followCamera: boolean
  castShadows?: boolean
}) {
  const keyRef = useRef<THREE.DirectionalLight>(null)
  const fillRef = useRef<THREE.DirectionalLight>(null)
  const fittedFingerprint = useRef(-1)

  const keyPos = lightDirectionFromAngles(azimuth, elevation)
  const fillPos = fillFromKey(keyPos)

  useEffect(() => {
    const key = keyRef.current
    if (!key || castShadows) return
    releaseDirectionalShadow(key)
    fittedFingerprint.current = -1
  }, [castShadows])

  useFrame(({ camera, scene }) => {
    const key = keyRef.current
    const fill = fillRef.current
    if (!key || !fill) return
    if (followCamera) {
      key.position.setFromMatrixPosition(camera.matrixWorld)
      fill.position.set(-key.position.x, -key.position.y, -key.position.z)
    } else if (key.position.x !== keyPos[0] || key.position.y !== keyPos[1] || key.position.z !== keyPos[2]) {
      key.position.set(...keyPos)
      fill.position.set(...fillPos)
    }

    if (!castShadows) return
    const fingerprint = sceneGeometryFingerprint(scene)
    if (fingerprint === fittedFingerprint.current) return
    const bounds = computeSceneBounds(scene)
    if (!bounds) return
    fitDirectionalShadow(key, bounds)
    fittedFingerprint.current = fingerprint
  })

  return (
    <>
      <ambientLight intensity={lighting.ambient} />
      <directionalLight ref={keyRef} intensity={lighting.key} position={keyPos} />
      <directionalLight ref={fillRef} intensity={lighting.fill} position={fillPos} />
    </>
  )
}
