import { create } from 'zustand'
import { getGlobalBackendClient } from '../host'
import type { BackendService } from '../host'
import { STRUCTURE_TEMPLATE_CIFS } from '../lib/crystal/crystal-template-cifs'
import { MOLECULE_TEMPLATES, FRAGMENT_TEMPLATES } from '../lib/molecule/templates'

/**
 * Installed-templates registry for the modeler's left "structure" panel.
 *
 * The marketplace "Model Market" curates which structure templates (periodic
 * crystals + non-periodic molecules/fragments) appear in the modeler. Default
 * is ALL installed (behaviour unchanged); the user can hide templates and the
 * choice persists per-user via the backend marketplace_installations store
 * (materialise-on-first-change, same as installedToolsStore).
 *
 * Ids are namespaced to avoid collisions: `crystal:<key>` / `molecule:<key>` /
 * `fragment:<key>`. The structure panel + marketplace provider share these ids.
 */

export const MODELS_CATEGORY_ID = 'models'

export const CRYSTAL_TEMPLATE_IDS = Object.keys(STRUCTURE_TEMPLATE_CIFS).map((k) => `crystal:${k}`)
export const MOLECULE_TEMPLATE_IDS = Object.keys(MOLECULE_TEMPLATES).map((k) => `molecule:${k}`)
export const FRAGMENT_TEMPLATE_IDS = Object.keys(FRAGMENT_TEMPLATES).map((k) => `fragment:${k}`)
export const TEMPLATE_ALL: string[] = [
  ...CRYSTAL_TEMPLATE_IDS,
  ...MOLECULE_TEMPLATE_IDS,
  ...FRAGMENT_TEMPLATE_IDS,
]

// Fresh users start with a curated subset (the first few of each kind) so the
// Templates grid isn't bare yet installing more from the Model Market has a
// VISIBLE effect. The full set stays available to install/uninstall.
const BUNDLED_VISUAL_PROJECT_CRYSTALS = [
  'crystal:diamond',
  'crystal:nacl',
  'crystal:perovskite',
  'crystal:sbs6',
  'crystal:rutile',
]

export const TEMPLATE_DEFAULT_INSTALLED: string[] = [
  ...new Set([...CRYSTAL_TEMPLATE_IDS.slice(0, 5), ...BUNDLED_VISUAL_PROJECT_CRYSTALS]),
  ...MOLECULE_TEMPLATE_IDS.slice(0, 4),
  ...FRAGMENT_TEMPLATE_IDS.slice(0, 4),
]

const ALLOWED = new Set<string>(TEMPLATE_ALL)

function backend(): BackendService | null {
  return getGlobalBackendClient()
}

interface InstalledTemplatesState {
  installed: Set<string>
  hydrated: boolean
  materialized: boolean
  materializing: boolean
  ensureHydrated: () => void
  isInstalled: (id: string) => boolean
  add: (id: string) => void
  remove: (id: string) => void
}

/**
 * Persist one change (see installedToolsStore for the full rationale):
 * `materialized` flips true only after the first-curation full-set write
 * succeeds, guarded against concurrent double-materialise and reconciled for
 * changes that land during the await — so a failed write never loses an edit.
 */
async function syncChange(
  get: () => InstalledTemplatesState,
  set: (p: Partial<InstalledTemplatesState>) => void,
  change: { kind: 'add' | 'remove'; id: string },
) {
  const b = backend()
  if (!b) return
  if (get().materialized) {
    try {
      if (change.kind === 'add') await b.installMarketplaceItem({ category: MODELS_CATEGORY_ID, itemId: change.id })
      else await b.uninstallMarketplaceItem(MODELS_CATEGORY_ID, change.id)
    } catch (e) {
      console.error('[installedTemplatesStore] persist failed', change, e)
    }
    return
  }
  if (get().materializing) return
  set({ materializing: true })
  try {
    const snapshot = new Set(get().installed)
    await Promise.all([...snapshot].map((i) => b.installMarketplaceItem({ category: MODELS_CATEGORY_ID, itemId: i })))
    set({ materialized: true, materializing: false })
    const now = get().installed
    for (const id of now) if (!snapshot.has(id)) b.installMarketplaceItem({ category: MODELS_CATEGORY_ID, itemId: id }).catch(() => {})
    for (const id of snapshot) if (!now.has(id)) b.uninstallMarketplaceItem(MODELS_CATEGORY_ID, id).catch(() => {})
  } catch (e) {
    console.error('[installedTemplatesStore] materialise failed; will retry on next change', e)
    set({ materializing: false })
  }
}

export const useInstalledTemplatesStore = create<InstalledTemplatesState>((set, get) => ({
  installed: new Set<string>(TEMPLATE_DEFAULT_INSTALLED), // curated subset; rest install via Model Market
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
    b.listMarketplaceInstallations(MODELS_CATEGORY_ID)
      .then((rows) => {
        if (!rows || rows.length === 0) return // no rows → keep all (not yet materialised)
        const next = new Set<string>()
        for (const r of rows) if (ALLOWED.has(r.itemId)) next.add(r.itemId)
        set({ installed: next, materialized: true })
      })
      .catch((e) => {
        console.error('[installedTemplatesStore] hydrate failed', e)
        set({ hydrated: false }) // transient failure → retry on next call
      })
  },
  isInstalled: (id) => get().installed.has(id),
  add: (id) => {
    if (!ALLOWED.has(id)) return
    const cur = get().installed
    if (cur.has(id)) return
    const next = new Set(cur)
    next.add(id)
    set({ installed: next })
    void syncChange(get, set, { kind: 'add', id })
  },
  remove: (id) => {
    const cur = get().installed
    if (!cur.has(id)) return
    const next = new Set(cur)
    next.delete(id)
    set({ installed: next })
    void syncChange(get, set, { kind: 'remove', id })
  },
}))
