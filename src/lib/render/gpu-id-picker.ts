import * as THREE from 'three'
import { ID_VERT, ID_FRAG } from './id-pick-shaders'
import { decodeId } from './compact-selection'
import { buildInstanceRadii, buildElementTables, BALL_STICK_RADIUS_FACTOR, type CompactStructure } from './compact-structure'

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0])

/**
 * Offscreen color-id picker over the compact impostor bulk. Renders a self-contained
 * id mesh (same billboard + analytic sphere + gl_FragDepth as the visible impostors,
 * fragment outputs the instance index as RGBA) into a target, reads back the click
 * pixel / drag rect, decodes indices. readback is a synchronous GPU stall — call only
 * on a gesture (click / mouseup), never per frame.
 */
export class GpuIdPicker {
  private scene = new THREE.Scene()
  private mesh: THREE.InstancedMesh
  private material: THREE.ShaderMaterial
  private target: THREE.WebGLRenderTarget

  constructor(compact: CompactStructure, scale: number, factor: number = BALL_STICK_RADIUS_FACTOR) {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(QUAD, 3))
    geom.setAttribute('aCenter', new THREE.InstancedBufferAttribute(compact.positions, 3))
    const tables = buildElementTables(compact.elements)
    geom.setAttribute('aRadius', new THREE.InstancedBufferAttribute(buildInstanceRadii(compact, tables, scale, factor), 1))
    const ids = new Float32Array(compact.count)
    for (let i = 0; i < compact.count; i++) ids[i] = i
    geom.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1))
    this.material = new THREE.ShaderMaterial({ vertexShader: ID_VERT, fragmentShader: ID_FRAG })
    this.mesh = new THREE.InstancedMesh(geom, this.material, compact.count)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    })
  }

  private render(gl: THREE.WebGLRenderer, camera: THREE.Camera, x: number, y: number, w: number, h: number): Uint8Array {
    const W = gl.domElement.width, H = gl.domElement.height // drawing-buffer px
    if (this.target.width !== W || this.target.height !== H) this.target.setSize(W, H)
    const prevTarget = gl.getRenderTarget()
    const prevClear = gl.getClearColor(new THREE.Color())
    const prevAlpha = gl.getClearAlpha()
    gl.setRenderTarget(this.target)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(this.scene, camera)
    const buf = new Uint8Array(w * h * 4)
    gl.readRenderTargetPixels(this.target, x, y, w, h, buf)
    gl.setRenderTarget(prevTarget)
    gl.setClearColor(prevClear, prevAlpha)
    return buf
  }

  /** Front-most atom index under the CSS pixel, or -1. */
  pickPixel(gl: THREE.WebGLRenderer, camera: THREE.Camera, cssX: number, cssY: number): number {
    const dpr = gl.getPixelRatio()
    const px = Math.max(0, Math.floor(cssX * dpr))
    const py = Math.max(0, gl.domElement.height - 1 - Math.floor(cssY * dpr)) // flip Y
    const buf = this.render(gl, camera, px, py, 1, 1)
    return decodeId(buf[0], buf[1], buf[2])
  }

  /** Unique visible atom indices inside the CSS rect. */
  pickRect(gl: THREE.WebGLRenderer, camera: THREE.Camera, x0: number, y0: number, x1: number, y1: number): number[] {
    const dpr = gl.getPixelRatio()
    const left = Math.max(0, Math.floor(Math.min(x0, x1) * dpr))
    const right = Math.floor(Math.max(x0, x1) * dpr)
    const topCss = Math.min(y0, y1), botCss = Math.max(y0, y1)
    const w = Math.max(1, right - left)
    const h = Math.max(1, Math.floor((botCss - topCss) * dpr))
    const py = Math.max(0, gl.domElement.height - Math.floor(botCss * dpr)) // bottom edge, flipped
    const buf = this.render(gl, camera, left, py, w, h)
    const set = new Set<number>()
    for (let i = 0; i < w * h; i++) {
      const id = decodeId(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2])
      if (id >= 0) set.add(id)
    }
    return [...set]
  }

  dispose() {
    this.target.dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
