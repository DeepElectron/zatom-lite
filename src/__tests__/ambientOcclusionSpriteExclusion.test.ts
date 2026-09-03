/**
 * Guard against a dark tilted plate appearing only when ambient occlusion is enabled.
 *
 * GTAOPass renders depth and normals with scene.overrideMaterial. Line2 and Sprite geometry depends
 * on material vertex shaders, so overriding them exposes their raw template quads as false occluders.
 *
 * Non-surface overlays must be hidden during the prepass, real surfaces must remain, and original
 * visibility must be restored afterward even when rendering throws.
 */

import { describe, expect, it } from 'vitest'
import { Mesh, Points, Scene, Sprite } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { excludeNonSurfacesFromOcclusion } from '../ui/components/crystal-viewer/ambient-occlusion-pass'

function fatLine(): Line2 {
  const geometry = new LineGeometry()
  geometry.setPositions([0, 0, 0, 1, 1, 1])
  return new Line2(geometry, new LineMaterial({ linewidth: 1.2 }))
}

/** Build a scene containing a fat line, sprite, points, and a real surface. */
function sceneWithOverlays() {
  const scene = new Scene()
  const line = fatLine()
  const sprite = new Sprite()
  const points = new Points()
  const mesh = new Mesh()
  scene.add(line, sprite, points, mesh)
  return { scene, line, sprite, points, mesh }
}

describe('GTAO 预渲染只让真实曲面参与遮蔽', () => {
  it('粗线继承自 Mesh,所以必须显式排除', () => {
    // Fat lines inherit from Mesh, so filtering only by isMesh cannot exclude them.
    expect((fatLine() as unknown as { isMesh?: boolean }).isMesh).toBe(true)
  })

  it('预渲染期间隐藏粗线/Sprite/点云,保留真实曲面', () => {
    const { scene, line, sprite, points, mesh } = sceneWithOverlays()
    const seen: Record<string, boolean> = {}

    const pass = {
      render: () => {
        seen.line = line.visible
        seen.sprite = sprite.visible
        seen.points = points.visible
        seen.mesh = mesh.visible
      },
    }
    excludeNonSurfacesFromOcclusion(pass, scene)
    pass.render()

    // Fat lines, sprites, and points do not contribute false occlusion.
    expect(seen.line).toBe(false)
    expect(seen.sprite).toBe(false)
    expect(seen.points).toBe(false)
    // Real surfaces still participate so ambient occlusion remains effective.
    expect(seen.mesh).toBe(true)
  })

  it('渲染结束后恢复可见性', () => {
    const { scene, line, sprite } = sceneWithOverlays()
    const pass = { render: () => {} }
    excludeNonSurfacesFromOcclusion(pass, scene)
    pass.render()

    // Without restoration, cell outlines and labels would disappear permanently.
    expect(line.visible).toBe(true)
    expect(sprite.visible).toBe(true)
  })

  it('预渲染抛错也要恢复可见性', () => {
    const { scene, line } = sceneWithOverlays()
    const pass = {
      render: () => {
        throw new Error('gtao failed')
      },
    }
    excludeNonSurfacesFromOcclusion(pass, scene)

    expect(() => pass.render()).toThrow('gtao failed')
    // The finally path restores overlays after a render exception.
    expect(line.visible).toBe(true)
  })

  it('原本已隐藏的物体不会被误开', () => {
    const { scene, line } = sceneWithOverlays()
    line.visible = false
    const pass = { render: () => {} }
    excludeNonSurfacesFromOcclusion(pass, scene)
    pass.render()

    // Restore only objects that were visible before the prepass.
    expect(line.visible).toBe(false)
  })
})
