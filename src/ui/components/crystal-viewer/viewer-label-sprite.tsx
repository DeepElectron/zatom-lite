import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

export interface ViewerLabelItem {
  text: string
  position: [number, number, number]
  scale?: number
  color: string
  bold?: boolean
}

function useViewerLabelResource({
  text,
  color,
  bold,
  outline,
  outlineColor,
}: {
  text: string
  color: string
  bold: boolean
  outline: boolean
  outlineColor: string
}) {
  const resource = useMemo(() => {
    const fontPixels = 96
    const padding = 24
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null
    const font = `${bold ? 700 : 500} ${fontPixels}px ui-sans-serif, system-ui, sans-serif`
    context.font = font
    const width = Math.ceil(context.measureText(text).width) + padding * 2
    const height = fontPixels + padding * 2
    canvas.width = width
    canvas.height = height
    context.font = font
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.strokeStyle = outlineColor
    context.lineWidth = fontPixels * .18
    if (outline) context.strokeText(text, width / 2, height / 2)
    context.fillStyle = color
    context.fillText(text, width / 2, height / 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    })
    return { texture, material, aspect: width / height }
  }, [bold, color, outline, outlineColor, text])

  useEffect(() => () => {
    resource?.texture.dispose()
    resource?.material.dispose()
  }, [resource])

  return resource
}

export function ViewerLabelSprite({
  item,
  baseSize,
  outlineColor,
  outline = true,
}: {
  item: ViewerLabelItem
  baseSize: number
  outlineColor: string
  outline?: boolean
}) {
  const resource = useViewerLabelResource({
    text: item.text,
    color: item.color,
    bold: Boolean(item.bold),
    outline,
    outlineColor,
  })
  if (!resource) return null
  const height = baseSize * (item.scale ?? 1)
  return (
    <sprite
      position={item.position}
      scale={[height * resource.aspect, height, 1]}
      material={resource.material}
      raycast={() => undefined}
      renderOrder={30}
    />
  )
}

export function ViewerLabelSpriteGroup({
  text,
  positions,
  baseSize,
  color,
  outlineColor,
  bold = true,
  outline = true,
}: {
  text: string
  positions: readonly [number, number, number][]
  baseSize: number
  color: string
  outlineColor: string
  bold?: boolean
  outline?: boolean
}) {
  const resource = useViewerLabelResource({ text, color, bold, outline, outlineColor })
  if (!resource) return null
  return <>{positions.map((position, index) => (
    <sprite
      key={index}
      position={position}
      scale={[baseSize * resource.aspect, baseSize, 1]}
      material={resource.material}
      raycast={() => undefined}
      renderOrder={30}
    />
  ))}</>
}
