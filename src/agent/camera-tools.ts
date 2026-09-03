/**
 * Camera tools that direct the user's attention without changing structure.
 * `viewer_look_at` frames one target, `viewer_set_view` changes orientation
 * without changing the focal point, and `viewer_tour` visits captioned stops
 * until complete or interrupted by manual camera input. All are read-tier.
 */

import { CameraInputError } from './camera-surface'
import type {
  CameraFlightResult,
  CameraTargetSpec,
  CameraViewSpec,
  Vec3,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { createDistanceCalculator } from './structure-math'
import { objectSchema, toolError } from './tool-helpers'
import {
  describeScreenAxes,
  roundScreen,
  screenFrame,
  summarizeVisibleAtoms,
  toScreen,
  type ScreenAxes,
  type ScreenPoint,
  type VisibleAtomsSummary,
} from '../lib/scene-grid/viewer-frame'

const TARGET_SCHEMA = {
  description:
    'What to frame. {"atomIds":[...]} | {"point":[x,y,z],"radius":Å} | "selection" (current user selection) | "all".',
  oneOf: [
    { type: 'string', enum: ['selection', 'all'] },
    objectSchema({ atomIds: { type: 'array', items: { type: 'string' }, minItems: 1 } }, ['atomIds']),
    objectSchema({
      point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      radius: { type: 'number', minimum: 0.1, description: 'Å around the point to keep in frame. Default 3.' },
    }, ['point']),
  ],
}

const VIEW_SCHEMA = {
  description:
    'Camera orientation. Cartesian views use Z-up: top/bottom place the eye on +/-Z, front/back on -/+Y, and right/left on +/-X. "a|b|c" looks down a lattice axis; {"direction":[x,y,z]} points from target towards the eye; {"hkl":[h,k,l]} looks along the plane normal. Omit to keep the current angle.',
  oneOf: [
    { type: 'string', enum: ['front', 'back', 'top', 'bottom', 'left', 'right', 'iso', 'a', 'b', 'c'] },
    objectSchema({ direction: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } }, ['direction']),
    objectSchema({ hkl: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 } }, ['hkl']),
  ],
}

const DURATION_SCHEMA = { type: 'number', minimum: 0, maximum: 8000, description: 'Flight time in ms. Default 1200; 0 = jump.' }

function requireCamera(context: ZatomToolContext) {
  if (!context.camera) {
    throw new CameraInputError('no_viewer', 'The current context has no viewport camera.')
  }
  return context.camera
}

function flightSummary(result: CameraFlightResult, what: string): string {
  const c = result.center.map((v) => v.toFixed(2)).join(', ')
  const tail = result.interrupted ? ' — user grabbed the camera mid-flight' : ''
  return `Camera on ${what} at (${c}), ${result.distance.toFixed(1)} Å away${tail}`
}

function describeTarget(target: CameraTargetSpec): string {
  if (target === 'selection') return 'the selection'
  if (target === 'all') return 'the whole structure'
  if ('point' in target) return 'the point'
  return target.atomIds.length === 1 ? `atom ${target.atomIds[0]}` : `${target.atomIds.length} atoms`
}

// ---------------------------------------------------------------------------

const lookAtManifest: ZatomToolManifest = {
  name: 'viewer_look_at',
  title: 'Fly the camera to a target',
  version: '1.0.0',
  description:
    'Fly the camera so the target fills the view, optionally from a chosen angle. Use before you edit or explain a region so the user sees what you mean. Returns where the camera landed and whether the user interrupted the flight. Never changes atoms.',
  inputSchema: objectSchema({
    target: TARGET_SCHEMA,
    view: VIEW_SCHEMA,
    durationMs: DURATION_SCHEMA,
  }, ['target']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['viewer', 'camera', 'guide'],
}

const lookAtTool: ZatomToolDefinition<CameraFlightResult> = {
  manifest: lookAtManifest,
  execute: async (input, context) => {
    try {
      const camera = requireCamera(context)
      const target = input.target as CameraTargetSpec
      const result = await camera.lookAt({
        target,
        view: input.view as CameraViewSpec | undefined,
        durationMs: input.durationMs as number | undefined,
      }, context.signal)
      return { ok: true, tool: lookAtManifest.name, summary: flightSummary(result, describeTarget(target)), data: result }
    } catch (error) {
      return toolError(lookAtManifest.name, error)
    }
  },
}

// ---------------------------------------------------------------------------

const setViewManifest: ZatomToolManifest = {
  name: 'viewer_set_view',
  title: 'Set the viewing angle',
  version: '1.0.0',
  description:
    'Rotate the camera to a standard view (front/top/iso…), down a lattice axis (a/b/c), along an arbitrary direction, or normal to an hkl plane, keeping the current look-at point. Use for "show me the top view" or to reveal layering/stacking. Never changes atoms.',
  inputSchema: objectSchema({
    view: { ...VIEW_SCHEMA, description: VIEW_SCHEMA.description.replace(' Omit to keep the current angle.', '') },
    durationMs: DURATION_SCHEMA,
  }, ['view']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['viewer', 'camera', 'guide'],
}

const setViewTool: ZatomToolDefinition<CameraFlightResult> = {
  manifest: setViewManifest,
  execute: async (input, context) => {
    try {
      const camera = requireCamera(context)
      const result = await camera.setView(
        input.view as CameraViewSpec,
        input.durationMs as number | undefined,
        context.signal,
      )
      const label = typeof input.view === 'string' ? `${input.view} view` : 'custom view'
      return { ok: true, tool: setViewManifest.name, summary: flightSummary(result, label), data: result }
    } catch (error) {
      return toolError(setViewManifest.name, error)
    }
  },
}

// ---------------------------------------------------------------------------

interface TourStop {
  target: CameraTargetSpec
  view?: CameraViewSpec
  caption?: string
  holdMs?: number
  durationMs?: number
}

interface TourResult {
  stopsCompleted: number
  stopsTotal: number
  interruptedAt: number | null
  flights: CameraFlightResult[]
}

const tourManifest: ZatomToolManifest = {
  name: 'viewer_tour',
  title: 'Guided camera tour',
  version: '1.0.0',
  description:
    'Fly through several targets in order, showing a caption at each stop. Use to walk the user through a structure ("here is the defect, here is the adsorption site…") before proposing changes. Stops immediately if the user moves the camera; the result says how far it got. Captions appear in the guidance strip and are cleared when the tour ends. Never changes atoms.',
  inputSchema: objectSchema({
    stops: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: objectSchema({
        target: TARGET_SCHEMA,
        view: VIEW_SCHEMA,
        caption: { type: 'string', maxLength: 140, description: 'One sentence shown while the camera rests at this stop.' },
        holdMs: { type: 'number', minimum: 0, maximum: 10000, description: 'Rest time at the stop. Default 1500.' },
        durationMs: DURATION_SCHEMA,
      }, ['target']),
    },
  }, ['stops']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['viewer', 'camera', 'guide', 'tour'],
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason instanceof Error ? signal.reason : new Error('Tool execution was cancelled'))
    return
  }
  const timer = setTimeout(finish, ms)
  const onAbort = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    reject(signal?.reason instanceof Error ? signal.reason : new Error('Tool execution was cancelled'))
  }
  function finish() {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
})

const tourTool: ZatomToolDefinition<TourResult> = {
  manifest: tourManifest,
  execute: async (input, context) => {
    try {
      const camera = requireCamera(context)
      const stops = input.stops as TourStop[]
      const flights: CameraFlightResult[] = []
      let interruptedAt: number | null = null
      for (let index = 0; index < stops.length; index++) {
        const stop = stops[index]
        if (stop.caption !== undefined) await context.guidance?.setCaption(stop.caption)
        const flight = await camera.lookAt(
          { target: stop.target, view: stop.view, durationMs: stop.durationMs },
          context.signal,
        )
        flights.push(flight)
        if (flight.interrupted) {
          interruptedAt = index
          break
        }
        await sleep(stop.holdMs ?? 1500, context.signal)
      }
      await context.guidance?.setCaption(null)
      const data: TourResult = { stopsCompleted: flights.length - (interruptedAt === null ? 0 : 1), stopsTotal: stops.length, interruptedAt, flights }
      const summary = interruptedAt === null
        ? `Tour complete: ${stops.length} stop${stops.length === 1 ? '' : 's'}`
        : `Tour stopped at stop ${interruptedAt + 1}/${stops.length}: user took the camera`
      return { ok: true, tool: tourManifest.name, summary, data }
    } catch (error) {
      try {
        await context.guidance?.setCaption(null)
      } catch {
        // Preserve the operation/cancellation error that stopped the tour.
      }
      return toolError(tourManifest.name, error)
    }
  },
}

// ---------------------------------------------------------------------------
// viewer_observe — what the user is looking at, in terms the agent can use
// ---------------------------------------------------------------------------

interface ObservedAtom {
  id: string
  element: string
  /** View-plane offset from the look-at point (Å right / up) and depth into the scene. */
  screen: ScreenPoint
  /** Nearest neighbours by distance, for local context. */
  neighbors: { id: string; element: string; distanceA: number }[]
}

interface ViewerObserveData {
  mounted: boolean
  workspace: {
    viewportId: string
    revision: number
    structureFingerprint: string | null
    trajectoryFingerprint: string | null
  } | null
  camera: {
    position: Vec3
    lookAt: Vec3
    distanceA: number
    /** Screen axes in world coordinates. "right" is what the user calls right. */
    screenAxes: ScreenAxes
    projection: 'perspective' | 'orthographic'
    viewportSizePx: [number, number] | null
  } | null
  visible: VisibleAtomsSummary | null
  selection: {
    /** Total live selection size; atomIds/atoms below are a bounded prefix. */
    atomCount: number
    atomIds: string[]
    atomIdsTruncated: boolean
    bondCount: number
    bondIds: string[]
    bondIdsTruncated: boolean
    faceCount: number
    faceIds: string[]
    faceIdsTruncated: boolean
    edgeCount: number
    edgeIds: string[]
    edgeIdsTruncated: boolean
    boxSelectionActive: boolean
    centroid: Vec3 | null
    atoms: ObservedAtom[]
  }
  hovered: ObservedAtom | null
  lastFocus: { atomCount: number; atomIds: string[]; atomIdsTruncated: boolean; center: Vec3; ageMs: number } | null
  candidates: {
    id: string
    label: string
    count: number
    focusedIndex: number | null
    status: 'pending' | 'confirmed' | 'cancelled' | 'stale'
    confirmedIndex: number | null
  } | null
}

export const VIEWER_OBSERVE_DEFAULT_SELECTION_ATOM_LIMIT = 24
const VIEWER_OBSERVE_MAX_SELECTION_ATOM_LIMIT = 200

const observeManifest: ZatomToolManifest = {
  name: 'viewer_observe',
  title: 'Observe what the user sees',
  version: '1.0.0',
  description:
    'Read the user\'s viewport as structured data: camera pose, which world direction is screen-right / screen-up / into-the-screen (with the closest lattice axis for each), how many atoms are in frame and which sit at the centre, the current selection and hovered atom with their screen offsets and nearest neighbours, where you last landed the camera, and any candidate set you presented. Call this when the user says "this one", "the atom on the right", "the layer below", or after they click something, and BEFORE scene_resolve_reference. Cheap; read-only.',
  inputSchema: objectSchema({
    neighborCount: { type: 'integer', minimum: 0, maximum: 12, default: 4, description: 'Neighbours listed per selected/hovered atom.' },
    nearCenterLimit: { type: 'integer', minimum: 0, maximum: 30, default: 8 },
    selectionAtomLimit: {
      type: 'integer',
      minimum: 1,
      maximum: VIEWER_OBSERVE_MAX_SELECTION_ATOM_LIMIT,
      default: VIEWER_OBSERVE_DEFAULT_SELECTION_ATOM_LIMIT,
      description: 'Maximum selected atom IDs/details returned. selection.atomCount and atomIdsTruncated report the full live selection without flooding the Agent context.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'read' },
  tags: ['viewer', 'perception', 'observation', 'selection', 'agent'],
}

const observeTool: ZatomToolDefinition<ViewerObserveData> = {
  manifest: observeManifest,
  execute: async (input, context) => {
    try {
      const scene = await context.readViewerScene?.(context.signal) ?? null
      const structure: ZatomStructure | null = context.readStructure ? (await context.readStructure()) ?? null : null
      const neighborCount = Math.max(0, Math.min(12, Math.trunc(
        typeof input.neighborCount === 'number' ? input.neighborCount : 4,
      )))
      const nearCenterLimit = typeof input.nearCenterLimit === 'number' ? input.nearCenterLimit : 8
      const selectionAtomLimit = Math.max(1, Math.min(
        VIEWER_OBSERVE_MAX_SELECTION_ATOM_LIMIT,
        Math.trunc(typeof input.selectionAtomLimit === 'number'
          ? input.selectionAtomLimit
          : VIEWER_OBSERVE_DEFAULT_SELECTION_ATOM_LIMIT),
      ))
      const frame = scene?.pose ? screenFrame(scene.pose) : null
      const distance = structure ? createDistanceCalculator(structure.lattice) : null
      const byId = new Map((structure?.atoms ?? []).map((a) => [a.id, a]))
      const describedAtoms = new Map<string, ObservedAtom | null>()

      const describeAtom = (id: string): ObservedAtom | null => {
        if (describedAtoms.has(id)) return describedAtoms.get(id) ?? null
        const atom = byId.get(id)
        if (!atom || !structure) {
          describedAtoms.set(id, null)
          return null
        }
        // Maintain only k nearest entries while scanning. The previous
        // map+full-sort allocated one record per atom for every selected atom,
        // which made a large box selection turn a simple observation into an
        // O(selection × atoms) memory spike.
        const neighbors: ObservedAtom['neighbors'] = []
        if (neighborCount > 0 && distance) {
          for (const other of structure.atoms) {
            if (other.id === id) continue
            const candidate = {
              id: other.id,
              element: other.element,
              distanceA: distance(atom.position, other.position),
            }
            const insertAt = neighbors.findIndex((entry) => entry.distanceA > candidate.distanceA)
            if (insertAt < 0) {
              if (neighbors.length < neighborCount) neighbors.push(candidate)
            } else {
              neighbors.splice(insertAt, 0, candidate)
              if (neighbors.length > neighborCount) neighbors.pop()
            }
          }
          for (const neighbor of neighbors) neighbor.distanceA = Number(neighbor.distanceA.toFixed(3))
        }
        const screen = frame ? roundScreen(toScreen(frame, atom.position)) : { x: 0, y: 0, depth: 0, eyeDistance: 0 }
        const described = { id, element: atom.element, screen, neighbors }
        describedAtoms.set(id, described)
        return described
      }

      const allSelectedIds = scene?.selectedAtomIds ?? []
      const selectedIds = allSelectedIds.slice(0, selectionAtomLimit)
      const selectedAtoms = selectedIds.map(describeAtom).filter((a): a is ObservedAtom => a !== null)
      let selectedPositionCount = 0
      const selectedPositionSum: Vec3 = [0, 0, 0]
      for (const id of allSelectedIds) {
        const position = byId.get(id)?.position
        if (!position) continue
        selectedPositionSum[0] += position[0]
        selectedPositionSum[1] += position[1]
        selectedPositionSum[2] += position[2]
        selectedPositionCount += 1
      }
      const selectionCentroid: Vec3 | null = selectedPositionCount
        ? [
            selectedPositionSum[0] / selectedPositionCount,
            selectedPositionSum[1] / selectedPositionCount,
            selectedPositionSum[2] / selectedPositionCount,
          ]
        : null
      const allBondIds = scene?.selectedBondIds ?? []
      const allFaceIds = scene?.selectedFaceIds ?? []
      const allEdgeIds = scene?.selectedEdgeIds ?? []
      const lastFocusAtomIds = scene?.lastFocus?.atomIds ?? []
      const guidance = await context.guidance?.read() ?? null
      const workspace = await context.workspaceIdentity?.() ?? null
      const candidates = guidance?.candidates
        ? {
            id: guidance.candidates.id,
            label: guidance.candidates.label,
            count: guidance.candidates.items.length,
            focusedIndex: guidance.candidates.focusedIndex,
            status: guidance.candidates.decision.status,
            confirmedIndex: guidance.candidates.decision.status === 'confirmed'
              ? guidance.candidates.decision.index
              : null,
          }
        : null

      const data: ViewerObserveData = {
        mounted: Boolean(scene?.pose),
        workspace,
        camera: frame && scene?.pose
          ? {
              position: scene.pose.position,
              lookAt: scene.pose.lookAt,
              distanceA: Number(frame.distance.toFixed(2)),
              screenAxes: describeScreenAxes(frame, structure),
              projection: scene.pose.zoom !== undefined ? 'orthographic' : 'perspective',
              viewportSizePx: scene.viewportSizePx,
            }
          : null,
        visible: frame && structure
          ? summarizeVisibleAtoms(frame, structure, { zoom: scene?.pose?.zoom, viewportSizePx: scene?.viewportSizePx, nearCenterLimit })
          : null,
        selection: {
          atomCount: allSelectedIds.length,
          atomIds: selectedIds,
          atomIdsTruncated: allSelectedIds.length > selectedIds.length,
          bondCount: allBondIds.length,
          bondIds: allBondIds.slice(0, selectionAtomLimit),
          bondIdsTruncated: allBondIds.length > selectionAtomLimit,
          faceCount: allFaceIds.length,
          faceIds: allFaceIds.slice(0, selectionAtomLimit),
          faceIdsTruncated: allFaceIds.length > selectionAtomLimit,
          edgeCount: allEdgeIds.length,
          edgeIds: allEdgeIds.slice(0, selectionAtomLimit),
          edgeIdsTruncated: allEdgeIds.length > selectionAtomLimit,
          boxSelectionActive: scene?.boxSelectionActive ?? false,
          centroid: selectionCentroid,
          atoms: selectedAtoms,
        },
        hovered: scene?.hoveredAtomId ? describeAtom(scene.hoveredAtomId) : null,
        lastFocus: scene?.lastFocus ? {
          atomCount: lastFocusAtomIds.length,
          atomIds: lastFocusAtomIds.slice(0, selectionAtomLimit),
          atomIdsTruncated: lastFocusAtomIds.length > selectionAtomLimit,
          center: scene.lastFocus.center,
          ageMs: Date.now() - scene.lastFocus.at,
        } : null,
        candidates,
      }

      const axisText = data.camera?.screenAxes.latticeHints
        ? ` (right≈${data.camera.screenAxes.latticeHints.right ?? '?'}, up≈${data.camera.screenAxes.latticeHints.up ?? '?'}, into-screen≈${data.camera.screenAxes.latticeHints.forward ?? '?'})`
        : ''
      const summary = !data.mounted
        ? `No viewport mounted; ${selectedIds.length} selected`
        : `${workspace ? `${workspace.viewportId} r${workspace.revision}; ` : ''}Camera ${data.camera!.distanceA} Å from look-at${axisText}; ${data.visible?.inFrameCount ?? 0}/${data.visible?.totalCount ?? 0} atoms in frame; ` +
          `selection ${allSelectedIds.length}${allSelectedIds.length > selectedIds.length ? ` (${selectedIds.length} returned)` : ''}${selectedAtoms.length ? ` (${selectedAtoms.slice(0, 3).map((a) => `${a.element}:${a.id}`).join(', ')}${selectedAtoms.length > 3 ? '…' : ''})` : ''}` +
          (data.hovered ? `; hovering ${data.hovered.element}:${data.hovered.id}` : '') +
          (candidates ? `; ${candidates.count} candidates shown` : '')
      return { ok: true, tool: observeManifest.name, summary, data }
    } catch (error) {
      return toolError(observeManifest.name, error)
    }
  },
}

export const CAMERA_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  observeTool,
  lookAtTool,
  setViewTool,
  tourTool,
]
