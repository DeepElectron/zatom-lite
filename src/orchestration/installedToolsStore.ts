import { create } from 'zustand'
import { getGlobalBackendClient } from '../host'
import type { BackendService } from '../host'

/**
 * Installed-tools registry for the modeler's right-panel Functions.
 *
 * The marketplace "Modeling Tools" category curates which inspector functions
 * are available. Core workflow and selection tools are locked and always
 * present. The modeler reads `installed` to filter the
 * Functions list; install/uninstall persist per-user via the backend
 * marketplace_installations store.
 *
 * Persistence: a fresh user keeps the default set in-memory (no backend writes).
 * The first curation "materialises" the full current set to the backend, after
 * which single install/uninstall rows are written/removed. This persists hides
 * of default-installed items without seeding writes for users who never curate.
 */

/** Marketplace category id this store mirrors (= the marketplace category key). */
export const TOOLS_CATEGORY_ID = 'tools'

/** Canonical order of inspector functions (mirrors inspector-panel). */
export const FUNCTION_ORDER = [
  'modeling', 'tools', 'cell', 'super', 'bz', 'measure', 'bond', 'select', 'plane', 'slab',
  'adsorbate', 'overlayer', 'amorphous', 'polymer', 'magnetism', 'porosity',
  'cluster', 'wulff', 'polycrystal', 'dislocation', 'hetero', 'moire', 'nanotube', 'perovskite', 'polysulfide',
  'single-atom', 'dual-atom', 'water', 'mof', 'clip', 'light', 'rdf', 'xrd',
  'ediff', 'convergence', 'ladder', 'export', 'plate', 'scenegrid', 'settings',
] as const

/**
 * Tool families, used **only** to tint a tool's hover state — never to order or
 * regroup the grid. FUNCTION_ORDER above stays the single flat source of order.
 *
 * Colors come from --chart-1..5, which are already defined per theme, so the
 * tints stay legible in light, dark, and auto. Colour is a redundant cue on
 * top of the existing label (never the only way to tell tools apart), so
 * colour-blind users lose nothing.
 */
export const TOOL_FAMILIES = [
  { id: 'core', label: 'Core', color: 'var(--chart-1)', ids: ['modeling', 'tools', 'cell', 'measure', 'bond', 'select', 'settings'] },
  { id: 'symmetry', label: 'Symmetry', color: 'var(--chart-4)', ids: ['super', 'bz', 'plane'] },
  {
    id: 'build', label: 'Build', color: 'var(--chart-3)',
    ids: [
      'slab', 'adsorbate', 'overlayer', 'amorphous', 'polymer', 'cluster', 'wulff', 'polycrystal',
      'dislocation', 'hetero', 'moire', 'nanotube', 'perovskite', 'polysulfide', 'single-atom',
      'dual-atom', 'water', 'mof',
    ],
  },
  { id: 'analyze', label: 'Analyze', color: 'var(--chart-5)', ids: ['magnetism', 'porosity', 'rdf', 'xrd', 'ediff', 'convergence', 'ladder'] },
  { id: 'view', label: 'View', color: 'var(--chart-2)', ids: ['clip', 'light', 'export', 'plate', 'scenegrid'] },
] as const

/** tool id → its family, for tinting. Built once from TOOL_FAMILIES. */
export const TOOL_FAMILY_BY_ID: Record<string, { id: string; label: string; color: string }> =
  Object.fromEntries(
    TOOL_FAMILIES.flatMap((family) =>
      family.ids.map((id) => [id, { id: family.id, label: family.label, color: family.color }]),
    ),
  )

/** Human labels (mirrors inspector-panel functionItems). */
export const TOOL_LABELS: Record<string, string> = {
  modeling: 'Agent', tools: 'Tools', cell: 'Cell', super: 'Symmetry', bz: 'BZ', measure: 'Measure',
  bond: 'Bonds', select: 'Select', plane: 'Plane', slab: 'Slab', adsorbate: 'Adsorbate',
  overlayer: 'Overlayer', amorphous: 'Amorphous', polymer: 'Polymer', magnetism: 'Magnetism',
  porosity: 'Porosity', cluster: 'Cluster', wulff: 'Wulff', polycrystal: 'Polycrystal', dislocation: 'Dislocation', hetero: 'Hetero', moire: 'Moiré',
  nanotube: 'Nanotube', perovskite: 'Perovskite', polysulfide: 'Polysulfide',
  'single-atom': 'Single-atom', 'dual-atom': 'Dual-atom', water: 'Water', mof: 'MOF',
  clip: 'Clip', light: 'Light', rdf: 'g(r)', xrd: 'XRD', ediff: 'eDiff', convergence: 'E/F',
  ladder: 'Ladder', export: 'Export', plate: 'Plate', scenegrid: 'SceneGrid', settings: 'Settings',
}

/**
 * Non-uninstallable core tools (always installed).
 * 'export' must remain available because it is the endpoint of the publication flow.
 * 'settings' must remain available because it is the only Boltz key entry point;
 * removing it would prevent users from configuring or submitting cloud jobs.
 */
export const TOOL_LOCKED: readonly string[] = ['modeling', 'super', 'measure', 'select', 'plane', 'export', 'settings']

/**
 * Max tools a user may have installed at once (reduces panel complexity).
 * Must be at least TOOL_DEFAULT_INSTALLED.length or normalizeInstalled will
 * silently truncate the default set on first launch. The 28 defaults leave two slots.
 */
export const TOOL_MAX = 30

/**
 * Default installed set for a fresh user (≤ TOOL_MAX, includes every locked tool).
 * Keeps core editing + common builders + analysis charts; hides the 10 most
 * specialised builders until explicitly installed.
 */
export const TOOL_DEFAULT_INSTALLED: readonly string[] = [
  'modeling', 'tools', 'cell', 'super', 'bz', 'measure', 'bond', 'select', 'plane', 'slab',
  'adsorbate', 'overlayer', 'cluster', 'hetero', 'moire', 'wulff', 'magnetism',
  'clip', 'light', 'rdf', 'xrd', 'ediff', 'convergence', 'ladder', 'export', 'plate', 'scenegrid', 'settings',
]

const ALLOWED = new Set<string>(FUNCTION_ORDER)

/**
 * Dev-only integrity check. Tool ids are declared in four places (order, labels,
 * locked, defaults); a typo or a tool added to the order but not labelled would
 * otherwise surface as a blank button at runtime. Fails loudly in dev and is a
 * no-op in production.
 */
if (import.meta.env?.DEV) {
  const duplicates = FUNCTION_ORDER.filter((id, i) => FUNCTION_ORDER.indexOf(id) !== i)
  if (duplicates.length > 0) {
    console.error('[zatom] FUNCTION_ORDER has duplicate tool ids:', duplicates)
  }
  const unlabelled = FUNCTION_ORDER.filter((id) => !TOOL_LABELS[id])
  if (unlabelled.length > 0) {
    console.error('[zatom] Tools missing a TOOL_LABELS entry:', unlabelled)
  }
  const unfamilied = FUNCTION_ORDER.filter((id) => !TOOL_FAMILY_BY_ID[id])
  if (unfamilied.length > 0) {
    console.error('[zatom] Tools not assigned to a TOOL_FAMILIES group:', unfamilied)
  }
  const orphanFamilyIds = Object.keys(TOOL_FAMILY_BY_ID).filter((id) => !ALLOWED.has(id))
  if (orphanFamilyIds.length > 0) {
    console.error('[zatom] TOOL_FAMILIES references tool ids absent from FUNCTION_ORDER:', orphanFamilyIds)
  }
  const orphanLabels = Object.keys(TOOL_LABELS).filter((id) => !ALLOWED.has(id))
  if (orphanLabels.length > 0) {
    console.error('[zatom] TOOL_LABELS references tool ids absent from FUNCTION_ORDER:', orphanLabels)
  }
  const unknownLocked = TOOL_LOCKED.filter((id) => !ALLOWED.has(id))
  if (unknownLocked.length > 0) {
    console.error('[zatom] TOOL_LOCKED references unknown tool ids:', unknownLocked)
  }
  const unknownDefaults = TOOL_DEFAULT_INSTALLED.filter((id) => !ALLOWED.has(id))
  if (unknownDefaults.length > 0) {
    console.error('[zatom] TOOL_DEFAULT_INSTALLED references unknown tool ids:', unknownDefaults)
  }
}

function normalizeInstalled(ids: Iterable<string>): Set<string> {
  const next = new Set<string>(TOOL_LOCKED)
  for (const id of ids) {
    if (next.size >= TOOL_MAX) break
    if (ALLOWED.has(id)) next.add(id)
  }
  return next
}

function backend(): BackendService | null {
  return getGlobalBackendClient()
}

interface InstalledToolsState {
  installed: Set<string>
  hydrated: boolean
  /** True once the backend holds the explicit set (after first curation). */
  materialized: boolean
  /** True while the first-curation full-set write is in flight (race guard). */
  materializing: boolean
  ensureHydrated: () => void
  isInstalled: (id: string) => boolean
  isLocked: (id: string) => boolean
  canInstallMore: () => boolean
  add: (id: string) => void
  remove: (id: string) => void
}

/**
 * Persist one change. Before the first curation the full current set is
 * "materialised" to the backend; `materialized` flips to true ONLY after the
 * writes succeed (so a failed write doesn't masquerade as persisted and lose
 * the user's edit on reload). A `materializing` guard prevents a concurrent
 * second change from double-materialising, and a post-write reconcile catches
 * changes that landed during the await.
 */
async function syncChange(
  get: () => InstalledToolsState,
  set: (p: Partial<InstalledToolsState>) => void,
  change: { kind: 'add' | 'remove'; id: string },
) {
  const b = backend()
  if (!b) return
  if (get().materialized) {
    try {
      if (change.kind === 'add') await b.installMarketplaceItem({ category: TOOLS_CATEGORY_ID, itemId: change.id })
      else await b.uninstallMarketplaceItem(TOOLS_CATEGORY_ID, change.id)
    } catch (e) {
      console.error('[installedToolsStore] persist failed', change, e)
    }
    return
  }
  if (get().materializing) return // an in-flight materialise will reconcile the latest set
  set({ materializing: true })
  try {
    const snapshot = new Set(get().installed)
    await Promise.all([...snapshot].map((i) => b.installMarketplaceItem({ category: TOOLS_CATEGORY_ID, itemId: i })))
    set({ materialized: true, materializing: false })
    const now = get().installed // reconcile changes made during the await
    for (const id of now) if (!snapshot.has(id)) b.installMarketplaceItem({ category: TOOLS_CATEGORY_ID, itemId: id }).catch(() => {})
    for (const id of snapshot) if (!now.has(id)) b.uninstallMarketplaceItem(TOOLS_CATEGORY_ID, id).catch(() => {})
  } catch (e) {
    console.error('[installedToolsStore] materialise failed; will retry on next change', e)
    set({ materializing: false }) // leave materialized=false so a later change retries
  }
}

export const useInstalledToolsStore = create<InstalledToolsState>((set, get) => ({
  installed: new Set<string>(TOOL_DEFAULT_INSTALLED),
  hydrated: false,
  materialized: false,
  materializing: false,
  ensureHydrated: () => {
    if (get().hydrated) return
    const b = backend()
    // Client not registered yet → retry on a later call. Don't burn the flag
    // first: a too-early call would skip hydration for the whole session, and
    // the next change would materialise the DEFAULTS wholesale — resurrecting
    // curation the user made on another device. (Same fix as the dag store.)
    if (!b?.listMarketplaceInstallations) return
    set({ hydrated: true })
    b.listMarketplaceInstallations(TOOLS_CATEGORY_ID)
      .then((rows) => {
        if (!rows || rows.length === 0) return // no rows → keep defaults (not yet materialised)
        set({ installed: normalizeInstalled(rows.map((r) => r.itemId)), materialized: true })
      })
      .catch((e) => {
        console.error('[installedToolsStore] hydrate failed', e)
        set({ hydrated: false }) // transient failure → retry on next call
      })
  },
  isInstalled: (id) => get().installed.has(id) || TOOL_LOCKED.includes(id),
  isLocked: (id) => TOOL_LOCKED.includes(id),
  canInstallMore: () => get().installed.size < TOOL_MAX,
  add: (id) => {
    if (!ALLOWED.has(id)) return
    const cur = get().installed
    if (cur.has(id) || cur.size >= TOOL_MAX) return
    const next = new Set(cur)
    next.add(id)
    set({ installed: next })
    void syncChange(get, set, { kind: 'add', id })
  },
  remove: (id) => {
    if (TOOL_LOCKED.includes(id)) return
    const cur = get().installed
    if (!cur.has(id)) return
    const next = new Set(cur)
    next.delete(id)
    set({ installed: next })
    void syncChange(get, set, { kind: 'remove', id })
  },
}))
