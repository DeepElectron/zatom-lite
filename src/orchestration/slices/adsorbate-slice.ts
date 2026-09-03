/**
 * adsorbate-slice —— state for the Adsorbate Inspector tool (PR-D).
 *
 * Holds:
 *   - adsorbateMode: which sub-mode is active ('auto' | 'manual' | 'dual')
 *   - adsorbateFragment: which template is selected
 *   - detectedSites: cached site list from the last auto-detect pass
 *   - selectedSiteId / selectedSiteIdB: chosen site(s) waiting for placement
 *
 * Actions:
 *   - detectSitesFromAtoms(): scans current atoms, caches sites
 *   - placeFragmentAtSite(siteId): builds a combined extxyz with the chosen
 *     fragment, runs through loadFromXYZ
 *   - placeDualAtSelectedSites(): same but for two sites simultaneously
 *
 * The slice is wired into CrystalStore so the Adsorbate inspector tool can
 * trigger detection / placement.
 */

import type { StateCreator } from 'zustand'
import {
  detectSites as runDetectSites,
  placeFragment as runPlaceFragment,
  placeDualFragments,
  siteFromManualSelection,
  assessSurface,
  detectSurfaceLayer,
  emitAdsorbateExtxyz,
  FRAGMENTS,
  type DetectedSite,
  type AdsorbateAtomInput,
} from '../../lib/analysis/builders/adsorbate'
import type { Fragment } from '../../lib/analysis/builders/adsorbate-fragments'
import { resolveAdsorbateCell, type LatticeRows } from '../../lib/analysis/builders/adsorbate-cell'
import { symbolToAtomicNumber } from '../../chemistry/periodic-table'
import { getGlobalBackendClient } from '../../host'

// Known metal atoms used to distinguish the organic adlayer in a scene.
// Keep this aligned with the backend's _DEFAULT_METAL_ELEMENTS.
const METAL_ATOMIC_NUMBERS = new Set([
  13, 26, 28, 29, 42, 44, 45, 46, 47, 74, 77, 78, 79,
])

/** Infer the scene's dominant metal by frequency for the backend metal_element field. */
function inferMetalElement(atoms: { element: string }[]): string {
  const counts = new Map<string, number>()
  for (const a of atoms) {
    const z = symbolToAtomicNumber(a.element)
    if (METAL_ATOMIC_NUMBERS.has(z)) {
      counts.set(a.element, (counts.get(a.element) || 0) + 1)
    }
  }
  let best = 'Pt'
  let bestCount = 0
  for (const [el, n] of counts) {
    if (n > bestCount) { best = el; bestCount = n }
  }
  return best
}

/** Send scene atoms and detected sites to the backend for exposure classification,
 * then update accessibility, blockedBy, and nearestOrganicDistance. Detection does
 * not wait; the UI receives late results through a store re-render. */
async function annotateSitesViaBackend(
  modelerAtoms: { element: string; cartesian?: [number, number, number]; position?: [number, number, number] }[],
  sites: DetectedSite[],
  generation: number,
  set: (partial: Partial<{ detectedSites: DetectedSite[] }>) => void,
  get: () => { detectedSites: DetectedSite[]; detectionGeneration: number },
): Promise<void> {
  const atomsPayload = modelerAtoms.map((a) => {
    const z = symbolToAtomicNumber(a.element)
    const pos = (a.cartesian ?? a.position ?? [0, 0, 0]) as [number, number, number]
    return { element: z, x: pos[0], y: pos[1], z: pos[2] }
  })
  const sitesPayload = sites.map((s) => ({
    site_id: s.id,
    site_type: s.kind,
    position: s.position,
    atomIndices: s.atomIndices,
  }))
  const metalElement = inferMetalElement(modelerAtoms)
  try {
    const backend = getGlobalBackendClient()
    if (!backend) return  // silent — annotation is optional
    const data = await backend.classifyExposedSites({
      atoms: atomsPayload,
      candidate_sites: sitesPayload,
      metal_element: metalElement,
    })
    const byId = new Map(data.sites.map((s) => [s.site_id, s]))
    // Site IDs are positional and can be reused after redetection. Reject a response
    // from an older generation so exposure data cannot attach to a new structure's
    // same-named site.
    if (get().detectionGeneration !== generation) return
    // Use current store sites because the user may have cleared or redetected them.
    const current = get().detectedSites
    if (current.length === 0) return  // Do not overwrite a user-initiated clear.
    const annotated: DetectedSite[] = current.map((s) => {
      const hit = byId.get(s.id)
      if (!hit) return s
      return {
        ...s,
        accessibility: hit.status === 'blocked' ? 'blocked' : 'exposed',
        blockedBy: hit.blocked_by || [],
        nearestOrganicDistance: hit.nearest_organic_distance_A ?? undefined,
      }
    })
    set({ detectedSites: annotated })
  } catch {
    // Annotation is optional; on network or endpoint failure, the UI falls back to exposed.
  }
}
import { fractionalToCartesian } from '../../lib/crystal/lattice'
import type { LatticeVectors } from '../../lib/crystal/types'
import type { CrystalStore } from '../crystal-store-types'

export type AdsorbateMode = 'auto' | 'manual' | 'dual'
/** 'custom' = user-supplied molecule (e.g. from SMILES). Real Fragment object
 * lives in slice.customFragment; the picker UI shows it as a special tile. */
export type AdsorbateFragmentKey = keyof typeof FRAGMENTS | 'custom'

export interface PlacementOutcome {
  ok: boolean
  message: string
  n_added?: number
}

export interface AdsorbateSlice {
  adsorbateMode: AdsorbateMode
  adsorbateFragment: AdsorbateFragmentKey
  /** Secondary fragment for dual mode. */
  adsorbateFragmentB: AdsorbateFragmentKey
  detectedSites: DetectedSite[]
  /** Reason site detection was rejected, such as a bulk structure without a surface; null if valid. */
  siteDetectionIssue: string | null
  /** Monotonic counter bumped on each detect/clear. Used to discard stale
   * async exposure-annotation responses (see annotateSitesViaBackend). */
  detectionGeneration: number
  selectedSiteId: string | null
  /** Secondary site for dual mode. */
  selectedSiteIdB: string | null
  /** Target separation (Å) for dual mode. */
  dualDistance: number
  /** Outcome of the last placement (for inline feedback in the inspector). */
  lastPlacementOutcome: PlacementOutcome | null
  /** User-supplied fragment (e.g. from SMILES). Used when adsorbateFragment ==
   * 'custom'. Null when no custom molecule has been loaded yet. Note: same
   * Fragment shape as the built-in FRAGMENTS map so the placement code path is
   * unchanged — placeFragment() already accepts a Fragment object directly. */
  customFragment: Fragment | null
  /** Click-to-place mode: when armed, clicking an atom in the viewport places
   * the selected fragment on a site inferred from that atom. Missed clicks
   * (empty space) never reach the atom handler, so camera orbit is untouched. */
  adsorbateClickPlace: boolean

  setAdsorbateMode: (mode: AdsorbateMode) => void
  setAdsorbateFragment: (key: AdsorbateFragmentKey) => void
  setAdsorbateFragmentB: (key: AdsorbateFragmentKey) => void
  /** Set the user-supplied fragment + switch the picker to 'custom'. */
  setCustomFragment: (frag: Fragment | null) => void
  setSelectedSiteId: (id: string | null) => void
  setSelectedSiteIdB: (id: string | null) => void
  setDualDistance: (d: number) => void
  /** Run site detection on the current atom set. */
  detectAdsorbateSites: () => DetectedSite[]
  clearAdsorbateSites: () => void
  /** Place selected fragment at the selected site (Auto mode). */
  placeFragmentAtSite: () => Promise<PlacementOutcome>
  /** Place fragment using the current atom selection (Manual mode). */
  placeFragmentAtManualSelection: () => Promise<PlacementOutcome>
  /** Place both fragments at the two selected sites (Dual mode). */
  placeDualAtSelectedSites: () => Promise<PlacementOutcome>
  /** Toggle click-to-place mode. */
  setAdsorbateClickPlace: (on: boolean) => void
  /** Place the selected fragment on a site inferred from one clicked atom. */
  placeFragmentAtAtom: (atomId: string) => Promise<PlacementOutcome>
}

/** Convert store atoms to AdsorbateAtomInput in true Cartesian coordinates (Å).
 *
 * In periodic crystals, position is fractional rather than Cartesian. Prefer
 * cartesian; otherwise convert position through the lattice. For molecules without
 * a lattice, position is already Cartesian. Treating fractional values as Cartesian
 * would invalidate distance thresholds and mix coordinates with Å-valued offsets.
 */
function atomsToAdsorbateInput(
  atoms: Array<{ element: string; cartesian?: [number, number, number]; position: [number, number, number] }>,
  latticeVectors: LatticeVectors | null | undefined,
): AdsorbateAtomInput[] {
  return atoms.map((a) => {
    if (a.cartesian) {
      return { element: a.element, cartesian: a.cartesian }
    }
    const cart: [number, number, number] = latticeVectors
      ? fractionalToCartesian(a.position, latticeVectors)
      : a.position
    return { element: a.element, cartesian: cart }
  })
}

/** Lattice for site detection, scaled to the supercell without changing vacuum.
 *
 * detectSites needs the actual lattice normal because a slab's stacking axis need
 * not be +z. Using +z could select a cross-section through the slab and place sites
 * inside the bulk. The lattice must also match the supercell atoms; using the unit
 * cell would fold sites into its smaller minimum-image range. vacuumA:0 scales only.
 */
function detectionLattice(state: {
  latticeVectors?: LatticeVectors | null
  supercellParams?: { nx: number; ny: number; nz: number }
}): { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] } | undefined {
  const rows = resolveAdsorbateCell({
    latticeVectors: state.latticeVectors,
    supercell: state.supercellParams,
    atomCartesians: [],
    vacuumA: 0,
  })
  return rows ? { a: rows[0], b: rows[1], c: rows[2] } : undefined
}

/** Cell to emit with an adsorbate structure.
 *
 * Use the supercell-scaled lattice because store latticeVectors describe the unit
 * cell while atoms already contain the full supercell. Emitting the unit cell would
 * shrink the box on reload and leave atoms outside it. Add enough vacuum along the
 * surface normal to keep the adsorbate clear of the next periodic image.
 */
function emitLatticeFor(
  state: { periodic?: boolean; latticeVectors?: LatticeVectors | null; supercellParams?: { nx: number; ny: number; nz: number } },
  baseAtoms: readonly AdsorbateAtomInput[],
  addedAtoms: readonly AdsorbateAtomInput[],
): LatticeRows | undefined {
  if (!state.periodic) return undefined
  const cartesians = [...baseAtoms, ...addedAtoms].map((a) => a.cartesian)
  return resolveAdsorbateCell({
    latticeVectors: state.latticeVectors,
    supercell: state.supercellParams,
    atomCartesians: cartesians,
  })
}

/** Mark the surface-normal c axis as aperiodic after adsorbate placement.
 *
 * Preserve in-plane a/b periodicity, but the vacuum makes c semantically isolated.
 * Keeping c periodic would make the UI draw vertical images despite that vacuum.
 * The lattice grid renders the aperiodic axis as dashed to reflect this state.
 */
function markSurfaceNormalAperiodic(get: () => CrystalStore): void {
  const dirs = get().periodicDirs
  if (dirs && dirs.c === false) return
  get().setPeriodicDirs({ a: dirs?.a ?? true, b: dirs?.b ?? true, c: false })
}

/** Shared placement pipeline for manual selection and click-to-place.
 *
 * Maps atom ids → indices, infers a site (top/bridge/hollow by atom count),
 * places the active fragment, and reloads the scene. Both callers get exactly
 * the same collision handling, lattice emission, and periodicity restore —
 * one code path, no drift between the two entry points.
 */
/** For placement on a bulk crystal, make the clicked anchor layer the surface by
 * cyclically shifting fractional c coordinates to the cell top, then extend c with
 * vacuum. This changes only the periodic origin, preserving bond lengths and layer spacing. */
const AUTO_SLAB_VACUUM = 12 // Å; matches the Slab default and exceeds assessSurface's 5 Å threshold.

type SiteLattice = { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] }

function autoVacuumSlab(
  baseAtoms: readonly AdsorbateAtomInput[],
  lattice: SiteLattice,
  anchorIndices: readonly number[],
): { atoms: AdsorbateAtomInput[]; lattice: SiteLattice } | null {
  const [ax, ay, az] = lattice.a
  const [bx, by, bz] = lattice.b
  const [cx, cy, cz] = lattice.c
  // 3x3 inverse for row vectors: cart = frac · M, with a/b/c as rows of M.
  const det =
    ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  if (Math.abs(det) < 1e-10) return null
  const inv = [
    [(by * cz - bz * cy) / det, (az * cy - ay * cz) / det, (ay * bz - az * by) / det],
    [(bz * cx - bx * cz) / det, (ax * cz - az * cx) / det, (az * bx - ax * bz) / det],
    [(bx * cy - by * cx) / det, (ay * cx - ax * cy) / det, (ax * by - ay * bx) / det],
  ] as const
  const fracs = baseAtoms.map((a) => {
    const [x, y, z] = a.cartesian
    return [
      x * inv[0][0] + y * inv[1][0] + z * inv[2][0],
      x * inv[0][1] + y * inv[1][1] + z * inv[2][1],
      x * inv[0][2] + y * inv[1][2] + z * inv[2][2],
    ] as [number, number, number]
  })
  let anchorFc = 0
  for (const i of anchorIndices) anchorFc += fracs[i][2]
  anchorFc /= anchorIndices.length
  // Shift the anchor layer to fc≈0.98 so it becomes the top layer without splitting
  // same-layer atoms across the 0/1 boundary due to small coordinate jitter.
  const shift = anchorFc + 0.02
  const wrapped = fracs.map(([fa, fb, fc]) => {
    const w = ((fc - shift) % 1 + 1) % 1
    return [fa, fb, w] as [number, number, number]
  })
  const atoms: AdsorbateAtomInput[] = baseAtoms.map((a, i) => {
    const [fa, fb, fc] = wrapped[i]
    return {
      ...a,
      cartesian: [
        fa * ax + fb * bx + fc * cx,
        fa * ay + fb * by + fc * cy,
        fa * az + fb * bz + fc * cz,
      ] as [number, number, number],
    }
  })
  const cLen = Math.hypot(cx, cy, cz)
  if (cLen < 1e-10) return null
  const grow = 1 + AUTO_SLAB_VACUUM / cLen
  return { atoms, lattice: { a: lattice.a, b: lattice.b, c: [cx * grow, cy * grow, cz * grow] } }
}

/** Pure resolution: infer a site from atom IDs and place a fragment without committing
 * store state. Click placement and hover preview share this pipeline so preview matches
 * commit exactly. Bulk crystals become vacuum slabs automatically. */
export interface ResolvedAdsorbatePlacement {
  ok: boolean
  message: string
  baseAtoms?: AdsorbateAtomInput[]
  newAtoms?: AdsorbateAtomInput[]
  siteKind?: string
  emitLattice?: LatticeRows
  autoVacuum?: boolean
  fragLabel?: string
}

export function resolveAdsorbatePlacement(
  state: Pick<CrystalStore, 'atoms' | 'latticeVectors' | 'supercellParams' | 'periodic' | 'adsorbateFragment' | 'customFragment'>,
  atomIds: string[],
  source: 'manual' | 'click',
): ResolvedAdsorbatePlacement {
  const atoms = state.atoms ?? []
  let baseAtoms = atomsToAdsorbateInput(atoms, state.latticeVectors)
  const indices: number[] = []
  for (const sid of atomIds) {
    const idx = atoms.findIndex((a) => a.id === sid)
    if (idx >= 0) indices.push(idx)
  }
  if (indices.length === 0) return { ok: false, message: 'No matching atoms' }
  // A fully periodic bulk structure has no surface. With a lattice, move the anchor
  // layer to the top and extend vacuum along c so the clicked layer becomes the surface.
  let siteLattice = detectionLattice(state)
  let autoVacuum = false
  const gate = assessSurface(siteLattice, baseAtoms.map((a) => a.cartesian))
  if (!gate.ok) {
    if (!siteLattice) return { ok: false, message: gate.message }
    const slab = autoVacuumSlab(baseAtoms, siteLattice, indices)
    if (!slab) return { ok: false, message: gate.message }
    baseAtoms = slab.atoms
    siteLattice = slab.lattice
    autoVacuum = true
  }
  let surfaceUp: [number, number, number] | undefined
  if (siteLattice) {
    // For a slab, selected atoms must be in the exposed top layer or placement would
    // embed the fragment in the bulk. Auto-vacuum anchors already satisfy this condition.
    const layer = detectSurfaceLayer(baseAtoms, { lattice: siteLattice })
    const layerSet = new Set(layer.atomIndices)
    const buried = indices.filter((i) => !layerSet.has(i))
    if (buried.length > 0) {
      return {
        ok: false,
        message:
          source === 'click'
            ? 'Clicked atom is below the exposed surface layer — pick a top-layer atom.'
            : 'Selection includes atoms below the exposed surface layer.',
      }
    }
  } else if (indices.length > 0 && baseAtoms.length >= 2) {
    // Molecules and clusters have no top layer. Use the centroid-to-anchor radial
    // direction as the outward normal so side placement is not forced along +z.
    const centroid: [number, number, number] = [0, 0, 0]
    for (const a of baseAtoms) {
      centroid[0] += a.cartesian[0]
      centroid[1] += a.cartesian[1]
      centroid[2] += a.cartesian[2]
    }
    centroid[0] /= baseAtoms.length
    centroid[1] /= baseAtoms.length
    centroid[2] /= baseAtoms.length
    const anchor: [number, number, number] = [0, 0, 0]
    for (const i of indices) {
      anchor[0] += baseAtoms[i].cartesian[0]
      anchor[1] += baseAtoms[i].cartesian[1]
      anchor[2] += baseAtoms[i].cartesian[2]
    }
    anchor[0] /= indices.length
    anchor[1] /= indices.length
    anchor[2] /= indices.length
    const dir: [number, number, number] = [
      anchor[0] - centroid[0],
      anchor[1] - centroid[1],
      anchor[2] - centroid[2],
    ]
    const len = Math.hypot(dir[0], dir[1], dir[2])
    // When the anchor nearly coincides with the centroid, retain the library's +z fallback.
    if (len > 0.5) surfaceUp = [dir[0] / len, dir[1] / len, dir[2] / len]
  }
  const site = siteFromManualSelection(baseAtoms, indices, { lattice: siteLattice, surface_up: surfaceUp })
  if (!site) {
    return {
      ok: false,
      message: source === 'click' ? 'Clicked atom is not a valid anchor' : 'Manual selection invalid (need 1–3 atoms)',
    }
  }
  const result = runPlaceFragment({
    atoms: baseAtoms,
    site,
    fragment: (state.adsorbateFragment === 'custom' && state.customFragment) ? state.customFragment : (state.adsorbateFragment as keyof typeof FRAGMENTS),
  })
  if (!result.ok) {
    return { ok: false, message: `Collision detected (${result.collision?.distance.toFixed(2)} Å)` }
  }
  const fragLabel = state.adsorbateFragment === 'custom' && state.customFragment
    ? state.customFragment.label
    : state.adsorbateFragment
  // Auto-vacuum must emit the extended lattice; emitLatticeFor would reconstruct the
  // original bulk cell from store state.
  const emitLattice: LatticeRows | undefined = autoVacuum && siteLattice
    ? [siteLattice.a, siteLattice.b, siteLattice.c]
    : emitLatticeFor(state, baseAtoms, result.newAtoms)
  return {
    ok: true,
    message:
      `Placed ${fragLabel} on ${site.kind} site${source === 'click' ? '' : ' (manual)'}` +
      (autoVacuum ? ` · auto-added ${AUTO_SLAB_VACUUM} Å vacuum along c` : ''),
    baseAtoms,
    newAtoms: result.newAtoms,
    siteKind: site.kind,
    emitLattice,
    autoVacuum,
    fragLabel,
  }
}

async function placeAtAtomIds(
  atomIds: string[],
  source: 'manual' | 'click',
  set: (partial: Partial<CrystalStore>) => void,
  get: () => CrystalStore,
): Promise<PlacementOutcome> {
  const state = get()
  const resolved = resolveAdsorbatePlacement(state, atomIds, source)
  if (!resolved.ok || !resolved.baseAtoms || !resolved.newAtoms) {
    const outcome: PlacementOutcome = { ok: false, message: resolved.message }
    set({ lastPlacementOutcome: outcome })
    return outcome
  }
  const xyz = emitAdsorbateExtxyz({
    baseAtoms: resolved.baseAtoms,
    addedAtoms: resolved.newAtoms,
    lattice: resolved.emitLattice,
    comment: `Adsorbate ${resolved.fragLabel} (${source} ${resolved.siteKind})`,
  })
  const wasPeriodic = !!state.periodic
  const loadRes = await get().loadFromXYZ(xyz, { documentMode: 'edit' })
  if (!loadRes.success) {
    const outcome: PlacementOutcome = { ok: false, message: `Load failed: ${loadRes.error}` }
    set({ lastPlacementOutcome: outcome })
    return outcome
  }
  if (wasPeriodic) {
    get().setPeriodic(true)
    markSurfaceNormalAperiodic(get)
  }
  const outcome: PlacementOutcome = {
    ok: true,
    message: resolved.message,
    n_added: resolved.newAtoms.length,
  }
  set({ lastPlacementOutcome: outcome })
  return outcome
}

export const createAdsorbateSlice: StateCreator<CrystalStore, [], [], AdsorbateSlice> = (set, get) => ({
  adsorbateMode: 'auto',
  adsorbateFragment: 'H',
  adsorbateFragmentB: 'H',
  detectedSites: [],
  siteDetectionIssue: null,
  detectionGeneration: 0,
  selectedSiteId: null,
  selectedSiteIdB: null,
  dualDistance: 1.5,
  lastPlacementOutcome: null,
  customFragment: null,
  adsorbateClickPlace: false,

  setAdsorbateMode: (mode) => set({ adsorbateMode: mode }),
  setAdsorbateFragment: (key) => set({ adsorbateFragment: key }),
  setAdsorbateFragmentB: (key) => set({ adsorbateFragmentB: key }),
  setCustomFragment: (frag) => set({ customFragment: frag, adsorbateFragment: frag ? 'custom' : 'H' }),
  setSelectedSiteId: (id) => set({ selectedSiteId: id }),
  setSelectedSiteIdB: (id) => set({ selectedSiteIdB: id }),
  setDualDistance: (d) => set({ dualDistance: d }),

  detectAdsorbateSites: () => {
    const state = get()
    const atoms = state.atoms ?? []
    const input = atomsToAdsorbateInput(atoms, state.latticeVectors)
    // Increment generation on every detect/clear to invalidate in-flight annotation responses.
    const generation = state.detectionGeneration + 1
    if (input.length === 0) {
      set({
        detectedSites: [],
        detectionGeneration: generation,
        selectedSiteId: null,
        selectedSiteIdB: null,
        siteDetectionIssue: null,
      })
      return []
    }
    const result = runDetectSites(input, { lattice: detectionLattice(state) })
    // A bulk structure has no surface; return no sites and let the UI explain that
    // the user must cut a surface and add vacuum first.
    if (!result.ok) {
      set({
        detectedSites: [],
        detectionGeneration: generation,
        selectedSiteId: null,
        selectedSiteIdB: null,
        siteDetectionIssue: result.message,
      })
      return []
    }
    const sites = result.sites
    set({
      detectedSites: sites,
      detectionGeneration: generation,
      selectedSiteId: null,
      selectedSiteIdB: null,
      siteDetectionIssue: null,
    })

    // Phase 2: if an organic adlayer is present, ask the backend asynchronously whether
    // each site is exposed or blocked. Detection returns immediately; the later store
    // patch updates UI colors and filter options through subscriptions.
    const hasOrganic = input.some((a) => {
      const z = symbolToAtomicNumber(a.element)
      return z > 0 && !METAL_ATOMIC_NUMBERS.has(z)
    })
    if (hasOrganic && sites.length > 0) {
      // Fire and forget; generation prevents stale writes.
      void annotateSitesViaBackend(atoms, sites, generation, set, get)
    }
    return sites
  },

  clearAdsorbateSites: () => set((s) => ({
    detectedSites: [],
    detectionGeneration: s.detectionGeneration + 1,
    selectedSiteId: null,
    selectedSiteIdB: null,
    siteDetectionIssue: null,
  })),

  placeFragmentAtSite: async () => {
    const state = get()
    const site = state.detectedSites.find((s) => s.id === state.selectedSiteId)
    if (!site) {
      const outcome: PlacementOutcome = { ok: false, message: 'No site selected' }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    const atoms = state.atoms ?? []
    const baseAtoms = atomsToAdsorbateInput(atoms, state.latticeVectors)
    const result = runPlaceFragment({
      atoms: baseAtoms,
      site,
      fragment: (state.adsorbateFragment === 'custom' && state.customFragment) ? state.customFragment : (state.adsorbateFragment as keyof typeof FRAGMENTS),
    })
    if (!result.ok) {
      const outcome: PlacementOutcome = {
        ok: false,
        message: `Collision detected (${result.collision?.distance.toFixed(2)} Å < ${result.collision?.threshold.toFixed(2)} Å threshold)`,
      }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    const lattice = emitLatticeFor(state, baseAtoms, result.newAtoms)
    const xyz = emitAdsorbateExtxyz({
      baseAtoms,
      addedAtoms: result.newAtoms,
      lattice,
      comment: `Adsorbate ${state.adsorbateFragment} on ${site.kind} site`,
    })
    const wasPeriodic = !!state.periodic
    const loadRes = await get().loadFromXYZ(xyz, { documentMode: 'edit' })
    if (!loadRes.success) {
      const outcome: PlacementOutcome = { ok: false, message: `Load failed: ${loadRes.error}` }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    if (wasPeriodic) {
      get().setPeriodic(true)
      markSurfaceNormalAperiodic(get)
    }
    const outcome: PlacementOutcome = {
      ok: true,
      message: `Placed ${state.adsorbateFragment} on ${site.kind} site`,
      n_added: result.newAtoms.length,
    }
    set({ lastPlacementOutcome: outcome })
    return outcome
  },

  placeFragmentAtManualSelection: async () => {
    const state = get()
    const selectedIds = Array.from(state.selectedAtomIds).slice(0, 3)
    if (selectedIds.length === 0) {
      const outcome: PlacementOutcome = { ok: false, message: 'Select 1–3 surface atoms first' }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    return placeAtAtomIds(selectedIds, 'manual', set, get)
  },

  setAdsorbateClickPlace: (on) => set({ adsorbateClickPlace: on }),

  placeFragmentAtAtom: async (atomId) => {
    return placeAtAtomIds([atomId], 'click', set, get)
  },

  placeDualAtSelectedSites: async () => {
    const state = get()
    const siteA = state.detectedSites.find((s) => s.id === state.selectedSiteId)
    const siteB = state.detectedSites.find((s) => s.id === state.selectedSiteIdB)
    if (!siteA || !siteB) {
      const outcome: PlacementOutcome = { ok: false, message: 'Select two sites for dual placement' }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    if (siteA.id === siteB.id) {
      const outcome: PlacementOutcome = { ok: false, message: 'Pick two distinct sites' }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    const atoms = state.atoms ?? []
    const baseAtoms = atomsToAdsorbateInput(atoms, state.latticeVectors)
    const result = placeDualFragments({
      atoms: baseAtoms,
      siteA,
      siteB,
      fragmentA: (state.adsorbateFragment === 'custom' && state.customFragment) ? state.customFragment : (state.adsorbateFragment as keyof typeof FRAGMENTS),
      fragmentB: (state.adsorbateFragmentB === 'custom' && state.customFragment) ? state.customFragment : (state.adsorbateFragmentB as keyof typeof FRAGMENTS),
      desired_distance: state.dualDistance,
    })
    if (!result.ok) {
      // 0.45-ish Å sub-atomic distance almost always means the two clicked sites
      // were physically too close. Give the user actionable advice in addition to
      // the raw collision distance.
      const which = result.collision?.which ?? 'placement'
      const d = result.collision?.distance ?? 0
      const hint = which === 'B' || which === 'AB'
        ? ` — the two sites land ${result.anchorDistance.toFixed(2)} Å apart; increase Target distance or pick sites further apart.`
        : ''
      const outcome: PlacementOutcome = {
        ok: false,
        message: `Collision on ${which} (${d.toFixed(2)} Å)${hint}`,
      }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    const addedAtoms = [...result.newAtomsA, ...result.newAtomsB]
    const lattice = emitLatticeFor(state, baseAtoms, addedAtoms)
    const xyz = emitAdsorbateExtxyz({
      baseAtoms,
      addedAtoms,
      lattice,
      comment: `Dual adsorbate ${state.adsorbateFragment}+${state.adsorbateFragmentB} d=${result.anchorDistance.toFixed(2)}`,
    })
    const wasPeriodic = !!state.periodic
    const loadRes = await get().loadFromXYZ(xyz, { documentMode: 'edit' })
    if (!loadRes.success) {
      const outcome: PlacementOutcome = { ok: false, message: `Load failed: ${loadRes.error}` }
      set({ lastPlacementOutcome: outcome })
      return outcome
    }
    if (wasPeriodic) {
      get().setPeriodic(true)
      markSurfaceNormalAperiodic(get)
    }
    const enforced = result.shiftedToEnforceDistance ? ' (enforced)' : ''
    const outcome: PlacementOutcome = {
      ok: true,
      message: `Placed dual adsorbate · anchor distance ${result.anchorDistance.toFixed(2)} Å${enforced}`,
      n_added: addedAtoms.length,
    }
    set({ lastPlacementOutcome: outcome })
    return outcome
  },
})
