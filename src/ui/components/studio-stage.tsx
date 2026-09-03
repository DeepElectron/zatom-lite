/**
 * Attach one shared equirectangular studio environment and restore the previous
 * scene state on unmount. The texture lifecycle is independent of effect reruns.
 */
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { createStudioEnvironment } from '../../lib/render/studio-environment'

export function StudioStage() {
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)

  const environment = useMemo(() => createStudioEnvironment(), [])

  useEffect(() => {
    const previous = scene.environment
    scene.environment = environment
    invalidate()
    return () => {
      scene.environment = previous
      invalidate()
    }
  }, [scene, environment, invalidate])

  useEffect(() => () => environment.dispose(), [environment])

  return null
}
