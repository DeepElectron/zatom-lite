/**
 * GTAO contact shading for rasterized molecular surfaces. Projection defines are
 * corrected for orthographic cameras, and non-surface overlays are excluded only
 * from GTAO's depth/normal prepass so they remain visible in the beauty pass.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, NoToneMapping, type Object3D, type Scene } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import type { RenderStyle } from '../../../lib/render/crystal-visuals'

function applyCameraProjectionDefine(pass: GTAOPass, isPerspective: boolean): void {
  const material = pass.gtaoMaterial
  const wanted = isPerspective ? 1 : 0
  if (material.defines.PERSPECTIVE_CAMERA === wanted) return
  material.defines.PERSPECTIVE_CAMERA = wanted
  material.needsUpdate = true
}

function isNonSurfaceObject(object: Object3D): boolean {
  const probe = object as Object3D & {
    isSprite?: boolean
    isLine?: boolean
    isLine2?: boolean
    isLineSegments2?: boolean
    isPoints?: boolean
  }
  return Boolean(
    probe.isSprite || probe.isLine || probe.isLine2 || probe.isLineSegments2 || probe.isPoints,
  )
}

export function excludeNonSurfacesFromOcclusion(
  pass: Pick<GTAOPass, 'render'>,
  scene: Scene,
): void {
  const renderWithSurfacesOnly = pass.render.bind(pass)
  pass.render = (...args: Parameters<GTAOPass['render']>) => {
    const hidden: Object3D[] = []
    scene.traverseVisible((object) => {
      if (isNonSurfaceObject(object)) hidden.push(object)
    })
    for (const object of hidden) object.visible = false
    try {
      renderWithSurfacesOnly(...args)
    } finally {
      for (const object of hidden) object.visible = true
    }
  }
}

export function AmbientOcclusionPass() {
  const intensity = useCrystalStore((s) => s.lightAmbientOcclusion)
  const renderStyle = useCrystalStore((s) => s.renderStyle)
  if (!(intensity > 0)) return null
  return <AmbientOcclusionComposer intensity={intensity} renderStyle={renderStyle} />
}

function AmbientOcclusionComposer({
  intensity,
  renderStyle,
}: {
  intensity: number
  renderStyle: RenderStyle
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const composer = useMemo(() => {
    const instance = new EffectComposer(gl)
    instance.addPass(new RenderPass(scene, camera))
    const gtao = new GTAOPass(scene, camera, size.width, size.height)
    gtao.updateGtaoMaterial({ screenSpaceRadius: true, radius: 18, scale: 1, thickness: 1 })
    excludeNonSurfacesFromOcclusion(gtao, scene)
    instance.addPass(gtao)
    // OutputPass performs the render-target color-space conversion. Tone mapping
    // is scoped around render below because OutputPass reads the renderer each frame.
    instance.addPass(new OutputPass())
    return { instance, gtao }
  }, [gl, scene, camera, size.width, size.height])

  useEffect(() => () => {
    composer.gtao.dispose()
    composer.instance.dispose()
  }, [composer])

  // The adaptive controller lowers the renderer's pixel ratio during drags and
  // camera flights. The composer owns its own render targets, so it has to be
  // told: otherwise GTAO — the most expensive pass on a large scene — keeps
  // running at full resolution and the degradation buys nothing.
  const adaptiveDpr = useCrystalStore((s) => s.adaptivePerformanceDpr)
  useEffect(() => {
    composer.instance.setPixelRatio(gl.getPixelRatio())
    composer.instance.setSize(size.width, size.height)
  }, [adaptiveDpr, composer, gl, size.width, size.height])


  useEffect(() => {
    composer.gtao.blendIntensity = intensity
    applyCameraProjectionDefine(composer.gtao, Boolean((camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera))
  }, [composer, intensity, camera])

  useFrame(() => {
    // Preserve analytical colors, but retain ACES highlight rolloff for studio HDR.
    const previousToneMapping = gl.toneMapping
    gl.toneMapping = renderStyle === 'studio' ? ACESFilmicToneMapping : NoToneMapping
    try {
      composer.instance.render()
    } finally {
      gl.toneMapping = previousToneMapping
    }
  }, 1)

  return null
}
