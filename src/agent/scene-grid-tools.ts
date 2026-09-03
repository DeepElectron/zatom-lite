/**
 * SceneGrid agent tools — a 2.5D semantic perception layer for LLMs.
 *
 * The grid is the reasoning frame (spatial gestalt at low resolution); atom
 * ids inside cells are the execution frame (exact follow-up operations with
 * measure/select/edit tools). All four tools are stateless: identical inputs
 * over the same structure yield identical grids, so a probe can always verify
 * a hypothesis formed from an earlier grid.
 */

import type {
  Vec3,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { createDistanceCalculator } from './structure-math'
import {
  analyzeSystem,
  detectFragments,
  detectLayers,
  hostOnly,
  resolveSurfaceNormal,
  type LayerAnalysis,
  type SystemClassification,
  type SystemFragment,
  type VacuumAxis,
} from '../lib/scene-grid/system-semantics'
import {
  resolveReference,
  SPATIAL_RELATIONS,
  type ReferenceResolution,
  type SpatialRelation,
} from '../lib/scene-grid/reference-resolution'
import {
  buildSceneGrid,
  listSceneGridViews,
  probeSceneCell,
  SCENE_GRID_VIEWS,
  type SceneGridOptions,
  type SceneGridView,
} from '../lib/scene-grid/scene-grid'
import { SCENE_REGIMES, type SceneRegime } from '../lib/scene-grid/regime'
import { findContacts, type ContactResult } from '../lib/scene-grid/contacts'
import { buildResidueIndex, lookupResidue } from '../lib/scene-grid/residue-index'
import { resolveFocus } from '../lib/scene-grid/foveate'
import {
  analyzePeriodicScaffold,
  analyzeSlabLayering,
  type PeriodicScaffold,
  type SlabLayering,
} from '../lib/scene-grid/periodic'
import {
  BURIAL_PROBE_A,
  computeEnclosure,
  computeResidueBurial,
} from '../lib/scene-grid/burial'
import {
  INTERFACE_CUTOFF_A,
  findChainInterfaces,
  renderInterfaces,
} from '../lib/scene-grid/interfaces'
import { findDisulfides, findMetalSites } from '../lib/scene-grid/linkages'
import { findRepeatUnits } from '../lib/scene-grid/repeat-units'
import {
  CHANNEL_ATOM_LIMIT,
  analysisResidueIndex,
  withinChannelLimit,
} from '../lib/scene-grid/scene-analysis'
import { objectSchema, toolError } from './tool-helpers'

const SCENE_GRID_VERSION = '1.0.0'

async function resolveStructure(
  input: Record<string, unknown>,
  context: ZatomToolContext,
): Promise<{ structure: ZatomStructure; fromWorkspace: boolean }> {
  if (input.structure !== undefined) {
    return { structure: parseZatomStructure(input.structure), fromWorkspace: false }
  }
  const structure = await context.readStructure?.()
  if (!structure) {
    throw new ZatomStructureInputError(
      'no_active_structure',
      'No structure was supplied and the active workspace is empty',
    )
  }
  return { structure: parseZatomStructure(structure), fromWorkspace: true }
}

/** Shared view/grid parameter schema fields. */
const viewFields = {
  view: {
    type: 'string',
    enum: SCENE_GRID_VIEWS,
    description:
      'Projection direction. "current" = the user\'s live camera (viewer only); along_a/b/c need a lattice; principal_* use inertia axes (rotation-invariant canonical frame for molecules).',
  },
  resolution: { type: 'integer', minimum: 8, maximum: 64, default: 24 },
  depthBins: { type: 'integer', minimum: 2, maximum: 16, default: 8 },
  topK: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
  depthRange: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: { type: 'number', minimum: 0, maximum: 1 },
    description:
      'Keep only atoms in this normalized depth window (0 = nearest). Example [0, 0.25] shows just the exposed outer layer.',
  },
  regime: {
    type: 'string',
    enum: SCENE_REGIMES,
    description:
      'Override the automatic scale strategy. "molecular" = per-atom elements (small molecules); "biomolecular" = per-residue chain/ligand codes (proteins, where per-atom C/N/O is pure noise); "periodic" = flags atoms deviating from the ideal lattice (perfect crystals, where the information lives in defects/surfaces, not repetition). Omit to let the regime be detected and reported in the output header.',
  },
  focusResidue: {
    type: 'string',
    description:
      'Spend the detail budget on one region, given as a residue key like "HEM C142" or "HIS A93". This adds a high-resolution inset over that region (~10x finer, roughly one atom per cell) while the overview drops to a coarse locator. Use this to answer "how is X bound" instead of re-reading the whole scene.',
  },
  focusAtomIds: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Explicit focus atom ids, as an alternative to focusResidue. Omit both to fall back to the live viewer selection.',
  },
  budget: {
    type: 'integer',
    minimum: 300,
    maximum: 6000,
    description:
      'Hard character ceiling for the whole rendering (default 1800). The renderer degrades resolution and prose until it fits, and reports actual usage, so this is a real ceiling rather than a hint.',
  },
  outline: {
    type: 'boolean',
    description:
      'Include the hierarchical outline (chains, secondary-structure spans, ligands). Defaults to true for proteins, where one outline line summarises dozens of residues.',
  },
}

/** Build SceneGridOptions from validated tool input, wiring the live pose for view=current. */
const gridOptionsFromInput = async (
  input: Record<string, unknown>,
  context: ZatomToolContext,
  fromWorkspace: boolean,
): Promise<{ options: SceneGridOptions; selectedAtomIds: Set<string> }> => {
  const view = input.view as SceneGridView
  const scene = fromWorkspace ? (await context.readViewerScene?.(context.signal) ?? null) : null
  const selectedAtomIds = new Set(scene?.selectedAtomIds ?? [])
  const options: SceneGridOptions = {
    view,
    ...(input.resolution !== undefined ? { resolution: Number(input.resolution) } : {}),
    ...(input.depthBins !== undefined ? { depthBins: Number(input.depthBins) } : {}),
    ...(input.topK !== undefined ? { topK: Number(input.topK) } : {}),
    ...(Array.isArray(input.depthRange)
      ? { depthRange: [Number(input.depthRange[0]), Number(input.depthRange[1])] as [number, number] }
      : {}),
    ...(typeof input.regime === 'string' ? { regime: input.regime as SceneRegime } : {}),
    // Focus is what turns the budget from evenly-wasted into targeted: it adds
    // a high-resolution inset over the region in question. Explicit ids win
    // over a residue key, and both win over the live selection.
    ...(Array.isArray(input.focusAtomIds) && input.focusAtomIds.length > 0
      ? { focusAtomIds: new Set(input.focusAtomIds.map(String)) }
      : {}),
    ...(typeof input.focusResidue === 'string' && input.focusResidue.trim()
      ? { focusResidue: input.focusResidue }
      : {}),
    ...(input.budget !== undefined ? { budget: Number(input.budget) } : {}),
    ...(typeof input.outline === 'boolean' ? { outline: input.outline } : {}),
    pose: scene?.pose ?? null,
    // The selection is the strongest available signal of user intent: whatever
    // is selected is what the conversation is about. Feeding it into the grid
    // (not just probes) lets the focus channel mark those cells inline.
    selectedAtomIds,
  }
  return { options, selectedAtomIds }
}

/* ------------------------------------------------------------------ */
/* scene_observe                                                       */
/* ------------------------------------------------------------------ */

interface SceneObserveFragment {
  id: string
  formula: string
  atomCount: number
  isPeriodicNetwork: boolean
}

interface SceneObserveData {
  atomsTotal: number
  elementCounts: Record<string, number>
  boundingBoxA: { min: [number, number, number]; max: [number, number, number] }
  lattice: { vectors: number[][]; periodic: boolean[] } | null
  system: SystemClassification
  vacuum: VacuumAxis[]
  surfaceNormal: Vec3 | null
  layerCount: number | null
  fragments: SceneObserveFragment[]
  fragmentsTruncated: number
  selection: { count: number; fragmentIds: string[]; layerIndices: number[] }
  recommendedViews: string[]
}

const FRAGMENT_LIST_LIMIT = 20

const sceneObserveManifest: ZatomToolManifest = {
  name: 'scene_observe',
  title: 'Observe scene at a glance',
  version: SCENE_GRID_VERSION,
  description:
    'CALL THIS FIRST on any structure. Cheap, and it answers the questions everything else depends on: what kind of system this is (molecule / crystal / slab / slab-with-adsorbates / 2d-material / interface / defective-crystal, with the evidence that decided it), where the vacuum is, which way the surface normal points, how many host layers there are, which connected fragments exist (F0 = largest; isPeriodicNetwork=true means slab/framework, false means molecule/adsorbate), and which fragments/layers the user\'s current selection falls in. Then drill down with scene_layers, scene_fragments, scene_contacts, or scene_grid instead of reading every atom.',
  inputSchema: objectSchema({ structure: ZATOM_STRUCTURE_JSON_SCHEMA }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'observation', 'agent'],
}

/** Layer index lookup for a set of atom ids, given a layer analysis. */
const layerIndicesOf = (layers: LayerAnalysis | null, ids: Iterable<string>): number[] => {
  if (!layers) return []
  const byAtom = new Map<string, number>()
  for (const layer of layers.layers) for (const id of layer.atomIds) byAtom.set(id, layer.index)
  const out = new Set<number>()
  for (const id of ids) {
    const idx = byAtom.get(id)
    if (idx !== undefined) out.add(idx)
  }
  return [...out].sort((a, b) => a - b)
}

const fragmentIdsOf = (fragments: readonly SystemFragment[], ids: Iterable<string>): string[] => {
  const byAtom = new Map<string, string>()
  for (const f of fragments) for (const id of f.atomIds) byAtom.set(id, f.id)
  const out = new Set<string>()
  for (const id of ids) {
    const f = byAtom.get(id)
    if (f) out.add(f)
  }
  return [...out]
}

const sceneObserveTool: ZatomToolDefinition<SceneObserveData> = {
  manifest: sceneObserveManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const scene = fromWorkspace ? (await context.readViewerScene?.(context.signal) ?? null) : null
      const counts: Record<string, number> = {}
      const min: [number, number, number] = [Infinity, Infinity, Infinity]
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
      for (const atom of structure.atoms) {
        counts[atom.element] = (counts[atom.element] ?? 0) + 1
        for (let i = 0; i < 3; i++) {
          if (atom.position[i] < min[i]) min[i] = atom.position[i]
          if (atom.position[i] > max[i]) max[i] = atom.position[i]
        }
      }
      const scaffold = structure.lattice && structure.atoms.length <= CHANNEL_ATOM_LIMIT
        ? analyzePeriodicScaffold(structure)
        : null
      const semantics = analyzeSystem(structure, { unmatchedAtomIds: scaffold?.unmatchedAtomIds })
      const views = listSceneGridViews(structure, Boolean(scene?.pose))
      const surfaceAxis = structure.lattice && semantics.surfaceNormal
        ? structure.lattice.vectors
          .map((vector, index) => ({
            index,
            alignment: Math.abs(
              (vector[0] * semantics.surfaceNormal![0]
                + vector[1] * semantics.surfaceNormal![1]
                + vector[2] * semantics.surfaceNormal![2])
              / Math.max(1e-12, Math.hypot(...vector) * Math.hypot(...semantics.surfaceNormal!)),
            ),
          }))
          .sort((left, right) => right.alignment - left.alignment)[0]?.index
        : undefined
      const recommended = structure.lattice
        ? surfaceAxis === undefined
          ? ['along_c', 'along_a', 'top']
          : [
            `along_${'abc'[surfaceAxis]}`,
            `along_${'abc'[[0, 1, 2].find((axis) => axis !== surfaceAxis)!]}`,
            scene?.pose ? 'current' : 'top',
          ]
        : structure.atoms.length >= 3
          ? ['principal_xy', 'top']
          : ['top']
      const selected = scene?.selectedAtomIds ?? []
      const data: SceneObserveData = {
        atomsTotal: structure.atoms.length,
        elementCounts: counts,
        boundingBoxA: structure.atoms.length ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] },
        lattice: structure.lattice
          ? { vectors: structure.lattice.vectors.map((v) => [...v]), periodic: [...structure.lattice.periodic] }
          : null,
        system: semantics.system,
        vacuum: semantics.vacuum,
        surfaceNormal: semantics.surfaceNormal,
        layerCount: semantics.layers ? semantics.layers.layers.length : null,
        fragments: semantics.fragments.slice(0, FRAGMENT_LIST_LIMIT).map((f) => ({
          id: f.id,
          formula: f.formula,
          atomCount: f.atomIds.length,
          isPeriodicNetwork: f.isPeriodicNetwork,
        })),
        fragmentsTruncated: Math.max(0, semantics.fragments.length - FRAGMENT_LIST_LIMIT),
        selection: {
          count: selected.length,
          fragmentIds: fragmentIdsOf(semantics.fragments, selected),
          layerIndices: layerIndicesOf(semantics.layers, selected),
        },
        recommendedViews: recommended.filter((r) => views.find((v) => v.view === r)?.available),
      }
      const elementSummary = Object.entries(counts)
        .map(([el, n]) => `${el}x${n}`)
        .join(' ')
      const fragmentSummary = data.fragments
        .slice(0, 4)
        .map((f) => `${f.id}=${f.formula}${f.isPeriodicNetwork ? '*' : ''}`)
        .join(' ')
      return {
        ok: true,
        tool: sceneObserveManifest.name,
        summary:
          `${semantics.system.kind} (${Math.round(semantics.system.confidence * 100)}%): ${structure.atoms.length} atoms (${elementSummary})` +
          (data.layerCount !== null ? `, ${data.layerCount} host layers` : '') +
          (semantics.vacuum.length ? `, vacuum along ${semantics.vacuum.map((v) => 'abc'[v.axis]).join('/')}` : '') +
          `; fragments ${fragmentSummary}${data.fragmentsTruncated ? ` +${data.fragmentsTruncated}` : ''}` +
          (selected.length ? `; selection ${selected.length} atoms in ${data.selection.fragmentIds.join(',') || '?'}` : ''),
        data,
      }
    } catch (error) {
      return toolError(sceneObserveManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_layers                                                        */
/* ------------------------------------------------------------------ */

interface SceneLayersData {
  normal: Vec3
  layers: { index: number; heightA: number; atomCount: number; elementCounts: Record<string, number>; atomIds: string[] }[]
  spacingsA: number[]
  adsorbateAtomIds: string[]
}

const sceneLayersManifest: ZatomToolManifest = {
  name: 'scene_layers',
  title: 'List slab layers',
  version: SCENE_GRID_VERSION,
  description:
    'Split the host (periodic network) into atomic layers along the surface normal. Index 0 is the outermost layer on the vacuum side, so "top layer" = 0, "second/sub-surface layer" = 1, "the layer below X" = X\'s index + 1. Adsorbate atoms are listed separately, not as layers. Pass normal to override the detected surface normal (e.g. for a bulk crystal cut), or toleranceA to merge/split rumpled layers.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    normal: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' }, description: 'Cartesian direction to layer along. Defaults to the detected surface normal (+c for slabs).' },
    toleranceA: { type: 'number', minimum: 0.05, maximum: 3, default: 0.5, description: 'Atoms closer than this along the normal share a layer.' },
    includeAtomIds: { type: 'boolean', default: true },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'slab', 'layers', 'agent'],
}

const sceneLayersTool: ZatomToolDefinition<SceneLayersData> = {
  manifest: sceneLayersManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      const fragments = detectFragments(structure)
      const host = hostOnly(structure, fragments)
      let normal: Vec3 | null = null
      if (Array.isArray(input.normal) && input.normal.length === 3) {
        normal = input.normal.map(Number) as Vec3
      } else {
        normal = resolveSurfaceNormal(structure)?.normal ?? null
      }
      if (!normal) {
        throw new ZatomStructureInputError(
          'no_surface_normal',
          'No slab-like axis found (no aperiodic axis and no vacuum gap). Pass normal explicitly.',
        )
      }
      const tolerance = typeof input.toleranceA === 'number' ? input.toleranceA : 0.5
      const analysis = detectLayers(host, normal, tolerance)
      const hostIds = new Set(host.atoms.map((a) => a.id))
      const includeIds = input.includeAtomIds !== false
      const data: SceneLayersData = {
        normal: analysis.normal,
        layers: analysis.layers.map((l) => ({
          index: l.index,
          heightA: Number(l.heightA.toFixed(3)),
          atomCount: l.atomIds.length,
          elementCounts: l.elementCounts,
          atomIds: includeIds ? l.atomIds : [],
        })),
        spacingsA: analysis.spacingsA.map((s) => Number(s.toFixed(3))),
        adsorbateAtomIds: structure.atoms.filter((a) => !hostIds.has(a.id)).map((a) => a.id),
      }
      return {
        ok: true,
        tool: sceneLayersManifest.name,
        summary: `${data.layers.length} layers along [${analysis.normal.map((x) => x.toFixed(2)).join(', ')}]; layer 0 (top) has ${data.layers[0]?.atomCount ?? 0} atoms${data.spacingsA.length ? `; spacing ${data.spacingsA[0]} A` : ''}${data.adsorbateAtomIds.length ? `; ${data.adsorbateAtomIds.length} adsorbate atoms excluded` : ''}`,
        data,
      }
    } catch (error) {
      return toolError(sceneLayersManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_fragments                                                     */
/* ------------------------------------------------------------------ */

interface SceneFragmentEntry {
  id: string
  formula: string
  atomCount: number
  isPeriodicNetwork: boolean
  centroid: Vec3
  boundingBoxA: { min: Vec3; max: Vec3 }
  atomIds: string[]
  /** Closest approach to any other fragment (periodic minimum image). */
  nearest: { fragmentId: string; distanceA: number; atomIds: [string, string] } | null
}

interface SceneFragmentsData {
  total: number
  offset: number
  fragments: SceneFragmentEntry[]
}

const sceneFragmentsManifest: ZatomToolManifest = {
  name: 'scene_fragments',
  title: 'List connected fragments',
  version: SCENE_GRID_VERSION,
  description:
    'List connected units of the structure (PBC-aware): each fragment\'s formula, atom ids, centroid, bounding box, whether it is a periodic network (slab/framework) or a discrete molecule/adsorbate, and its closest approach to any other fragment. This is how you answer "how far is the CO from the surface" or "which atoms belong to the adsorbate" without reading the whole atom list. Paginated; F0 is the largest fragment.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    includeAtomIds: { type: 'boolean', default: true, description: 'Set false for huge networks; ids can be fetched per fragment later.' },
    maxAtomIdsPerFragment: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'fragments', 'adsorbate', 'agent'],
}

const sceneFragmentsTool: ZatomToolDefinition<SceneFragmentsData> = {
  manifest: sceneFragmentsManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      const fragments = detectFragments(structure)
      const offset = typeof input.offset === 'number' ? input.offset : 0
      const limit = typeof input.limit === 'number' ? input.limit : 20
      const includeIds = input.includeAtomIds !== false
      const idCap = typeof input.maxAtomIdsPerFragment === 'number' ? input.maxAtomIdsPerFragment : 500
      const distance = createDistanceCalculator(structure.lattice)
      const positions = new Map(structure.atoms.map((a) => [a.id, a.position]))
      const page = fragments.slice(offset, offset + limit)
      const entries: SceneFragmentEntry[] = page.map((f) => {
        const min: Vec3 = [Infinity, Infinity, Infinity]
        const max: Vec3 = [-Infinity, -Infinity, -Infinity]
        for (const id of f.atomIds) {
          const p = f.unwrappedPositions[id] ?? positions.get(id)!
          for (let i = 0; i < 3; i++) {
            if (p[i] < min[i]) min[i] = p[i]
            if (p[i] > max[i]) max[i] = p[i]
          }
        }
        // Closest approach: only worth computing when the pair is small enough.
        let nearest: SceneFragmentEntry['nearest'] = null
        if (fragments.length > 1 && f.atomIds.length <= 2000) {
          for (const other of fragments) {
            if (other.id === f.id) continue
            const sampleOther = other.atomIds.length > 2000 ? other.atomIds.slice(0, 2000) : other.atomIds
            for (const a of f.atomIds) {
              const pa = positions.get(a)!
              for (const b of sampleOther) {
                const d = distance(pa, positions.get(b)!)
                if (!nearest || d < nearest.distanceA) nearest = { fragmentId: other.id, distanceA: d, atomIds: [a, b] }
              }
            }
          }
          if (nearest) nearest.distanceA = Number(nearest.distanceA.toFixed(3))
        }
        return {
          id: f.id,
          formula: f.formula,
          atomCount: f.atomIds.length,
          isPeriodicNetwork: f.isPeriodicNetwork,
          centroid: f.centroid.map((x) => Number(x.toFixed(3))) as Vec3,
          boundingBoxA: { min, max },
          atomIds: includeIds ? f.atomIds.slice(0, idCap) : [],
          nearest,
        }
      })
      return {
        ok: true,
        tool: sceneFragmentsManifest.name,
        summary: `${fragments.length} fragments; showing ${entries.map((e) => `${e.id}=${e.formula}${e.isPeriodicNetwork ? '*' : ''}${e.nearest ? ` (${e.nearest.distanceA} A to ${e.nearest.fragmentId})` : ''}`).join(', ')}`,
        data: { total: fragments.length, offset, fragments: entries },
      }
    } catch (error) {
      return toolError(sceneFragmentsManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_grid                                                          */
/* ------------------------------------------------------------------ */

const sceneGridManifest: ZatomToolManifest = {
  name: 'scene_grid',
  title: 'Project scene into a semantic grid',
  version: SCENE_GRID_VERSION,
  description:
    'Project the scene into a low-resolution 2.5D semantic grid. Each cell is a 2-char code: entity + atom count in that cell (e.g. "A7" = chain A, 7 atoms; "h4" = hetero/ligand). The entity depends on the auto-detected regime (reported in the ascii header): per-atom elements for small molecules, per-residue chain codes for proteins, lattice-deviation flags for crystals. Read ascii for spatial gestalt ("what is where"), then use the atom ids in cells for exact follow-up tools. Selected atoms are bracketed [A7] and listed in the focus field. READ THE HEADER FIRST — it carries what the grid cannot: for crystals/slabs a "# lattice:" line (a b c, angles, periodic axes), a "# slab:" line (layer count from the vacuum side, per-layer composition, interlayer spacings), "# sites:" with per-element bulk coordination and the pair cutoffs used, "# <class> ids:" listing the exact atom ids that deviate from bulk (surface/edge/adatom/foreign), and one line per adsorbate/adatom giving its bonded neighbours with distances (e.g. "O:O1 (foreign) CN=1 -> Cu:a12@1.90 A"). For small molecules a "# topology:" block leads with formula, fragments, ring sizes and per-heavy-atom neighbours. A perfect crystal collapses to a small grid on purpose ("# uniform bulk"): there are no deviations to draw, the lattice line is the structure. Two periodic cases deliberately carry NO site classes: "# sites: disordered" (liquid/amorphous/MD snapshot — read the CN mean±sd and first-shell distance instead; do not describe surfaces or adatoms) and "# molecular assembly:" (a periodic box of molecules such as water — units are molecules, read the fragment formulas and counts). NOTE: the grid answers "what is where", NOT "what touches what" — projection collapses depth, so two atoms in one cell can be far apart in 3D. For proximity beyond the header lines use scene_contacts.',
  inputSchema: objectSchema(
    { structure: ZATOM_STRUCTURE_JSON_SCHEMA, ...viewFields },
    ['view'],
  ),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'grid', 'projection', 'agent'],
}

const sceneGridTool: ZatomToolDefinition<ReturnType<typeof buildSceneGrid>> = {
  manifest: sceneGridManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const { options } = await gridOptionsFromInput(input, context, fromWorkspace)
      const grid = buildSceneGrid(structure, options)
      const focusNote = grid.focus
        ? `, focus=${grid.focus.atomCount} selected atom(s) in ${grid.focus.cells.length} cell(s)`
        : ''
      return {
        ok: true,
        tool: sceneGridManifest.name,
        summary: `scene grid ${grid.resolution[0]}x${grid.resolution[1]} view=${grid.view} regime=${grid.regime}: ${grid.cells.length} occupied cells, ${grid.atomsProjected}/${grid.atomsTotal} atoms${focusNote}`,
        data: grid,
      }
    } catch (error) {
      return toolError(sceneGridManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_probe_cell                                                    */
/* ------------------------------------------------------------------ */

const sceneProbeCellManifest: ZatomToolManifest = {
  name: 'scene_probe_cell',
  title: 'Probe one grid cell exactly',
  version: SCENE_GRID_VERSION,
  description:
    'Reproject with the same parameters as a previous scene_grid call and return the complete (never truncated) depth stack of one cell: atom ids, elements, world and fractional coordinates, selection state. This is the bridge from a visual hypothesis to symbolic verification — feed the atom ids into structure_measure_geometry or selection tools.',
  inputSchema: objectSchema(
    {
      structure: ZATOM_STRUCTURE_JSON_SCHEMA,
      ...viewFields,
      x: { type: 'integer', minimum: 0, maximum: 63 },
      y: { type: 'integer', minimum: 0, maximum: 63 },
    },
    ['view', 'x', 'y'],
  ),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'probe', 'verification', 'agent'],
}

const sceneProbeCellTool: ZatomToolDefinition<ReturnType<typeof probeSceneCell>> = {
  manifest: sceneProbeCellManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const { options, selectedAtomIds } = await gridOptionsFromInput(input, context, fromWorkspace)
      const probe = probeSceneCell(structure, options, Number(input.x), Number(input.y), selectedAtomIds)
      return {
        ok: true,
        tool: sceneProbeCellManifest.name,
        summary: probe.stack.length
          ? `cell (${probe.xy[0]}, ${probe.xy[1]}) holds ${probe.stack.length} atom(s): ${probe.stack.map((s) => `${s.element}:${s.atomId}`).join(', ')}`
          : `cell (${probe.xy[0]}, ${probe.xy[1]}) is empty in view=${options.view}`,
        data: probe,
      }
    } catch (error) {
      return toolError(sceneProbeCellManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_contacts                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve the contact focus from the three ways a caller can express it, in
 * priority order: explicit atom ids, a residue label, then the live selection.
 *
 * The residue path matches the label form the viewer and the biomolecular grid
 * both show ("HEM C142"), so a model can quote what it just read back verbatim
 * instead of first translating it into atom ids.
 */
const resolveContactFocus = (
  structure: ZatomStructure,
  input: Record<string, unknown>,
  selectedAtomIds: readonly string[],
): Set<string> => {
  // Delegates to the same resolver `scene_grid` uses, so a residue label read
  // from one tool resolves identically in the other. Only the field names
  // differ (this tool's public schema says `atomIds`/`residue`).
  const index = buildResidueIndex(structure)
  const resolution = resolveFocus(
    {
      ...(Array.isArray(input.atomIds) && input.atomIds.length > 0
        ? { focusAtomIds: new Set(input.atomIds.map((id) => String(id))) }
        : {}),
      ...(typeof input.residue === 'string' && input.residue.trim()
        ? { focusResidue: input.residue }
        : {}),
      selectedAtomIds: new Set(selectedAtomIds),
    },
    (label) => lookupResidue(index, label),
  )
  return new Set(resolution.atomIds)
}

const sceneContactsManifest: ZatomToolManifest = {
  name: 'scene_contacts',
  title: 'List real 3D contacts around a focus',
  version: SCENE_GRID_VERSION,
  description:
    'Answer "what touches what" with true 3D distances — the question scene_grid structurally cannot answer, because projection collapses depth and two atoms in one grid cell may be 40 A apart. Given a focus (the current selection by default, or explicit atom ids / a residue key like "HEM C142"), return neighbours sorted by distance, each labelled with residue identity where available (e.g. "HIS A93 NE2 - Fe 2.10 A"). Honours the minimum-image convention when a lattice is present, so contacts across periodic boundaries are found correctly. Use this for coordination shells, binding sites, hydrogen bonds, adsorbate-surface geometry, and burial.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    atomIds: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Explicit focus atom ids. Omit to use the live viewer selection (the usual case: whatever the user selected is what the conversation is about).',
    },
    residue: {
      type: 'string',
      description:
        'Focus an entire residue or ligand by key, e.g. "HEM C142" or "HIS A93". Matches the labels shown in the viewer and in scene_grid biomolecular output.',
    },
    cutoffA: {
      type: 'number',
      minimum: 0.5,
      maximum: 12,
      default: 4,
      description:
        'Contact cutoff in angstroms. 4 A captures coordination and hydrogen bonds; 6-8 A captures a binding pocket shell.',
    },
    maxContacts: { type: 'integer', minimum: 1, maximum: 200, default: 40 },
    includeIntraResidue: {
      type: 'boolean',
      default: false,
      description:
        'Include neighbours inside the focus residue itself. Default false, because covalent partners within the same residue are usually already known and crowd out the informative external contacts.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'contacts', 'geometry', 'agent'],
}

const sceneContactsTool: ZatomToolDefinition<ContactResult> = {
  manifest: sceneContactsManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const scene = fromWorkspace ? (await context.readViewerScene?.(context.signal) ?? null) : null
      const focusAtomIds = resolveContactFocus(structure, input, scene?.selectedAtomIds ?? [])
      if (focusAtomIds.size === 0) {
        throw new ZatomStructureInputError(
          'empty_contact_focus',
          'No focus atoms: pass atomIds, pass residue (e.g. "HEM C142"), or select atoms in the viewer first',
        )
      }
      const result = findContacts(structure, {
        focusAtomIds,
        ...(input.cutoffA !== undefined ? { cutoff: Number(input.cutoffA) } : {}),
        ...(input.maxContacts !== undefined ? { limit: Number(input.maxContacts) } : {}),
        ...(input.groupByResidue !== undefined
          ? { groupByResidue: Boolean(input.groupByResidue) }
          : {}),
      })
      return {
        ok: true,
        tool: sceneContactsManifest.name,
        summary: result.contacts.length
          ? `${result.totalFound} contact(s) within ${result.cutoff} A of ${result.focusAtomCount} focus atom(s)${result.truncated ? `, showing closest ${result.contacts.length}` : ''}; closest: ${result.contacts[0].fromLabel} - ${result.contacts[0].toLabel} ${result.contacts[0].distance.toFixed(2)} A`
          : `no contacts within ${result.cutoff} A of ${result.focusAtomCount} focus atom(s)`,
        data: result,
      }
    } catch (error) {
      return toolError(sceneContactsManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_grid_views                                                    */
/* ------------------------------------------------------------------ */

const sceneGridViewsManifest: ZatomToolManifest = {
  name: 'scene_grid_views',
  title: 'List available scene-grid views',
  version: SCENE_GRID_VERSION,
  description:
    'List every scene_grid view with its availability for the current structure (lattice present? live viewer pose? enough atoms for principal axes?) so the model never has to discover constraints by trial and error.',
  inputSchema: objectSchema({ structure: ZATOM_STRUCTURE_JSON_SCHEMA }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'views', 'agent'],
}

const sceneGridViewsTool: ZatomToolDefinition<ReturnType<typeof listSceneGridViews>> = {
  manifest: sceneGridViewsManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const scene = fromWorkspace ? (await context.readViewerScene?.(context.signal) ?? null) : null
      const views = listSceneGridViews(structure, Boolean(scene?.pose))
      const available = views.filter((v) => v.available).map((v) => v.view)
      return {
        ok: true,
        tool: sceneGridViewsManifest.name,
        summary: `available views: ${available.join(', ')}`,
        data: views,
      }
    } catch (error) {
      return toolError(sceneGridViewsManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_scaffold                                                      */
/* ------------------------------------------------------------------ */

/**
 * Hard ceiling on reported defect ids.
 *
 * `defectTolerance` is a *fraction*, so on a large slab the unmatched set is
 * legitimately huge: 10% of 200k atoms is 20k ids, which would dwarf every other
 * tool response and blow the context the grid exists to conserve. The count is
 * always exact; only the enumeration is truncated.
 */
const MAX_REPORTED_DEFECTS = 40
const MAX_REPORTED_MISSING_SITES = 12

/** Reporting a thousand layers is not a description of a slab. */
const MAX_REPORTED_LAYERS = 32

interface ScaffoldReport {
  scaffold: PeriodicScaffold | null
  layering: (Omit<SlabLayering, 'layers'> & {
    layers: { position: number; atomCount: number; atomIds: string[] }[]
    layerCount: number
  }) | null
  defectsTruncated: boolean
  missingSitesTruncated: boolean
  layersTruncated: boolean
}

const sceneScaffoldManifest: ZatomToolManifest = {
  name: 'scene_scaffold',
  title: 'Detect supercell repeats, defects, and slab layers',
  version: SCENE_GRID_VERSION,
  description:
    'Answer "what is actually new in this crystal" before reading atoms. A 4x4x4 supercell of fcc Cu is 256 atoms carrying one cell of information, and scene_grid will faithfully render all 256. This reports the repeat multiplicity per lattice axis, atoms that break that repetition, and empty-position hypotheses implied by missing translation partners. A vacancy supported along several repeated axes receives higher confidence; these remain hypotheses until the local environment is inspected. For a slab it also returns the layer stack along the surface normal. Returns nulls rather than guesses for a molecular scene with no lattice.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    tolerance: {
      type: 'number',
      minimum: 0.001,
      maximum: 0.2,
      default: 0.02,
      description:
        'Site-coincidence tolerance as a fraction of a cell edge. 0.02 is ~0.08 A on a 4 A cell. Raise it for relaxed or low-precision coordinates, lower it to distinguish nearly-coincident sites.',
    },
    maxRepeat: {
      type: 'integer',
      minimum: 1,
      maximum: 16,
      default: 16,
      description: 'Largest repeat multiplicity tested per axis.',
    },
    defectTolerance: {
      type: 'number',
      minimum: 0,
      maximum: 0.5,
      default: 0.1,
      description:
        'Fraction of atoms allowed to break the translation match while still calling an axis periodic. This is what lets a supercell containing a vacancy report both its repeats and its defect; set 0 to require a perfect lattice.',
    },
    includeLayering: {
      type: 'boolean',
      default: true,
      description:
        'Include the slab layer stack. Only produced when exactly one lattice axis is aperiodic; a fully periodic bulk has no surface.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'periodic', 'crystal', 'defects', 'agent'],
}

const sceneScaffoldTool: ZatomToolDefinition<ScaffoldReport> = {
  manifest: sceneScaffoldManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      const scaffold = analyzePeriodicScaffold(structure, {
        ...(input.tolerance !== undefined ? { tolerance: Number(input.tolerance) } : {}),
        ...(input.maxRepeat !== undefined ? { maxRepeat: Number(input.maxRepeat) } : {}),
        ...(input.defectTolerance !== undefined
          ? { defectTolerance: Number(input.defectTolerance) }
          : {}),
      })

      const rawLayering =
        input.includeLayering === false ? null : analyzeSlabLayering(structure)

      const defectCount = scaffold?.unmatchedAtomIds.length ?? 0
      const defectsTruncated = defectCount > MAX_REPORTED_DEFECTS
      const missingSitesTruncated = (scaffold?.missingSiteCandidates.length ?? 0) > MAX_REPORTED_MISSING_SITES
      const layersTruncated = (rawLayering?.layers.length ?? 0) > MAX_REPORTED_LAYERS

      const report: ScaffoldReport = {
        scaffold: scaffold
          ? {
              ...scaffold,
              unmatchedAtomIds: scaffold.unmatchedAtomIds.slice(0, MAX_REPORTED_DEFECTS),
              missingSiteCandidates: scaffold.missingSiteCandidates.slice(0, MAX_REPORTED_MISSING_SITES),
            }
          : null,
        layering: rawLayering
          ? {
              axis: rawLayering.axis,
              medianSpacing: rawLayering.medianSpacing,
              reason: rawLayering.reason,
              layerCount: rawLayering.layers.length,
              layers: rawLayering.layers.slice(0, MAX_REPORTED_LAYERS).map((layer) => ({
                position: layer.position,
                atomCount: layer.atomIds.length,
                atomIds: layer.atomIds,
              })),
            }
          : null,
        defectsTruncated,
        missingSitesTruncated,
        layersTruncated,
      }

      const parts: string[] = []
      if (!scaffold) {
        parts.push('no usable lattice: aperiodic scene, nothing to fold')
      } else {
        const [ra, rb, rc] = scaffold.repeats
        parts.push(
          scaffold.isSupercell
            ? `${ra}x${rb}x${rc} supercell (${scaffold.cellCount} primitive cells)`
            : 'primitive cell (no supercell repetition)',
        )
        parts.push(
          defectCount === 0
            ? 'no defects'
            : `${defectCount} defect atom(s)${defectsTruncated ? `, listing ${MAX_REPORTED_DEFECTS}` : ''}`,
        )
        const likelyVacancies = scaffold.missingSiteCandidates.filter((candidate) => candidate.confidence >= 0.5).length
        if (likelyVacancies) parts.push(`${likelyVacancies} localized missing-site hypothesis${likelyVacancies === 1 ? '' : 'es'}`)
      }
      if (report.layering) {
        const axisName = ['a', 'b', 'c'][report.layering.axis]
        const spacing = report.layering.medianSpacing
        parts.push(
          `${report.layering.layerCount} layer(s) along the ${axisName} surface normal${
            spacing !== null ? `, median spacing ${spacing.toFixed(2)} A` : ''
          }`,
        )
      }

      return {
        ok: true,
        tool: sceneScaffoldManifest.name,
        summary: parts.join('; '),
        data: report,
      }
    } catch (error) {
      return toolError(sceneScaffoldManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_burial                                                        */
/* ------------------------------------------------------------------ */

/** Residues listed per burial class. Counts stay exact. */
const MAX_RESIDUES_PER_CLASS = 25

const sceneBurialManifest: ZatomToolManifest = {
  name: 'scene_burial',
  title: 'Residue solvent exposure and pocket enclosure',
  version: SCENE_GRID_VERSION,
  description:
    'Answer "is this residue on the surface" and "is this pocket enclosed" — questions a contact list cannot answer, because contacts say what is nearby, not how much of the surrounding sphere is occupied. Burial is what decides whether a mutation is tolerated, whether a site is druggable, and whether a ligand is solvent-exposed. Residue burial uses a heavy-atom neighbour count in an 8 A sphere (monotone with SASA, no surface tessellation needed). Thresholds are scene-relative terciles and the cut values are returned so you can recalibrate. Pass entityAtomIds to also ray-cast enclosure for a ligand or metal, which distinguishes a buried cavity from a surface groove and reports the pocket mouth direction and depth. When the scene has too little spread to rank three classes it returns separated=false, and intermediate then means "not determined" rather than "middling".',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    probeRadius: {
      type: 'number',
      minimum: 3,
      maximum: 15,
      default: BURIAL_PROBE_A,
      description: 'Neighbour-count sphere radius in Angstrom. 8 is the standard RSA proxy.',
    },
    entityAtomIds: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Atom ids of one entity (ligand, metal, cavity centre) to ray-cast for enclosure. Omit to skip the enclosure pass.',
    },
    maxResiduesPerClass: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: MAX_RESIDUES_PER_CLASS,
      description: 'Cap on residues listed per burial class. Counts remain exact.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'burial', 'surface', 'pocket', 'protein', 'agent'],
}

const sceneBurialTool: ZatomToolDefinition = {
  manifest: sceneBurialManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      if (!withinChannelLimit(structure)) {
        throw new ZatomStructureInputError(
          'scene_too_large',
          `Scene too large for burial analysis: ${structure.atoms.length} atoms exceeds ${CHANNEL_ATOM_LIMIT}`,
        )
      }

      const index = analysisResidueIndex(structure)
      const probeRadius =
        input.probeRadius !== undefined ? Number(input.probeRadius) : BURIAL_PROBE_A
      const burial = computeResidueBurial(structure, index, probeRadius)

      const cap =
        input.maxResiduesPerClass !== undefined
          ? Number(input.maxResiduesPerClass)
          : MAX_RESIDUES_PER_CLASS

      // Most buried first inside each class: that ordering is what makes a
      // truncated list useful rather than an arbitrary slice.
      const ranked = [...burial.byResidueKey.values()].sort(
        (a, b) => b.neighborCount - a.neighborCount,
      )
      const residues: Record<string, { label: string; neighborCount: number }[]> = {
        buried: [],
        intermediate: [],
        exposed: [],
      }
      for (const residue of ranked) {
        const bucket = residues[residue.burial]
        if (bucket.length < cap) {
          bucket.push({ label: residue.label, neighborCount: residue.neighborCount })
        }
      }

      const entityIds = Array.isArray(input.entityAtomIds)
        ? (input.entityAtomIds as unknown[]).map(String)
        : null
      const enclosure =
        entityIds && entityIds.length > 0 ? computeEnclosure(structure, new Set(entityIds)) : null

      const parts: string[] = []
      if (burial.byResidueKey.size === 0) {
        parts.push('no polymer residues with a backbone trace')
      } else {
        parts.push(
          `${burial.counts.buried} buried / ${burial.counts.intermediate} intermediate / ${burial.counts.exposed} exposed`,
        )
        parts.push(
          burial.separated
            ? `cuts: exposed<=${burial.exposedBelow}, buried>=${burial.buriedAbove}`
            : 'no burial contrast in this scene (terciles collapsed); intermediate = undetermined',
        )
      }
      if (enclosure) {
        parts.push(
          `entity ${(enclosure.enclosure * 100).toFixed(0)}% enclosed (${enclosure.site})${
            enclosure.depthA !== null ? `, mouth at ${enclosure.depthA} A` : ''
          }`,
        )
      }

      return {
        ok: true,
        tool: sceneBurialManifest.name,
        summary: parts.join('; '),
        data: {
          probeRadius: burial.probeRadius,
          separated: burial.separated,
          exposedBelow: burial.exposedBelow,
          buriedAbove: burial.buriedAbove,
          counts: burial.counts,
          residueCount: burial.byResidueKey.size,
          residues,
          truncated: burial.byResidueKey.size > cap,
          enclosure,
        },
      }
    } catch (error) {
      return toolError(sceneBurialManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_interfaces                                                    */
/* ------------------------------------------------------------------ */

const sceneInterfacesManifest: ZatomToolManifest = {
  name: 'scene_interfaces',
  title: 'Chain equivalence and chain-chain interfaces',
  version: SCENE_GRID_VERSION,
  description:
    'Read quaternary structure: which chains are copies of each other, and where chains actually touch. A 12-chain capsid described chain by chain is twelve near-identical lines; described as "12 copies of a 153-residue chain" it is one line that says more. Chains are grouped by identical sequence rather than residue count, so two different chains of equal length are not merged. Interfaces come back ranked largest first with participating residue pairs and closest approach — something scene_contacts cannot enumerate, because it works from a focus you already chose and caps at 60 rows. Buried area is an explicit contact-count proxy, not a tessellated SASA: monotone with area, enough to rank interfaces and to separate a crystal contact from a biological one. Returns no interfaces for a single-chain scene.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    cutoff: {
      type: 'number',
      minimum: 2,
      maximum: 8,
      default: INTERFACE_CUTOFF_A,
      description:
        'Heavy-atom contact distance in Angstrom. 4.5 is the standard interface definition.',
    },
    maxInterfaces: {
      type: 'integer',
      minimum: 1,
      maximum: 40,
      default: 8,
      description: 'Cap on interfaces reported, ranked by buried-area proxy.',
    },
    maxPairsPerInterface: {
      type: 'integer',
      minimum: 1,
      maximum: 60,
      default: 12,
      description: 'Cap on residue pairs listed per interface, closest first.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'interface', 'quaternary', 'assembly', 'protein', 'agent'],
}

const sceneInterfacesTool: ZatomToolDefinition = {
  manifest: sceneInterfacesManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      if (!withinChannelLimit(structure)) {
        throw new ZatomStructureInputError(
          'scene_too_large',
          `Scene too large for interface analysis: ${structure.atoms.length} atoms exceeds ${CHANNEL_ATOM_LIMIT}`,
        )
      }

      const index = analysisResidueIndex(structure)
      const result = findChainInterfaces(structure, index, {
        ...(input.cutoff !== undefined ? { cutoff: Number(input.cutoff) } : {}),
        ...(input.maxInterfaces !== undefined
          ? { maxInterfaces: Number(input.maxInterfaces) }
          : {}),
        ...(input.maxPairsPerInterface !== undefined
          ? { maxPairsPerInterface: Number(input.maxPairsPerInterface) }
          : {}),
      })

      const repeats = result.clusters.filter((cluster) => cluster.chainIds.length > 1)
      const parts: string[] = []
      if (!result.multiChain) {
        parts.push('single-chain scene: no chain interfaces')
      } else {
        parts.push(`${result.interfaces.length} interface(s)`)
        if (result.interfaces.length > 0) {
          const top = result.interfaces[0]
          parts.push(
            `largest ${top.chainA}/${top.chainB}: ${top.atomContactCount} contacts, ~${top.buriedAreaProxyA2} A^2 (proxy)`,
          )
        }
      }
      if (repeats.length > 0) {
        parts.push(
          `chain copies: ${repeats
            .map((c) => `${c.chainIds.length}x [${c.chainIds.join(' ')}] ${c.residueCount} res`)
            .join(' | ')}`,
        )
      }

      return {
        ok: true,
        tool: sceneInterfacesManifest.name,
        summary: parts.join('; '),
        data: {
          multiChain: result.multiChain,
          cutoff: result.cutoff,
          interfaces: result.interfaces,
          clusters: result.clusters,
          lines: renderInterfaces(result, true),
        },
      }
    } catch (error) {
      return toolError(sceneInterfacesManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_linkages                                                      */
/* ------------------------------------------------------------------ */

/** Disulfides and metal sites listed. Counts stay exact. */
const MAX_LINKAGES_LISTED = 30

const sceneLinkagesManifest: ZatomToolManifest = {
  name: 'scene_linkages',
  title: 'Disulfide bonds and metal coordination shells',
  version: SCENE_GRID_VERSION,
  description:
    'Find the covalent and coordinative crosslinks that hold a structure together but do not appear in a sequence or a contact list. Disulfides are matched mutually-nearest, so one sulfur can never be given two bonds, and unresolved competition is reported as ambiguousCount rather than silently resolved. Only true cysteine SG atoms count — methionine SD is excluded, because a sulfur in range is not a disulfide. Metal sites report the coordination shell with its donor list, mean donor-metal-donor angle, and a geometry name that comes from the angles, never from the coordination number alone: CN 4 is tetrahedral or square planar and only the angles separate them, so an unsupported shell is called irregular instead of guessed. Alkali and alkaline-earth ions get a wider cutoff since their ionic radii place donors past the 2.6 A window that fits transition metals. Metal-metal contacts are excluded from the coordination number and reported separately as cluster evidence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    include: {
      type: 'string',
      enum: ['both', 'disulfides', 'metals'],
      default: 'both',
      description: 'Restrict the analysis to one linkage class.',
    },
    maxListed: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: MAX_LINKAGES_LISTED,
      description: 'Cap on bonds and sites listed. Counts remain exact.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'disulfide', 'metal', 'coordination', 'protein', 'agent'],
}

const sceneLinkagesTool: ZatomToolDefinition = {
  manifest: sceneLinkagesManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      if (!withinChannelLimit(structure)) {
        throw new ZatomStructureInputError(
          'scene_too_large',
          `Scene too large for linkage analysis: ${structure.atoms.length} atoms exceeds ${CHANNEL_ATOM_LIMIT}`,
        )
      }

      const include = typeof input.include === 'string' ? input.include : 'both'
      const cap = input.maxListed !== undefined ? Number(input.maxListed) : MAX_LINKAGES_LISTED
      const index = analysisResidueIndex(structure)

      const disulfides =
        include === 'metals' ? null : findDisulfides(structure, index)
      const metals = include === 'disulfides' ? null : findMetalSites(structure, index)

      const parts: string[] = []
      if (disulfides) {
        parts.push(
          disulfides.bonds.length === 0
            ? `no disulfides (${disulfides.cysteineSulfurCount} SG, all reduced)`
            : `${disulfides.bonds.length} disulfide(s): ${disulfides.intraChainCount} intra-chain, ${disulfides.interChainCount} inter-chain; ${disulfides.freeCysteineCount} free SG`,
        )
        if (disulfides.ambiguousCount > 0) {
          parts.push(
            `${disulfides.ambiguousCount} ambiguous SG (overlapping candidates; pairing is closest-first, not unique)`,
          )
        }
      }
      if (metals) {
        parts.push(
          metals.metalCount === 0
            ? 'no metals'
            : `${metals.metalCount} metal site(s): ${metals.sites
                .slice(0, 4)
                .map(
                  (site) =>
                    `${site.element}${site.residueLabel ? ` ${site.residueLabel}` : ''} CN=${site.coordinationNumber} ${site.geometry}`,
                )
                .join(', ')}${metals.sites.length > 4 ? ', ...' : ''}`,
        )
        const clustered = metals.sites.filter((site) => site.metalNeighborCount > 0)
        if (clustered.length > 0) {
          parts.push(`${clustered.length} site(s) polynuclear (metal-metal contact)`)
        }
      }

      return {
        ok: true,
        tool: sceneLinkagesManifest.name,
        summary: parts.join('; '),
        data: {
          disulfides: disulfides
            ? {
                bondCount: disulfides.bonds.length,
                interChainCount: disulfides.interChainCount,
                intraChainCount: disulfides.intraChainCount,
                cysteineSulfurCount: disulfides.cysteineSulfurCount,
                freeCysteineCount: disulfides.freeCysteineCount,
                ambiguousCount: disulfides.ambiguousCount,
                bonds: disulfides.bonds.slice(0, cap),
                truncated: disulfides.bonds.length > cap,
              }
            : null,
          metals: metals
            ? {
                metalCount: metals.metalCount,
                sites: metals.sites.slice(0, cap),
                truncated: metals.sites.length > cap,
              }
            : null,
        },
      }
    } catch (error) {
      return toolError(sceneLinkagesManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_repeat_units                                                  */
/* ------------------------------------------------------------------ */

const sceneRepeatUnitsManifest: ZatomToolManifest = {
  name: 'scene_repeat_units',
  title: 'Polymer repeat units and end groups',
  version: SCENE_GRID_VERSION,
  description:
    'Collapse a polymer to its monomer: 400 atoms of polyethylene listed one by one say only "CH2 x50, capped with CH3". Returns period, repeat count, monomer atom ids, and end groups separately, because a real chain is not periodic over its full length: a terminal CH3 has three hydrogens where an interior CH2 has two, so testing the whole backbone finds nothing on almost any real polymer. Substituent elements are part of each site fingerprint, so CH2/CHCl is period 2, not period 1. Fails closed: a non-periodic chain, a ring, or a long ring side group returns no unit rather than a fabricated period. Scope is short substituents (H, halogen, methyl) — the backbone is a graph diameter path, which detours into long side groups, so ring-bearing and aromatic-backbone polymers are declined.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    maxEndTrim: {
      type: 'integer',
      minimum: 0,
      maximum: 6,
      default: 3,
      description:
        'End-group atoms trimmed per side before testing. Large values manufacture a period by discarding most of a short chain.',
    },
    minRepeats: {
      type: 'integer',
      minimum: 2,
      maximum: 10,
      default: 2,
      description: 'Copies required before a period counts as a repeat unit.',
    },
    maxListed: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: MAX_LINKAGES_LISTED,
      description: 'Cap on units listed. Counts remain exact.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['scene', 'perception', 'polymer', 'repeat-unit', 'topology', 'agent'],
}

const sceneRepeatUnitsTool: ZatomToolDefinition = {
  manifest: sceneRepeatUnitsManifest,
  execute: async (input, context) => {
    try {
      const { structure } = await resolveStructure(input, context)
      if (!withinChannelLimit(structure)) {
        throw new ZatomStructureInputError(
          'scene_too_large',
          `Scene too large for repeat-unit analysis: ${structure.atoms.length} atoms exceeds ${CHANNEL_ATOM_LIMIT}`,
        )
      }

      const report = findRepeatUnits(structure, {
        ...(input.maxEndTrim !== undefined ? { maxEndTrim: Number(input.maxEndTrim) } : {}),
        ...(input.minRepeats !== undefined ? { minRepeats: Number(input.minRepeats) } : {}),
      })

      const parts: string[] = []
      if (report.connectivityMissing) {
        // Absent bonds alone do not land here: the bond graph infers connectivity
        // from covalent radii, so a bondless scene is still analysed. This fires
        // when no bond survives that inference, or when the scene is too large
        // for it, so the message must not claim the file simply lacked bonds.
        parts.push(
          `no usable connectivity (bond source: ${report.bondSource}); nothing bonded to analyse`,
        )
      } else if (report.units.length === 0) {
        parts.push(
          `no repeat unit found in ${report.testedCount} testable molecule(s) of ${report.componentCount}`,
        )
      } else {
        parts.push(
          report.units
            .slice(0, 3)
            .map(
              (unit) =>
                `${unit.unitSignature.join('-')} x${unit.repeats} (period ${unit.period}, covers ${unit.backboneCovered}/${unit.backboneLength} backbone)`,
            )
            .join('; '),
        )
        const first = report.units[0]
        const ends = first.leadingEndGroupIds.length + first.trailingEndGroupIds.length
        if (ends > 0) parts.push(`${ends} end-group atom(s) excluded from the unit`)
      }

      // One unit per molecule, so a scene of many separate chains produces many
      // units: 120 short polyethylenes measured 21 KB, and the 250k-atom channel
      // limit allows on the order of 7,800 units. The atom guard above does not
      // bound this, so the listing is capped like every other scene tool while
      // the counts stay exact.
      const cap = input.maxListed !== undefined ? Number(input.maxListed) : MAX_LINKAGES_LISTED

      return {
        ok: true,
        tool: sceneRepeatUnitsManifest.name,
        summary: parts.join('; '),
        data: {
          ...report,
          units: report.units.slice(0, cap),
          unitCount: report.units.length,
          truncated: report.units.length > cap,
        },
      }
    } catch (error) {
      return toolError(sceneRepeatUnitsManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* scene_resolve_reference — user phrase → ranked atoms                */
/* ------------------------------------------------------------------ */

const sceneResolveReferenceManifest: ZatomToolManifest = {
  name: 'scene_resolve_reference',
  title: 'Resolve a spatial reference to atoms',
  version: SCENE_GRID_VERSION,
  description:
    'Turn a user\'s spatial phrase into ranked atom candidates. relation is one of: right/left/up/down/behind/in_front (in the USER\'S screen frame, from the live camera), nearest, bonded_to, along_bond (anchor→secondary direction), between (anchor and secondary), above_surface/below_surface (along the surface normal), same_layer/layer_below/layer_above (slab layers), same_fragment. anchorAtomIds defaults to the current selection, then the hovered atom. Returns candidates sorted by score with a one-line "why" each, plus ambiguity (0 = clear, 1 = tie). If ambiguity > 0.5, DO NOT act: call guide_present_candidates with the top few and ask the user which one.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    relation: { type: 'string', enum: [...SPATIAL_RELATIONS] },
    anchorAtomIds: { type: 'array', items: { type: 'string' }, description: 'Defaults to selection, then hovered atom.' },
    anchorPoint: {
      type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
      description: 'Cartesian point (Å) to anchor on when there is no atom there: a vacancy site, an adsorption-site position, an annotation. Ignored when anchorAtomIds is given. Not valid for bonded_to / same_fragment.',
    },
    secondaryAtomIds: { type: 'array', items: { type: 'string' }, description: 'Required for between / along_bond.' },
    elements: { type: 'array', items: { type: 'string' } },
    withinAtomIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these ids, e.g. a previous candidate set.' },
    limit: { type: 'integer', minimum: 1, maximum: 30, default: 5 },
    maxDistanceA: { type: 'number', minimum: 0.1, maximum: 50 },
  }, ['relation']),
  effects: { structure: 'read', workspace: 'read', visual: 'read' },
  tags: ['scene', 'perception', 'reference', 'selection', 'agent'],
}

const stringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

const sceneResolveReferenceTool: ZatomToolDefinition<ReferenceResolution & { anchorAtomIds: string[] }> = {
  manifest: sceneResolveReferenceManifest,
  execute: async (input, context) => {
    try {
      const { structure, fromWorkspace } = await resolveStructure(input, context)
      const scene = fromWorkspace ? (await context.readViewerScene?.(context.signal) ?? null) : null
      const relation = input.relation as SpatialRelation
      if (!SPATIAL_RELATIONS.includes(relation)) {
        throw new ZatomStructureInputError('unknown_relation', `relation must be one of ${SPATIAL_RELATIONS.join(', ')}`)
      }
      let anchorAtomIds = stringArray(input.anchorAtomIds) ?? []
      const rawPoint = input.anchorPoint
      const anchorPoint = Array.isArray(rawPoint) && rawPoint.length === 3 && rawPoint.every((v) => typeof v === 'number' && Number.isFinite(v))
        ? (rawPoint as Vec3)
        : undefined
      if (!anchorAtomIds.length && !anchorPoint && scene) {
        anchorAtomIds = scene.selectedAtomIds.length
          ? [...scene.selectedAtomIds]
          : scene.hoveredAtomId
            ? [scene.hoveredAtomId]
            : []
      }
      if (!anchorAtomIds.length && !anchorPoint) {
        throw new ZatomStructureInputError(
          'no_anchor',
          'No anchor: pass anchorAtomIds or anchorPoint, or have the user select/hover an atom first (check viewer_observe).',
        )
      }
      const resolution = resolveReference(
        structure,
        {
          relation,
          anchorAtomIds,
          anchorPoint,
          secondaryAtomIds: stringArray(input.secondaryAtomIds),
          elements: stringArray(input.elements),
          withinAtomIds: stringArray(input.withinAtomIds),
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          maxDistanceA: typeof input.maxDistanceA === 'number' ? input.maxDistanceA : undefined,
        },
        { pose: scene?.pose ?? null },
      )
      const top = resolution.candidates.slice(0, 3).map((c) => `${c.element}:${c.atomId} (${c.why})`).join('; ')
      const verdict = resolution.candidates.length === 0
        ? 'no candidates'
        : resolution.ambiguity > 0.5
          ? `AMBIGUOUS (${resolution.ambiguity.toFixed(2)}) — present candidates to the user`
          : `clear (${resolution.ambiguity.toFixed(2)})`
      return {
        ok: true,
        tool: sceneResolveReferenceManifest.name,
        summary: `${relation} of ${anchorAtomIds.length ? `[${anchorAtomIds.slice(0, 3).join(',')}${anchorAtomIds.length > 3 ? '…' : ''}]` : `point (${anchorPoint!.map((v) => v.toFixed(2)).join(', ')})`} in ${resolution.frame} frame: ${verdict}${top ? `; ${top}` : ''}${resolution.note ? `; note: ${resolution.note}` : ''}`,
        data: { ...resolution, anchorAtomIds, anchorPoint: anchorAtomIds.length ? undefined : anchorPoint },
      }
    } catch (error) {
      return toolError(sceneResolveReferenceManifest.name, error)
    }
  },
}

export const SCENE_GRID_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  sceneObserveTool,
  sceneLayersTool,
  sceneFragmentsTool,
  sceneResolveReferenceTool,
  sceneGridTool,
  sceneProbeCellTool,
  sceneContactsTool,
  sceneBurialTool,
  sceneInterfacesTool,
  sceneLinkagesTool,
  sceneRepeatUnitsTool,
  sceneGridViewsTool,
  sceneScaffoldTool,
]
