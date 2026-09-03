'use client'

/** Select and synchronize VESTA-style or studio materials for viewport geometry. */
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  createVestaMaterial,
  SHADING_MODE_MAP,
} from '../../../lib/render/stylized-material'
import { createStudioMaterial } from '../../../lib/render/studio-material'
import { lightDirectionFromAngles } from '../../../lib/lighting'
import { resolveStylizedLightIntensities } from '../../../lib/render/stylized-lighting'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

interface StylizedMaterialProps {
  color: string
  opacity?: number
  mode?: number
  ambient?: number
  diffuse?: number
  specularStrength?: number
  shininess?: number
  fresnel?: number
  transparent?: boolean
  side?: THREE.Side
  depthWrite?: boolean
  vertexColors?: boolean
  instanceColors?: boolean
  clipPlane?: THREE.Plane | null
  materialRef?: (material: THREE.Material | null) => void
}

export function StylizedMaterial({
  color,
  opacity = 1,
  mode,
  ambient,
  diffuse,
  specularStrength,
  shininess,
  fresnel,
  transparent = false,
  side = THREE.FrontSide,
  depthWrite = true,
  vertexColors = false,
  instanceColors = false,
  clipPlane = null,
  materialRef,
}: StylizedMaterialProps) {
  const invalidate = useThree((state) => state.invalidate)
  const renderStyle = useCrystalStore((state) => state.renderStyle)
  const atomShininess = useCrystalStore((state) => state.atomShininess)
  const ambientIntensity = useCrystalStore((state) => state.ambientIntensity)
  const diffuseIntensity = useCrystalStore((state) => state.diffuseIntensity)
  const specularIntensity = useCrystalStore((state) => state.specularIntensity)
  const rimIntensity = useCrystalStore((state) => state.rimIntensity)
  const lightAzimuth = useCrystalStore((state) => state.lightAzimuth)
  const lightElevation = useCrystalStore((state) => state.lightElevation)
  const lightAmbient = useCrystalStore((state) => state.lightAmbient)
  const lightKey = useCrystalStore((state) => state.lightKey)
  const lightFill = useCrystalStore((state) => state.lightFill)
  const headlight = useCrystalStore((state) => state.lightFollowsCamera)
  const worldLightDirection = useMemo(
    () => new THREE.Vector3(...lightDirectionFromAngles(lightAzimuth, lightElevation, 1)).normalize(),
    [lightAzimuth, lightElevation],
  )

  const isStudio = renderStyle === 'studio' && mode === undefined

  const material = useMemo(
    () => (isStudio
      ? createStudioMaterial({ color, side, vertexColors, instanceColors })
      : createVestaMaterial({ color, side, vertexColors, instanceColors })),
    [isStudio, side, vertexColors, instanceColors],
  )

  useEffect(() => {
    if (!(material instanceof THREE.ShaderMaterial)) return
    const effectiveMode = mode ?? SHADING_MODE_MAP[renderStyle]
    const usesAlpha = transparent || opacity < 1 || effectiveMode === SHADING_MODE_MAP.xray || effectiveMode === 10
    material.uniforms.uColor.value.setStyle(color, THREE.NoColorSpace)
    material.uniforms.uMode.value = effectiveMode
    const lighting = resolveStylizedLightIntensities({
      ambientIntensity, diffuseIntensity, lightAmbient, lightKey, lightFill,
    })
    // Layer overrides are the most specific presentation choice. Global light
    // controls remain the fallback, matching HyperStick's override contract.
    const fillContribution = lightFill === null ? 0 : lightFill * .18
    material.uniforms.uAmbient.value = ambient === undefined
      ? lighting.ambient
      : ambient + fillContribution
    material.uniforms.uDiffuse.value = diffuse ?? lighting.diffuse
    material.uniforms.uSpecularStrength.value = specularStrength ?? specularIntensity
    material.uniforms.uShininess.value = (shininess ?? atomShininess) * 2.8
    material.uniforms.uOpacity.value = opacity
    material.uniforms.uFresnel.value = fresnel ?? rimIntensity
    material.uniforms.uLightDir.value.copy(worldLightDirection)
    material.uniforms.uHeadlight.value = headlight ? 1 : 0
    material.clippingPlanes = clipPlane ? [clipPlane] : null
    material.transparent = usesAlpha
    material.depthWrite = depthWrite && !usesAlpha
    invalidate()
  }, [
    ambient,
    ambientIntensity,
    atomShininess,
    color,
    depthWrite,
    diffuse,
    diffuseIntensity,
    fresnel,
    headlight,
    invalidate,
    lightAmbient,
    lightFill,
    lightKey,
    material,
    mode,
    opacity,
    clipPlane,
    renderStyle,
    rimIntensity,
    shininess,
    specularIntensity,
    specularStrength,
    transparent,
    worldLightDirection,
  ])

  useEffect(() => {
    if (!(material instanceof THREE.MeshPhysicalMaterial)) return
    const usesAlpha = transparent || opacity < 1
    material.color.set(color)
    material.opacity = opacity
    material.transparent = usesAlpha
    material.depthWrite = depthWrite && !usesAlpha
    material.clippingPlanes = clipPlane ? [clipPlane] : null

    material.roughness = THREE.MathUtils.clamp(1 - (shininess ?? atomShininess) / 140, 0.05, 0.95)
    material.clearcoat = THREE.MathUtils.clamp(specularStrength ?? specularIntensity, 0, 1)
    material.envMapIntensity = THREE.MathUtils.clamp((lightAmbient ?? ambientIntensity) * 1.6, 0.15, 3)
    material.needsUpdate = true
    invalidate()
  }, [
    material, color, opacity, transparent, depthWrite, clipPlane, invalidate,
    shininess, atomShininess, specularStrength, specularIntensity,
    lightAmbient, ambientIntensity,
  ])

  useEffect(() => {
    materialRef?.(material)
    return () => materialRef?.(null)
  }, [material, materialRef])

  useEffect(() => () => material.dispose(), [material])

  return <primitive object={material} attach="material" />
}
