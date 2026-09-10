/**
 * GTAO contact shading for rasterized molecular surfaces. Projection defines are
 * corrected for orthographic cameras, and non-surface overlays are excluded only
 * from GTAO's depth/normal prepass so they remain visible in the beauty pass.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, NoToneMapping, Color, type Material, type Mesh, type Object3D, type Scene } from 'three'
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
  const material = (object as Mesh).material
  const materials = Array.isArray(material) ? material : material ? [material] : []
  // Invisible picking meshes and translucent overlays must not become opaque
  // occluders when the normal pass replaces their materials.
  if (materials.length && materials.every((m) => !m.visible || m.opacity <= 0 || !m.depthWrite)) return true

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

/** Preserve procedural surfaces in the normal pass instead of drawing their proxy boxes. */
export function withOcclusionMaterials(scene: Scene, normalMaterial: Material, render: () => void): void {
  const saved: Array<[Mesh, Material | Material[]]> = []
  const override = scene.overrideMaterial
  scene.traverseVisible((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) saved.push([mesh, mesh.material])
  })
  try {
    scene.overrideMaterial = null
    for (const [mesh] of saved) mesh.material = mesh.userData.occlusionNormalMaterial ?? normalMaterial
    render()
  } finally {
    for (const [mesh, material] of saved) mesh.material = material
    scene.overrideMaterial = override
  }
}

function configureSurfaceNormals(pass: GTAOPass, scene: Scene): void {
  pass.renderOverride = (renderer, normalMaterial, target, clearColor, clearAlpha) => {
    const previousColor = renderer.getClearColor(new Color())
    const previousAlpha = renderer.getClearAlpha()
    const previousAutoClear = renderer.autoClear
    const previousTarget = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(target)
      renderer.autoClear = false
      renderer.setClearColor(clearColor ?? 0x7777ff, clearAlpha ?? 1)
      renderer.clear()
      withOcclusionMaterials(scene, normalMaterial, () => renderer.render(scene, pass.camera))
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.autoClear = previousAutoClear
      renderer.setClearColor(previousColor, previousAlpha)
    }
  }
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
    configureSurfaceNormals(gtao, scene)
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
