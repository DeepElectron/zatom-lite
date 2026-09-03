/**
 * Perception layer: the tools an agent uses to *understand* a scene before
 * acting. Runs headless against a programmatic Cu(111)+CO slab, with a fake
 * viewer scene standing in for the live camera.
 */

import assert from 'node:assert/strict'

import { SCENE_GRID_ZATOM_AGENT_TOOLS } from '../scene-grid-tools'
import { CAMERA_ZATOM_AGENT_TOOLS } from '../camera-tools'
import { GUIDE_ZATOM_AGENT_TOOLS } from '../guide-tools'
import type { Vec3, ZatomToolContext, ZatomViewerScene } from '../contracts'
import { activeViewportGuidanceSurface, focusGuidanceCandidateInViewport } from '../guidance-surface'
import { writeActiveViewportStructure } from '../viewer-context'
import { useAgentGuidance } from '../../orchestration/agentGuidanceStore'
import { getActiveViewportStoreApi } from '../../orchestration/ViewportContext'
import { analyzeSystem, detectFragments } from '../../lib/scene-grid/system-semantics'
import { cu111SlabWithCO, fccCu, water } from './fixtures/cu111-co'

const ALL = [...SCENE_GRID_ZATOM_AGENT_TOOLS, ...CAMERA_ZATOM_AGENT_TOOLS, ...GUIDE_ZATOM_AGENT_TOOLS]
const tool = (name: string) => {
  const t = ALL.find((x) => x.manifest.name === name)
  assert.ok(t, `tool ${name} registered`)
  return t
}

const { structure: slabCO } = cu111SlabWithCO()
const carbon = slabCO.atoms.find((a) => a.element === 'C')!
const oxygen = slabCO.atoms.find((a) => a.element === 'O')!
// The top-site Cu is the one CO was bonded to: the Cu nearest to carbon.
// (The (111) cell is oblique, so "highest z" does not identify it.)
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const topCu = slabCO.atoms
  .filter((a) => a.element === 'Cu')
  .sort((a, b) => dist(a.position, carbon.position) - dist(b.position, carbon.position))[0]

// Camera looking at the carbon from +x, with +z as screen up.
const pose = {
  position: [carbon.position[0] + 30, carbon.position[1], carbon.position[2] + 4] as Vec3,
  lookAt: carbon.position,
  up: [0, 0, 1] as Vec3,
}
let scene: ZatomViewerScene = {
  pose,
  viewportSizePx: [1200, 800],
  selectedAtomIds: [carbon.id],
  selectedBondIds: [],
  selectedFaceIds: [],
  selectedEdgeIds: [],
  boxSelectionActive: false,
  hoveredAtomId: null,
  lastFocus: null,
}
const guidance = activeViewportGuidanceSurface
const ctx: ZatomToolContext = {
  readStructure: async () => slabCO,
  readViewerScene: () => scene,
  guidance,
} as unknown as ZatomToolContext

async function run() {
  {
    const crossing = {
      schemaVersion: 'zatom.structure/v1' as const,
      lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] as [Vec3, Vec3, Vec3], periodic: [true, true, true] as [boolean, boolean, boolean] },
      atoms: [
        { id: 'edge-a', element: 'H', position: [0.2, 0, 0] as Vec3 },
        { id: 'edge-b', element: 'H', position: [9.8, 0, 0] as Vec3 },
      ],
      bonds: [{ id: 'edge-bond', atomIds: ['edge-a', 'edge-b'] as [string, string], order: 1 as const }],
    }
    const fragment = detectFragments(crossing)[0]
    assert.ok(Math.abs(fragment.centroid[0] - 5) > 4, `PBC-unwrapped centroid must stay at the boundary, received ${fragment.centroid[0]}`)
    assert.ok(
      Math.abs(fragment.unwrappedPositions['edge-a'][0] - fragment.unwrappedPositions['edge-b'][0]) < 0.5,
      'finite fragment positions must be unwrapped through the bonded minimum image',
    )
  }
  {
    const many = {
      schemaVersion: 'zatom.structure/v1' as const,
      atoms: Array.from({ length: 6_000 }, (_, index) => ({
        id: `chain-${index}`,
        element: 'C',
        position: [index * 1.4, 0, 0] as Vec3,
      })),
    }
    const fragments = detectFragments(many)
    assert.equal(fragments.length, 1, 'large uncovered structures must not truncate inference at 5,000 atoms')
    assert.equal(fragments[0].atomIds.length, 6_000)
  }
  // --- system semantics -----------------------------------------------------
  {
    const sem = analyzeSystem(slabCO)
    assert.equal(sem.system.kind, 'slab-with-adsorbates')
    assert.equal(sem.layers?.layers.length, 4, 'four Cu layers')
    assert.ok(sem.fragments.length === 2, 'slab + CO')
    assert.ok(sem.fragments[0].isPeriodicNetwork && !sem.fragments[1].isPeriodicNetwork)
    assert.equal(analyzeSystem(water).system.kind, 'molecule')
    assert.equal(analyzeSystem(fccCu).system.kind, 'crystal')
  }

  // --- scene_observe --------------------------------------------------------
  {
    const r = await tool('scene_observe').execute({}, ctx)
    assert.ok(r.ok, JSON.stringify(r))
    const d = r.data as { system: { kind: string }; layerCount: number; selection: { fragmentIds: string[] } }
    assert.equal(d.system.kind, 'slab-with-adsorbates')
    assert.equal(d.layerCount, 4)
    assert.deepEqual(d.selection.fragmentIds, ['F1'], 'selected carbon belongs to the adsorbate fragment')
  }

  // --- scene_layers / scene_fragments --------------------------------------
  {
    const l = await tool('scene_layers').execute({}, ctx)
    assert.ok(l.ok)
    const ld = l.data as { layers: { index: number; atomIds: string[] }[]; adsorbateAtomIds: string[]; spacingsA: number[] }
    assert.ok(ld.layers[0].atomIds.includes(topCu.id), 'layer 0 is the top layer')
    assert.ok(Math.abs(ld.spacingsA[0] - 2.087) < 0.05, 'Cu(111) interlayer spacing')
    assert.deepEqual(new Set(ld.adsorbateAtomIds), new Set([carbon.id, oxygen.id]))

    const f = await tool('scene_fragments').execute({}, ctx)
    assert.ok(f.ok)
    const fd = f.data as { fragments: { id: string; formula: string; nearest: { distanceA: number } | null }[] }
    const co = fd.fragments.find((x) => x.formula === 'CO')!
    assert.ok(co.nearest && co.nearest.distanceA > 1.5 && co.nearest.distanceA < 2.3, 'CO sits ~1.8 A above Cu')
  }

  // --- viewer_observe -------------------------------------------------------
  {
    const r = await tool('viewer_observe').execute({}, ctx)
    assert.ok(r.ok, JSON.stringify(r))
    const d = r.data as { camera: { screenAxes: { up: Vec3; latticeHints: { up: string | null } } }; selection: { atoms: { id: string }[] } }
    assert.ok(d.camera.screenAxes.up[2] > 0.9, 'screen-up is +z')
    assert.equal(d.camera.screenAxes.latticeHints.up, '+c')
    assert.equal(d.selection.atoms[0].id, carbon.id)
  }

  // --- scene_resolve_reference ---------------------------------------------
  {
    const resolve = async (input: Record<string, unknown>) => {
      const r = await tool('scene_resolve_reference').execute(input, ctx)
      assert.ok(r.ok, JSON.stringify(r))
      return r.data as { candidates: { atomId: string; element: string }[]; ambiguity: number; frame: string; anchorAtomIds: string[] }
    }
    // Default anchor is the selection (carbon).
    const below = await resolve({ relation: 'below_surface', elements: ['Cu'] })
    assert.deepEqual(below.anchorAtomIds, [carbon.id])
    assert.equal(below.candidates[0].atomId, topCu.id, 'atom below CO is the top-site Cu')

    const bonded = await resolve({ relation: 'bonded_to', anchorAtomIds: [carbon.id] })
    assert.equal(bonded.candidates[0].atomId, oxygen.id)

    const layerBelow = await resolve({ relation: 'layer_below', anchorAtomIds: [topCu.id], limit: 3 })
    assert.ok(layerBelow.candidates.every((c) => c.element === 'Cu'))
    const layers = (await tool('scene_layers').execute({}, ctx)).data as { layers: { atomIds: string[] }[] }
    assert.ok(layerBelow.candidates.every((c) => layers.layers[1].atomIds.includes(c.atomId)), 'all from layer 1')

    // Screen "up" from carbon is the oxygen, and it is unambiguous.
    const up = await resolve({ relation: 'up', anchorAtomIds: [carbon.id], limit: 3 })
    assert.equal(up.frame, 'screen')
    assert.equal(up.candidates[0].atomId, oxygen.id)
    assert.ok(up.ambiguity < 0.5, `up is clear (${up.ambiguity})`)

    // "right of the top Cu" on a symmetric surface is ambiguous by construction.
    const right = await resolve({ relation: 'right', anchorAtomIds: [topCu.id], elements: ['Cu'], limit: 4 })
    assert.ok(right.candidates.length >= 2)

    // Without a camera the screen frame is unavailable and the tool says so.
    scene = { ...scene, pose: null }
    const noCam = await tool('scene_resolve_reference').execute({ relation: 'left', anchorAtomIds: [carbon.id] }, ctx)
    assert.ok(noCam.ok && /camera|screen/i.test((noCam.data as { note: string }).note ?? ''), 'notes missing camera')
    scene = { ...scene, pose }
  }

  // --- candidates loop ------------------------------------------------------
  {
    // Candidate badges anchor on atoms in the live viewport store, so load
    // the fixture there (still headless: no canvas is mounted).
    await writeActiveViewportStructure(slabCO)
    useAgentGuidance.getState().clear()
    const cus = slabCO.atoms.filter((a) => a.element === 'Cu').slice(0, 3)
    const shown = await tool('guide_present_candidates').execute(
      {
        label: 'Which Cu?',
        items: cus.map((c, i) => ({
          atomIds: [c.id],
          label: `Cu ${i + 1}`,
          ...(i === 1 ? { position: [9.9, 8.8, 7.7] } : {}),
        })),
      },
      ctx,
    )
    assert.ok(shown.ok, JSON.stringify(shown))
    const obs = (await tool('viewer_observe').execute({}, ctx)).data as { candidates: { count: number; focusedIndex: number | null } }
    assert.equal(obs.candidates.count, 3)
    assert.equal(obs.candidates.focusedIndex, null)

    const focus = await tool('guide_focus_candidate').execute({ index: 2 }, ctx)
    assert.ok(focus.ok)
    assert.deepEqual((focus.data as { focused: { atomIds: string[] } }).focused.atomIds, [cus[1].id])
    assert.deepEqual(useAgentGuidance.getState().candidates?.items[1].position, [9.9, 8.8, 7.7])
    assert.ok(getActiveViewportStoreApi().getState().selectedAtomIds.has(cus[1].id), 'candidate focus must apply the real selection')

    const api = getActiveViewportStoreApi()
    await api.getState().updateAtomPosition(cus[0].id, [cus[0].position[0] + 0.1, ...cus[0].position.slice(1)] as Vec3)
    let staleClick: unknown = null
    try {
      focusGuidanceCandidateInViewport(1, api)
    } catch (error) {
      staleClick = error
    }
    assert.equal((staleClick as Error & { code?: string })?.code, 'stale_candidates')
    assert.equal(
      useAgentGuidance.getState().candidates?.decision.status,
      'stale',
      'a UI badge click must retain an explicit stale decision for the Agent to read',
    )

    const bad = await tool('guide_focus_candidate').execute({ index: 9 }, ctx)
    assert.ok(!bad.ok)

    const cleared = await tool('guide_clear').execute({ scope: 'candidates' }, ctx)
    assert.ok(cleared.ok)
    assert.equal((cleared.data as { candidates: unknown }).candidates, null)
  }

  console.log('perception-tools: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
