import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { resolveViewportTheme } from '../../../host'
import { markDoubleClickConsumedBy3D } from '../viewport-grid/double-click-arbiter'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { resolveViewportLighting, lightDirectionFromAngles } from '../../../lib/lighting'
import {
  buildElementTables, buildInstanceColors, buildInstanceRadii, viewModeRadiusFactor,
  buildSpeciesColorTable, writeSpeciesColors,
  type CompactStructure,
} from '../../../lib/render/compact-structure'
import { AtomSpatialGrid } from '../../../lib/render/atom-spatial-grid'
import { AtomTileGrid } from '../../../lib/render/atom-tile-grid'
import { materializeNeighborhood } from '../../../lib/render/materialize-neighborhood'
import { GpuIdPicker } from '../../../lib/render/gpu-id-picker'
import { buildSelectedFlags, selectionCentroidSpread } from '../../../lib/render/compact-selection'
import { createSyntheticVibrationSource, createThermalJitterSource, wrapPlayhead, asAsyncFrameSource, type AsyncFrameSource } from '../../../lib/render/frame-source'
import type { PlaybackChannel } from '../../../lib/render/playback-channel'
import { VERT, FRAG } from '../../../lib/render/sphere-impostor-shaders'
import {
  compactRenderMode, compactPickMode, compactBoxSelectMode, compactTileEdge,
  COMPACT_BOX_SELECTED_MAX, COMPACT_TILE_PICK_CANDIDATE_MAX,
} from '../../../lib/render/compact-lod'
import { boxSelectByProjection } from '../../../lib/render/cpu-box-select'
import { makeProjectClosure, frustumPlanesFromDragRect } from '../../../lib/render/camera-projection'
import { CompactPoints } from './compact-points'

/** Nearest atom (by smallest forward t, ties → lowest index) among a candidate subset along a ray. */
function nearestAlongRay(positions: Float32Array, indices: number[], o: [number, number, number], dir: [number, number, number], pickRadius: number): number {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl
  const pr2 = pickRadius * pickRadius
  let best = -1, bestT = Infinity
  for (const i of indices) {
    const ox = positions[i * 3] - o[0], oy = positions[i * 3 + 1] - o[1], oz = positions[i * 3 + 2] - o[2]
    const t = ox * dx + oy * dy + oz * dz
    if (t < 0) continue
    const px = ox - t * dx, py = oy - t * dy, pz = oz - t * dz
    // lowest-index tie-break on equal t, matching AtomSpatialGrid.raycastNearest (candidates are not
    // globally sorted by atom index, so the explicit `i < best` is required to stay consistent).
    if (px * px + py * py + pz * pz <= pr2 && (t < bestT || (t === bestT && i < best))) { bestT = t; best = i }
  }
  return best
}

// Unit quad in [-1,1] (two triangles), z=0 — billboarded in the vertex shader.
const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0])
const FOCUS_RADIUS = 8 // Å neighborhood materialized on focus dbl-click
const NO_RAYCAST = () => {}

interface CompactAtomsProps {
  compact: CompactStructure
  scale: number
  /** view mode (ball-stick / space-fill / wireframe) — drives impostor radii so the
   *  compact render matches the Atom[] paths visually. */
  viewMode?: string
  /** Hide the atom impostors (region-only view) while keeping the playback loop alive. */
  visible?: boolean
  /** Phase C: publishes the live playback buffers to sibling components (RegionSolids). */
  playback?: MutableRefObject<PlaybackChannel>
}

interface TrajPlayState {
  front: THREE.InstancedBufferAttribute
  back: THREE.InstancedBufferAttribute
  frontFrame: number
  /** frame currently in the back buffer; -1 = not yet decoded (streaming miss) */
  backFrame: number
  playhead: number
  lastDisplayPush: number
}

export function CompactAtoms({ compact, scale, viewMode = 'ball-stick', visible = true, playback }: CompactAtomsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const { camera, gl, raycaster, invalidate, size } = useThree()
  const showGrainColoring = useCrystalStore((s) => s.showGrainColoring)
  const setFocusAtoms = useCrystalStore((s) => s.setFocusAtoms)
  const focusOnPoint = useCrystalStore((s) => s.focusOnPoint)
  // selection (B3)
  const selectedCompactIndices = useCrystalStore((s) => s.selectedCompactIndices)
  const setCompactSelection = useCrystalStore((s) => s.setCompactSelection)
  const addCompactSelection = useCrystalStore((s) => s.addCompactSelection)
  const clearCompactSelection = useCrystalStore((s) => s.clearCompactSelection)
  const boxStart = useCrystalStore((s) => s.boxStart)
  const boxEnd = useCrystalStore((s) => s.boxEnd)
  const isBoxSelecting = useCrystalStore((s) => s.isBoxSelecting)
  // trajectory (B2)
  const compactTrajectory = useCrystalStore((s) => s.compactTrajectory)
  const compactTrajectorySource = useCrystalStore((s) => s.compactTrajectorySource)
  const compactSpeciesSource = useCrystalStore((s) => s.compactSpeciesSource)
  const compactTrajectorySeek = useCrystalStore((s) => s.compactTrajectorySeek)
  const compactTrajectoryPlaying = useCrystalStore((s) => s.compactTrajectoryPlaying)
  const compactTrajectoryDisplayFrame = useCrystalStore((s) => s.compactTrajectoryDisplayFrame)

  // lighting (mirror crystal-viewer/index lighting rig + hyper-stick-bonds shader)
  const background = useCrystalStore((s) => s.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  const lightAmbient = useCrystalStore((s) => s.lightAmbient)
  const lightKey = useCrystalStore((s) => s.lightKey)
  const lightFill = useCrystalStore((s) => s.lightFill)
  const lightAzimuth = useCrystalStore((s) => s.lightAzimuth)
  const lightElevation = useCrystalStore((s) => s.lightElevation)
  const headlight = useCrystalStore((s) => s.lightFollowsCamera)

  const trajRef = useRef<TrajPlayState | null>(null)
  const tables = useMemo(() => buildElementTables(compact.elements), [compact.elements])

  // Species track (B2 v3): positions static, aColor steps per frame from a window source.
  const speciesBufRef = useRef<Uint8Array | null>(null)
  const speciesFrameRef = useRef<number>(-1)
  const speciesPlayhead = useRef(0)
  const speciesLastDisplayPush = useRef(0)
  const speciesColorTable = useMemo(
    () => buildSpeciesColorTable(compact.elements, compact.palette),
    [compact.elements, compact.palette],
  )
  // reset the playhead ONLY when a new species source loads (not on play/pause —
  // pause/resume must continue from the current frame).
  useEffect(() => {
    speciesFrameRef.current = -1
    speciesPlayhead.current = 0
    speciesBufRef.current = null
  }, [compactSpeciesSource])
  // Kick the demand frameloop when playback starts OR a seek is requested. Under
  // frameloop="demand" a paused seek would otherwise never render — the loop below
  // would never run to consume it, so the bar couldn't jump.
  useEffect(() => {
    if (compactSpeciesSource && (compactTrajectoryPlaying || compactTrajectorySeek != null)) invalidate()
  }, [compactSpeciesSource, compactTrajectoryPlaying, compactTrajectorySeek, invalidate])
  // While a trajectory is PAUSED, picking targets the current frame's positions
  // (front buffer) so clicks land on what the user sees; while PLAYING picking is
  // disabled. Keyed on the throttled display frame so paused scrubbing re-syncs.
  const pausedFrameKey = compactTrajectory && !compactTrajectoryPlaying ? compactTrajectoryDisplayFrame : -1
  const pickCompact = useMemo(() => {
    if (!compactTrajectory || compactTrajectoryPlaying) return compact
    const front = trajRef.current?.front.array as Float32Array | undefined
    return front ? { ...compact, positions: front } : compact
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, compactTrajectory, compactTrajectoryPlaying, pausedFrameKey])
  // At extreme scale, the full id pass, fine spatial grid, and sphere mesh all
  // stall; gate each independently while preserving animated trajectory paths.
  // Points mode only for STATIC structures: the trajectory front/back buffers + playback channel
  // (which RegionSolids consumes) are written through the sphere InstancedMesh, so a trajectory must
  // keep the (correct, animating) sphere path even past 250k — else RegionSolids freezes. A >250k
  // trajectory is rare; correct-but-slower beats a frozen deformation.
  const renderMode = compactTrajectory ? 'sphere' : compactRenderMode(compact.count) // 'sphere' | 'points'
  const pickMode = compactPickMode(compact.count)       // 'gpu' | 'cpu-tile' | 'tile-focus'
  const boxMode = compactBoxSelectMode(compact.count)   // 'full' | 'tile' | 'disabled'

  // Fine grid: exact ray pick, suited to ≤2M; not built for tile-focus (>2M) where the per-cell Map dominates.
  const grid = useMemo(
    () => pickMode === 'tile-focus'
      ? null
      : new AtomSpatialGrid(pickCompact.positions, Math.max(1, pickCompact.bbox.max[0] - pickCompact.bbox.min[0])),
    [pickMode, pickCompact],
  )
  // Coarse tile grid: candidate culling for tile-scoped box-select (250k–1M) and >2M tile-focus pick.
  const tileGrid = useMemo(() => {
    if (boxMode !== 'tile' && pickMode !== 'tile-focus') return null
    const b = pickCompact.bbox
    const vol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2])
    return new AtomTileGrid(pickCompact.positions, b, compactTileEdge(pickCompact.count, vol))
  }, [boxMode, pickMode, pickCompact])

  const radiusFactor = viewModeRadiusFactor(viewMode)
  // Build the GPU id-picker ONLY in gpu mode — its constructor allocates an offscreen target + full
  // per-atom id/radius buffers, the exact cost we avoid above 250k.
  const picker = useMemo(
    () => pickMode === 'gpu' ? new GpuIdPicker(pickCompact, scale, radiusFactor) : null,
    [pickMode, pickCompact, scale, radiusFactor],
  )
  useEffect(() => () => picker?.dispose(), [picker])

  // Per-point colors for the points LOD branch (same convention as the sphere path's instance colors).
  const pointColors = useMemo(
    () => renderMode === 'points' ? buildInstanceColors(compact, tables, showGrainColoring) : null,
    [renderMode, compact, tables, showGrainColoring],
  )
  // Bounded selection overlay for points mode (already capped, but slice defensively).
  const selectedForOverlay = useMemo(
    () => renderMode === 'points' ? Array.from(selectedCompactIndices).slice(0, COMPACT_BOX_SELECTED_MAX) : [],
    [renderMode, selectedCompactIndices],
  )

  const uniforms = useMemo(() => ({
    uLight: { value: new THREE.Vector3(0, 0, 1) },
    uAmbient: { value: 0.6 },
    uKey: { value: 1.0 },
    uFill: { value: 0.4 },
    uMix: { value: 0 },
  }), [])

  const worldLight = useMemo(() => {
    const d = lightDirectionFromAngles(lightAzimuth, lightElevation, 1)
    return new THREE.Vector3(d[0], d[1], d[2]).normalize()
  }, [lightAzimuth, lightElevation])

  useEffect(() => {
    const l = resolveViewportLighting(isDark, lightAmbient, lightKey, lightFill)
    uniforms.uAmbient.value = l.ambient
    uniforms.uKey.value = l.key
    uniforms.uFill.value = l.fill
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true
  }, [isDark, lightAmbient, lightKey, lightFill, uniforms])

  useEffect(() => {
    if (!headlight) return
    uniforms.uLight.value.set(0, 0, 1)
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true
  }, [headlight, uniforms])

  useFrame(({ camera: cam }) => {
    if (headlight) return
    uniforms.uLight.value.copy(worldLight).transformDirection(cam.matrixWorldInverse).normalize()
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true
  })

  // B2: trajectory playback state (double-buffered positions; playhead in a ref).
  // An external (file/artifact) source takes priority; otherwise synthesize a
  // procedural source from the config. Both go through the same async contract.
  const trajSource: AsyncFrameSource | null = useMemo(() => {
    if (compactTrajectorySource) return compactTrajectorySource
    // amplitude<=0 ⇒ positions stay static (static structure or a non-vibrating .spectraj).
    if (!compactTrajectory || compactTrajectory.amplitude <= 0) return null
    // A species (.spectraj) trajectory gets pure per-atom thermal jitter (MD wobble);
    // a bare compact structure gets the traveling-wave synthetic vibration.
    const src = compactSpeciesSource
      ? createThermalJitterSource(compact.positions, {
          frameCount: compactTrajectory.frameCount, amplitude: compactTrajectory.amplitude,
        })
      : createSyntheticVibrationSource(compact.positions, compact.bbox, {
          frameCount: compactTrajectory.frameCount, amplitude: compactTrajectory.amplitude,
        })
    return asAsyncFrameSource(src)
  }, [compactTrajectorySource, compactTrajectory, compact, compactSpeciesSource])

  // build per-instance attributes (geometry) when data / coloring / scale change
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.count = compact.count
    const geom = mesh.geometry
    if (!trajRef.current) {
      // static mode: zero-copy positions; aCenterB shares the SAME attribute object
      // (one GPU buffer) so the shader lerp is a no-op at uMix=0.
      const centerAttr = new THREE.InstancedBufferAttribute(compact.positions, 3)
      geom.setAttribute('aCenter', centerAttr)
      geom.setAttribute('aCenterB', centerAttr)
    }
    geom.setAttribute('aRadius', new THREE.InstancedBufferAttribute(buildInstanceRadii(compact, tables, scale, radiusFactor), 1))
    geom.setAttribute('aColor', new THREE.InstancedBufferAttribute(buildInstanceColors(compact, tables, showGrainColoring), 3))
  }, [compact, tables, scale, radiusFactor, showGrainColoring])

  // rebuild the selection-highlight attribute when the selection changes
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.geometry.setAttribute('aSelected', new THREE.InstancedBufferAttribute(buildSelectedFlags(compact.count, selectedCompactIndices), 1))
    invalidate()
  }, [compact, selectedCompactIndices, invalidate])

  // B2: enter/exit trajectory mode — allocate double buffers, restore statics on exit
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || !trajSource) return
    const n = compact.count
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    const b = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    // streaming sources may not have frame 0/1 decoded yet — fall back to the
    // static positions (== frame 0 for file trajectories); the loop recovers.
    if (!trajSource.tryGetFrame(0, a.array as Float32Array)) (a.array as Float32Array).set(compact.positions)
    const next = Math.min(1, trajSource.frameCount - 1)
    const okB = trajSource.tryGetFrame(next, b.array as Float32Array)
    if (!okB) (b.array as Float32Array).set(a.array as Float32Array)
    a.needsUpdate = true; b.needsUpdate = true
    mesh.geometry.setAttribute('aCenter', a)
    mesh.geometry.setAttribute('aCenterB', b)
    trajRef.current = { front: a, back: b, frontFrame: 0, backFrame: okB ? next : -1, playhead: 0, lastDisplayPush: 0 }
    uniforms.uMix.value = 0
    const playbackChannel = playback?.current
    if (playbackChannel) {
      playbackChannel.front = a.array as Float32Array
      playbackChannel.back = b.array as Float32Array
      playbackChannel.mix = 0
      playbackChannel.version++
    }
    invalidate()
    return () => {
      trajRef.current = null
      const centerAttr = new THREE.InstancedBufferAttribute(compact.positions, 3)
      mesh.geometry.setAttribute('aCenter', centerAttr)
      mesh.geometry.setAttribute('aCenterB', centerAttr)
      uniforms.uMix.value = 0
      if (playbackChannel) {
        playbackChannel.front = null
        playbackChannel.back = null
        playbackChannel.version++
      }
      invalidate()
    }
  }, [trajSource, compact, uniforms, invalidate, playback])

  // B2: playback loop — advance playhead, swap/upload one frame per advance, lerp uMix
  useFrame((_, delta) => {
    const st = trajRef.current
    const mesh = meshRef.current
    if (!st || !trajSource || !mesh) return
    const store = useCrystalStore.getState()

    const last = trajSource.frameCount - 1
    const fill = (frame: number, attr: THREE.InstancedBufferAttribute): boolean => {
      if (!trajSource.tryGetFrame(frame, attr.array as Float32Array)) return false
      attr.needsUpdate = true
      return true
    }

    const seek = store.compactTrajectorySeek
    if (seek != null) {
      st.playhead = Math.min(Math.max(seek, 0), last)
      store.clearCompactTrajectorySeek()
      st.frontFrame = -1 // force a refill at the new playhead
    } else if (store.compactTrajectoryPlaying) {
      const fps = store.compactTrajectory?.trajFps ?? 30
      if (store.compactTrajectoryLoop) {
        st.playhead = wrapPlayhead(st.playhead + delta * fps, trajSource.frameCount)
      } else {
        const lastF = trajSource.frameCount - 1
        if (st.playhead >= lastF) {
          st.playhead = 0 // play pressed again at the end: restart
        } else {
          const next = st.playhead + delta * fps
          if (next >= lastF) {
            st.playhead = lastF
            store.setCompactTrajectoryPlaying(false) // stop on the last frame
          } else {
            st.playhead = next
          }
        }
      }
    }

    let fi = Math.floor(st.playhead)
    if (fi !== st.frontFrame) {
      if (fi === st.frontFrame + 1 && st.backFrame === fi) {
        // sequential advance with the next frame buffered: pointer-swap, then
        // decode only the new lookahead frame into the freed buffer
        const old = st.front; st.front = st.back; st.back = old
        mesh.geometry.setAttribute('aCenter', st.front)
        mesh.geometry.setAttribute('aCenterB', st.back)
        st.frontFrame = fi
        const next = Math.min(fi + 1, last)
        st.backFrame = fill(next, st.back) ? next : -1
      } else if (fill(fi, st.front)) {
        // jump / wrap / recovery — front decoded now, back best-effort
        st.frontFrame = fi
        const next = Math.min(fi + 1, last)
        st.backFrame = fill(next, st.back) ? next : -1
      } else {
        // streaming miss: hold on the current frame until the decode lands
        void trajSource.prefetch(fi)
        if (st.frontFrame >= 0) { st.playhead = st.frontFrame; fi = st.frontFrame }
      }
    } else if (st.backFrame !== Math.min(fi + 1, last)) {
      // back buffer still missing from an earlier miss — retry (cheap window lookup)
      const next = Math.min(fi + 1, last)
      if (fill(next, st.back)) st.backFrame = next
    }
    // mix only when the back buffer really holds frame fi+1
    uniforms.uMix.value = st.backFrame === Math.min(fi + 1, last) && st.frontFrame === fi ? st.playhead - fi : 0
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true
    if (playback) {
      playback.current.front = st.front.array as Float32Array
      playback.current.back = st.back.array as Float32Array
      playback.current.mix = uniforms.uMix.value
      playback.current.version++
    }

    const now = performance.now()
    if (now - st.lastDisplayPush > 250) {
      st.lastDisplayPush = now
      store.setCompactTrajectoryDisplayFrame(fi)
    }
    if (store.compactTrajectoryPlaying) invalidate() // self-sustaining under demand frameloop
  })

  // B2 v3: species playback — positions static, step aColor per displayed frame from the
  // window source. When a position track also exists it owns the playhead; otherwise this
  // loop advances the shared playhead (seek / play / loop / fps) itself.
  useFrame((_, delta) => {
    const src = compactSpeciesSource
    const mesh = meshRef.current
    if (!src || !mesh) return
    const store = useCrystalStore.getState()
    const last = src.frameCount - 1

    if (!trajSource) {
      const seek = store.compactTrajectorySeek
      if (seek != null) {
        speciesPlayhead.current = Math.min(Math.max(seek, 0), last)
        store.clearCompactTrajectorySeek()
        speciesFrameRef.current = -1 // force the seeked frame to render even if == last shown
      } else if (store.compactTrajectoryPlaying) {
        const fps = store.compactTrajectory?.trajFps ?? 30
        if (store.compactTrajectoryLoop) {
          speciesPlayhead.current = wrapPlayhead(speciesPlayhead.current + delta * fps, src.frameCount)
        } else if (speciesPlayhead.current >= last) {
          speciesPlayhead.current = 0 // play pressed again at the end: restart
        } else {
          const next = speciesPlayhead.current + delta * fps
          if (next >= last) { speciesPlayhead.current = last; store.setCompactTrajectoryPlaying(false) }
          else speciesPlayhead.current = next
        }
      }
    } else {
      speciesPlayhead.current = trajRef.current?.playhead ?? speciesPlayhead.current
    }

    const fi = Math.floor(speciesPlayhead.current)
    if (fi !== speciesFrameRef.current) {
      if (!speciesBufRef.current) speciesBufRef.current = new Uint8Array(src.atomCount)
      const buf = speciesBufRef.current
      if (src.tryGetSpecies(fi, buf)) {
        const attr = mesh.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute | undefined
        if (attr) {
          writeSpeciesColors(buf, speciesColorTable, attr.array as Float32Array)
          attr.needsUpdate = true
        }
        speciesFrameRef.current = fi
      } else {
        void src.prefetch(fi) // streaming miss: decode lands shortly; bar still follows playhead
      }
    }
    const target = Math.floor(speciesPlayhead.current)
    if (!trajSource) {
      // species-only: this loop drives the bar slider from the playhead itself (immediate
      // while scrubbing, throttled while playing — independent of whether the frame finished
      // decoding, so the bar doesn't freeze when streaming briefly lags) and self-sustains.
      const now = performance.now()
      if (!store.compactTrajectoryPlaying) {
        store.setCompactTrajectoryDisplayFrame(target)
      } else if (now - speciesLastDisplayPush.current > 250) {
        speciesLastDisplayPush.current = now
        store.setCompactTrajectoryDisplayFrame(target)
      }
      const settled = speciesFrameRef.current === target
      if (store.compactTrajectoryPlaying || !settled) invalidate()
    } else if (speciesFrameRef.current !== target) {
      // a vibration track owns the playhead/bar; just keep retrying until the species mask
      // for this frame decodes (e.g. a paused far-seek under frameloop="demand").
      invalidate()
    }
  })

  // Single-click → GPU pick-select (drag-guarded so orbit/box-drag don't trigger).
  // Disabled during trajectory playback (view-only mode).
  const shiftRef = useRef(false)
  useEffect(() => {
    const el = gl.domElement
    let downX = 0, downY = 0
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; shiftRef.current = e.shiftKey }
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return // a drag (orbit / box-select)
      const store = useCrystalStore.getState()
      if (store.compactTrajectory && store.compactTrajectoryPlaying) return // picking allowed when paused
      if (store.toolMode !== 'select') return
      const rect = el.getBoundingClientRect()
      let idx: number
      if (picker) {
        idx = picker.pickPixel(gl, camera, e.clientX - rect.left, e.clientY - rect.top) // ≤250k: exact GPU silhouette
      } else {
        // >250k: CPU ray pick over the tile/fine grid (avoids the full offscreen id render)
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        const o = raycaster.ray.origin, d = raycaster.ray.direction
        const pr = Math.max(...Array.from(tables.radii)) * scale * 1.2
        idx = grid
          ? grid.raycastNearestGridded([o.x, o.y, o.z], [d.x, d.y, d.z], pr)
          : tileGrid
            ? nearestAlongRay(pickCompact.positions, tileGrid.collectRayCandidates([o.x, o.y, o.z], [d.x, d.y, d.z], pr, pickCompact.count).indices, [o.x, o.y, o.z], [d.x, d.y, d.z], pr)
            : -1
      }
      // sticky multi-select behaves exactly like a held Shift (see selection-slice)
      const accumulate = e.shiftKey || store.stickyMultiSelect
      if (idx < 0) { if (!accumulate) clearCompactSelection(); return }
      if (accumulate) { addCompactSelection([idx]); return }
      setCompactSelection([idx])
      // mirror normal mode: selecting an atom flies the camera to it
      focusOnPoint([pickCompact.positions[idx * 3], pickCompact.positions[idx * 3 + 1], pickCompact.positions[idx * 3 + 2]], 3)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp) }
  }, [gl, camera, raycaster, picker, grid, tileGrid, tables, scale, pickCompact, setCompactSelection, addCompactSelection, clearCompactSelection, focusOnPoint])

  // double-click focus (disabled in trajectory mode)
  useEffect(() => {
    const el = gl.domElement
    const onDblClick = (e: MouseEvent) => {
      const st = useCrystalStore.getState()
      // while PLAYING we still fly the camera (no interactive patch — it would
      // freeze mid-vibration); paused/static get the full focus behaviour
      const playing = !!(st.compactTrajectory && st.compactTrajectoryPlaying)
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const o = raycaster.ray.origin, d = raycaster.ray.direction
      const pr = Math.max(...Array.from(tables.radii)) * scale * 1.2
      // ≤2M: exact grid pick + materialize the focus neighborhood. >2M (tile-focus): nearest among
      // ray-hit tiles, fly only (the per-atom neighborhood patch is the heavy path we skip at scale).
      const idx = grid
        ? grid.raycastNearestGridded([o.x, o.y, o.z], [d.x, d.y, d.z], pr)
        : tileGrid
          ? nearestAlongRay(pickCompact.positions, tileGrid.collectRayCandidates([o.x, o.y, o.z], [d.x, d.y, d.z], pr, pickCompact.count).indices, [o.x, o.y, o.z], [d.x, d.y, d.z], pr)
          : -1
      if (idx < 0) { if (!playing) setFocusAtoms([]); return }
      markDoubleClickConsumedBy3D()
      if (!playing && grid) setFocusAtoms(materializeNeighborhood(pickCompact, grid.neighborhood(idx, FOCUS_RADIUS)))
      focusOnPoint([pickCompact.positions[idx * 3], pickCompact.positions[idx * 3 + 1], pickCompact.positions[idx * 3 + 2]], FOCUS_RADIUS)
    }
    el.addEventListener('dblclick', onDblClick)
    return () => el.removeEventListener('dblclick', onDblClick)
  }, [gl, camera, raycaster, grid, tileGrid, tables, scale, pickCompact, setFocusAtoms, focusOnPoint])

  // box-select: when a Shift/box drag ends, GPU-pick the rectangle.
  // Capture the last valid rect while the drag is live, then GPU-pick it on release.
  const wasBoxSelecting = useRef(false)
  const lastBoxRef = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
  useEffect(() => {
    if (isBoxSelecting && boxStart && boxEnd) {
      lastBoxRef.current = { sx: boxStart.x, sy: boxStart.y, ex: boxEnd.x, ey: boxEnd.y }
    }
    if (wasBoxSelecting.current && !isBoxSelecting && lastBoxRef.current) {
      const r = lastBoxRef.current
      lastBoxRef.current = null
      const st = useCrystalStore.getState()
      const blocked = st.compactTrajectory && st.compactTrajectoryPlaying
      if (!blocked && Math.abs(r.ex - r.sx) > 3 && Math.abs(r.ey - r.sy) > 3) {
        const applySelection = (idxs: number[]) => {
          shiftRef.current ? addCompactSelection(idxs) : setCompactSelection(idxs)
          if (idxs.length > 0) {
            // mirror normal mode: finishing a box-select flies the camera to the selection
            const { center, spread } = selectionCentroidSpread(pickCompact, new Set(idxs))
            focusOnPoint(center, spread)
          }
        }
        if (boxMode === 'full' && picker) {
          applySelection(picker.pickRect(gl, camera, r.sx, r.sy, r.ex, r.ey)) // ≤250k: exact GPU silhouette
        } else if (boxMode === 'tile' && tileGrid) {
          // 250k–1M: world-frustum tile cull → exact projected-centre filter (CPU). Selects atom
          // CENTRES, not GPU front-most silhouettes — a deliberate degradation past the GPU budget.
          const planes = frustumPlanesFromDragRect(camera, { x: r.sx, y: r.sy }, { x: r.ex, y: r.ey }, size)
          if (planes) {
            const project = makeProjectClosure(camera, size)
            const res = boxSelectByProjection(
              pickCompact.positions, tileGrid.frustumCandidates(planes), project,
              { x: r.sx, y: r.sy }, { x: r.ex, y: r.ey }, COMPACT_TILE_PICK_CANDIDATE_MAX, COMPACT_BOX_SELECTED_MAX,
            )
            applySelection(res.selected)
            if (res.candidateTruncated) console.warn(`Box-select tested ${COMPACT_TILE_PICK_CANDIDATE_MAX.toLocaleString()} candidates and stopped — selection may be incomplete; narrow the box.`)
            else if (res.selectedTruncated) console.warn(`Box-select capped at ${COMPACT_BOX_SELECTED_MAX.toLocaleString()} atoms — more centres matched.`)
          }
        } else if (boxMode === 'disabled') {
          console.warn('Box-select is disabled above 1,000,000 atoms — zoom in and click to select a region.')
        }
      }
    }
    wasBoxSelecting.current = isBoxSelecting
  }, [isBoxSelecting, boxStart, boxEnd, gl, camera, size, boxMode, picker, tileGrid, pickCompact, setCompactSelection, addCompactSelection, focusOnPoint])

  // LOD render branch: above 250k atoms the sphere InstancedMesh stalls the GPU, so draw GL points
  // (1 vertex/atom). Both branches run AFTER every hook above, so hook order is stable; the sphere
  // path's per-frame instanced updates simply no-op when its mesh isn't mounted (points mode is
  // static colors — trajectory animation stays on the sphere path).
  if (renderMode === 'points' && pointColors) {
    return (
      <CompactPoints
        positions={pickCompact.positions}
        colors={pointColors}
        count={compact.count}
        selectedIndices={selectedForOverlay}
        visible={visible}
      />
    )
  }

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, compact.count]} frustumCulled={false} raycast={NO_RAYCAST} visible={visible}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[QUAD, 3]} />
      </bufferGeometry>
      <shaderMaterial ref={materialRef} uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} />
    </instancedMesh>
  )
}
