/**
 * One catalog of every bundled, directly loadable model, plus the single load
 * path for each kind.
 *
 * Two surfaces consume this: the Structure panel's Templates grids (which show
 * only the subset installed via the Model Market) and the Assets ▸ Store
 * browser (which shows everything). They previously duplicated the load
 * sequences — badge derivation, bond re-attachment for molecules, which asset
 * name gets recorded, and which follow-up runs — so a fix in one silently skipped the
 * other. Both now call `loadModelCatalogEntry`, so a model loads identically
 * no matter which surface it was clicked from.
 *
 * FRAGMENT_TEMPLATES is deliberately absent: fragments are attachment groups
 * for the build tool whose first atom is a bonding site, not standalone
 * structures, and there is no existing path that loads one as a document.
 */

import { useSyncExternalStore } from "react"
import { getCrystalTemplateNames, STRUCTURE_TEMPLATE_CIFS } from "../../lib/crystal/crystal-template-cifs"
import {
  deleteCustomFragment,
  getCustomFragmentsSnapshot,
  subscribeCustomFragments,
  type CustomFragment,
} from "../../lib/molecule/custom-fragments"
import { atomicNumberToSymbol } from "../../lib/crystal/elements"
import { exportToCIF } from "../../lib/crystal/cif-parser"
import { latticeParamsFromMatrix } from "../../lib/crystal/lattice"
import { frameFormula } from "../../lib/molecule/frame-to-template"
import {
  getWorkspaceFramesSnapshot,
  subscribeWorkspaceFrames,
} from "../../host/localWorkspace"
import type { WorkspaceFrame } from "../../host/ports"
import { useInstalledTemplatesStore } from "../../orchestration/installedTemplatesStore"
import {
  BIOMOLECULE_TRAJECTORY_EXAMPLES,
  RCSB_BIOMOLECULE_EXAMPLES,
} from "../../lib/biomolecule/examples"
import {
  MOLECULE_TEMPLATES,
  createBondsFromMoleculeTemplate,
} from "../../lib/molecule/templates"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

export type ModelCatalogKind = "crystal" | "molecule" | "biomolecule" | "trajectory" | "user"

/**
 * Where an entry came from, which is what decides how it can be removed.
 *
 * The Templates grid shows both kinds side by side in one grid, so a card cannot
 * ask "am I in localStorage or in the marketplace registry?" without knowing
 * about both backends. It reads this flag and calls `removeCatalogEntry`, which
 * owns the routing.
 */
export type ModelCatalogOrigin = "bundled" | "user" | "workspace"

export interface ModelCatalogEntry {
  /** Namespaced id. For crystals/molecules it equals the Model Market item id. */
  id: string
  kind: ModelCatalogKind
  origin: ModelCatalogOrigin
  /** Template key for crystals/molecules, PDB id for biomolecules/trajectories. */
  key: string
  name: string
  /** Formula, source id, or one-line description — the row's second line. */
  detail: string
  format: string
  badge: string
  badgeKey: string
  /** Wide badges hold 4-character PDB ids; narrow ones hold element symbols. */
  wideBadge: boolean
  /**
   * Set only for kinds the Model Market curates (crystals, molecules). The
   * Templates grids filter on it; the Store uses it to mark what is already
   * installed rather than to hide anything.
   */
  installedId?: string
  /** Pre-lowercased haystack so filtering never re-derives it per keystroke. */
  search: string
}

const BADGE_PALETTE_SIZE = 8

/** Stable per-key hue so the same model keeps its colour across both surfaces. */
export function badgeColor(key: string): string {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  return `var(--badge-${hash % BADGE_PALETTE_SIZE})`
}

export function mainElement(formula: string): string {
  const match = formula.match(/[A-Z][a-z]?/)
  return match ? match[0] : (formula.replace(/[^A-Za-z]/g, "").slice(0, 2) || "?")
}

export function formulaInParens(name: string): string {
  return name.match(/\(([^)]+)\)/)?.[1] ?? name
}

function entry(
  parts: Omit<ModelCatalogEntry, "search" | "origin">
    & { searchExtra?: string; origin?: ModelCatalogOrigin },
): ModelCatalogEntry {
  const { searchExtra = "", origin = "bundled", ...rest } = parts
  return {
    ...rest,
    origin,
    search: `${rest.name} ${rest.detail} ${rest.key} ${rest.format} ${searchExtra}`.toLowerCase(),
  }
}

function crystalEntries(): ModelCatalogEntry[] {
  return getCrystalTemplateNames().map((key) => {
    const template = STRUCTURE_TEMPLATE_CIFS[key]
    const detail = template.source.kind === "materials-project"
      ? template.source.id
      : template.source.note
    return entry({
      id: `crystal:${key}`,
      kind: "crystal",
      key,
      name: template.name,
      detail,
      format: "CIF",
      badge: mainElement(formulaInParens(template.name)),
      badgeKey: key,
      wideBadge: false,
      installedId: `crystal:${key}`,
      searchExtra: `crystal periodic material ${formulaInParens(template.name)}`,
    })
  })
}

function moleculeEntries(): ModelCatalogEntry[] {
  return Object.entries(MOLECULE_TEMPLATES).map(([key, template]) => entry({
    id: `molecule:${key}`,
    kind: "molecule",
    key,
    name: template.name,
    detail: template.formula,
    format: `XYZ · ${template.formula}`,
    badge: mainElement(template.formula),
    badgeKey: key,
    wideBadge: false,
    installedId: `molecule:${key}`,
    searchExtra: "molecule non-periodic",
  }))
}

function biomoleculeEntries(): ModelCatalogEntry[] {
  return RCSB_BIOMOLECULE_EXAMPLES.map((example) => entry({
    id: `biomolecule:${example.id}`,
    kind: "biomolecule",
    key: example.id,
    name: example.label,
    detail: example.description,
    format: "PDB",
    badge: example.id,
    badgeKey: example.id,
    wideBadge: true,
    searchExtra: "biomolecule protein rcsb pdb",
  }))
}

function trajectoryEntries(): ModelCatalogEntry[] {
  return BIOMOLECULE_TRAJECTORY_EXAMPLES.map((example) => entry({
    id: `trajectory:${example.id}`,
    kind: "trajectory",
    key: example.id,
    name: `${example.id} · ${example.label}`,
    detail: example.description,
    format: "PDB · multi-MODEL",
    badge: `${example.frames}f`,
    badgeKey: example.id,
    wideBadge: true,
    searchExtra: `trajectory ensemble frames multi-model ${example.frames}`,
  }))
}

/**
 * Structures the user saved from the 2D editor. Unlike the four bundled sources
 * these change at runtime, so they are built on demand rather than at module
 * load, and carry no `installedId`: the Model Market curates what ships with the
 * app, and it has no say over the user's own work. Something you saved is
 * visible because you saved it.
 */
function userEntries(fragments: readonly CustomFragment[]): ModelCatalogEntry[] {
  return fragments
    .filter((fragment) => (fragment.atoms?.length ?? 0) > 0)
    .map((fragment) => {
      const formula = fragment.formula ?? ""
      const atomCount = fragment.atoms?.length ?? 0
      return entry({
        id: `user:${fragment.id}`,
        kind: "user",
        origin: "user",
        key: fragment.id,
        name: fragment.name,
        detail: formula || `${atomCount} atoms`,
        format: `Saved · ${formula || `${atomCount} atoms`}`,
        badge: formula ? mainElement(formula) : "★",
        badgeKey: fragment.id,
        wideBadge: false,
        searchExtra: `saved custom mine my library 2d sketch ${fragment.smiles ?? ""}`,
      })
    })
}

/** Built once at module load: every source here is a static bundled constant. */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  ...crystalEntries(),
  ...moleculeEntries(),
  ...biomoleculeEntries(),
  ...trajectoryEntries(),
]

/**
 * The full catalog: bundled models plus whatever the user has saved. Callers that
 * need to react to saves should use `useModelCatalog`; this is the imperative
 * equivalent for non-React code.
 */
/**
 * Batch assets as catalog rows.
 *
 * These are searchable but *not* saved: a batch is scratch space, so an asset
 * can be renamed or deleted out from under a search result at any time. They
 * are surfaced anyway because being unable to find work you just built is the
 * actual complaint; the `workspace` origin lets the row say so and offer the
 * promotion instead of pretending to be a library entry.
 */
function workspaceEntries(
  frames: readonly WorkspaceFrame[],
): readonly ModelCatalogEntry[] {
  return frames
    .filter((frame) => frame.atoms.length > 0)
    .map((frame) => {
      const formula = frame.meta?.formula || frameFormula(frame)
      return entry({
        id: `workspace:${frame.id}`,
        kind: "user",
        origin: "workspace",
        key: frame.id,
        name: frame.label,
        detail: formula || `${frame.atoms.length} atoms`,
        format: `In batch · ${frame.atoms.length} atoms`,
        badge: mainElement(formula || frame.label),
        /**
         * Keyed by frame id, not by name. Two assets captured from the same
         * template share a label, and a name-keyed badge would give them the
         * same colour — removing the one visual cue that tells them apart.
         */
        badgeKey: frame.id,
        wideBadge: false,
        searchExtra: `batch asset workspace ${formula}`,
      })
    })
}

export function getModelCatalog(): readonly ModelCatalogEntry[] {
  return [
    ...MODEL_CATALOG,
    ...userEntries(getCustomFragmentsSnapshot()),
    ...workspaceEntries(getWorkspaceFramesSnapshot()),
  ]
}

/**
 * Merged catalog as a React value, recomputed when the user library changes.
 *
 * The merge is memoised on the fragments array identity rather than done inside
 * `getSnapshot`, because `useSyncExternalStore` requires a referentially stable
 * snapshot and would otherwise loop forever on the fresh array a merge returns.
 */
let mergeCacheKey: readonly CustomFragment[] | null = null
let mergeFramesKey: readonly WorkspaceFrame[] | null = null
let mergeCacheValue: readonly ModelCatalogEntry[] = MODEL_CATALOG

/** Server snapshot: localStorage does not exist during SSR, so there is no user library. */
const EMPTY_FRAGMENTS: readonly CustomFragment[] = []

/** Same for the workspace: IndexedDB is browser-only. */
const EMPTY_FRAMES: readonly WorkspaceFrame[] = []

export function useModelCatalog(): readonly ModelCatalogEntry[] {
  const fragments = useSyncExternalStore(
    subscribeCustomFragments,
    getCustomFragmentsSnapshot,
    () => EMPTY_FRAGMENTS,
  )
  /**
   * Second store, because the two live in different backends: saved structures
   * are in localStorage, batch assets are in IndexedDB. Subscribing to only one
   * means the grid silently goes stale for the other.
   */
  const frames = useSyncExternalStore(
    subscribeWorkspaceFrames,
    getWorkspaceFramesSnapshot,
    () => EMPTY_FRAMES,
  )
  if (mergeCacheKey !== fragments || mergeFramesKey !== frames) {
    mergeCacheKey = fragments
    mergeFramesKey = frames
    mergeCacheValue = [
      ...MODEL_CATALOG,
      ...userEntries(fragments),
      ...workspaceEntries(frames),
    ]
  }
  return mergeCacheValue
}

/** Use the same visible category vocabulary as structure imports while retaining the internal biomolecule key. */
export const MODEL_CATALOG_KIND_LABELS: Record<ModelCatalogKind, string> = {
  crystal: "Crystals",
  molecule: "Molecules",
  biomolecule: "Macromolecules",
  trajectory: "Trajectories",
  user: "My structures",
}

export interface ModelLoadOutcome {
  ok: boolean
  /**
   * What the caller should write to the structure-asset ledger. Recording needs
   * React context, so the loader reports the entry instead of writing it.
   */
  asset?: { name: string; source: "template" | "import" }
  message?: string
  error?: string
}

/** Mirrors the crystal path: CIF text through the store's own template loader. */
async function loadCrystal(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  const result = await useCrystalStore.getState().loadTemplate(catalogEntry.key)
  if (!result.success) return { ok: false, error: result.error }
  return {
    ok: true,
    asset: { name: catalogEntry.name, source: "template" },
    message: `Loaded ${catalogEntry.name}`,
  }
}

/**
 * Molecules load as XYZ, which carries no bond orders, so the template's
 * explicit bond list is re-applied afterwards — otherwise double and triple
 * bonds would come back as inferred single bonds.
 */
async function loadMolecule(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  const template = MOLECULE_TEMPLATES[catalogEntry.key]
  if (!template) return { ok: false, error: `Unknown molecule template ${catalogEntry.key}` }
  const result = await useCrystalStore.getState().loadFromXYZ(template.xyz)
  if (!result.success) return { ok: false, error: result.error }

  const loadedStore = useCrystalStore.getState()
  const explicitBonds = createBondsFromMoleculeTemplate(catalogEntry.key, loadedStore.atoms)
    .map((bond, index) => ({ id: `bond-${Date.now()}-${index}`, ...bond }))
  if (explicitBonds.length > 0) {
    loadedStore.setBondsDirectly(explicitBonds as Parameters<typeof loadedStore.setBondsDirectly>[0])
  }
  return {
    ok: true,
    asset: { name: `${template.name}.xyz`, source: "template" },
    message: `Loaded ${template.name}`,
  }
}

/**
 * Load a structure the user saved from the 2D editor.
 *
 * Deliberately the same two-step sequence as `loadMolecule` — XYZ text through
 * the store's loader, then the explicit bond list re-applied by index — rather
 * than pushing atoms in directly. XYZ carries no bond orders, so without the
 * second step a saved aromatic ring would come back as inferred single bonds.
 * Reusing this path also means user structures and bundled molecules cannot
 * drift apart in how they land in the store.
 */
/**
 * The one place that puts a user-authored structure into the store.
 *
 * Saved structures and workspace assets used to each carry their own copy of
 * this sequence. They were identical apart from where the atoms came from, and
 * the duplication is what allowed periodicity handling to be added to one and
 * missed in the other. Both now funnel through here, so a cell either survives
 * for both or for neither.
 *
 * The cell decides the format: a periodic structure goes through CIF, which can
 * express a unit cell, while XYZ cannot. Routing a crystal through XYZ is what
 * made saved crystals reappear as loose molecules — the atoms arrived intact,
 * so nothing failed loudly; the structure had simply stopped being a crystal.
 */
async function loadPortableStructure(input: {
  label: string
  atoms: readonly { element: string; position: readonly [number, number, number] }[]
  bonds?: readonly { from: number; to: number; type: string }[]
  latticeMatrix?: readonly (readonly number[])[]
}): Promise<ModelLoadOutcome> {
  const { label, atoms, bonds, latticeMatrix } = input
  const store = useCrystalStore.getState()

  const latticeParams = latticeMatrix ? latticeParamsFromMatrix(latticeMatrix) : null

  const result = latticeParams
    ? await store.loadFromCIF(
        exportToCIF({
          name: label,
          latticeParams,
          // exportToCIF converts Cartesian to fractional itself, so the stored
          // Cartesian coordinates are handed over untouched.
          atoms: atoms.map(({ element, position }) => ({
            element,
            cartesian: [position[0], position[1], position[2]] as [number, number, number],
          })),
        }),
      )
    : await store.loadFromXYZ(
        [
          String(atoms.length),
          label,
          ...atoms.map(({ element, position }) =>
            `${element} ${position[0].toFixed(6)} ${position[1].toFixed(6)} ${position[2].toFixed(6)}`),
        ].join("\n"),
      )

  if (!result.success) return { ok: false, error: result.error }

  /**
   * Bond orders are reapplied by index because neither format carries them.
   * CIF reorders sites by element while grouping them, so indices are only
   * meaningful for the XYZ path; for a periodic structure the loader infers
   * bonds from the cell and its neighbour images, which is the better answer
   * anyway.
   */
  const loadedStore = useCrystalStore.getState()
  if (!latticeParams && bonds?.length) {
    const explicitBonds = bonds
      .filter((bond) => loadedStore.atoms[bond.from] && loadedStore.atoms[bond.to])
      .map((bond, index) => ({
        id: `bond-${Date.now()}-${index}`,
        atom1Id: loadedStore.atoms[bond.from].id,
        atom2Id: loadedStore.atoms[bond.to].id,
        type: bond.type,
      }))
    if (explicitBonds.length > 0) {
      loadedStore.setBondsDirectly(explicitBonds as Parameters<typeof loadedStore.setBondsDirectly>[0])
    }
  }

  return {
    ok: true,
    asset: { name: `${label}.${latticeParams ? "cif" : "xyz"}`, source: "template" },
    message: `Loaded ${label}`,
  }
}

async function loadUserStructure(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  /**
   * Both saved structures and batch assets present as `kind: "user"` — they are
   * the same thing to a user ("something I made") and belong in one section of
   * the grid. They diverge only in storage, so the origin picks the reader here
   * rather than fragmenting the kind taxonomy over an implementation detail.
   */
  if (catalogEntry.origin === "workspace") {
    return await loadWorkspaceFrame(catalogEntry)
  }
  const fragment = getCustomFragmentsSnapshot().find((item) => item.id === catalogEntry.key)
  if (!fragment?.atoms?.length) {
    return { ok: false, error: `Saved structure ${catalogEntry.name} has no geometry` }
  }

  return await loadPortableStructure({
    label: fragment.name,
    atoms: fragment.atoms,
    bonds: fragment.bonds,
    latticeMatrix: fragment.latticeMatrix,
  })
}

/** Load a batch asset straight from the workspace. */
async function loadWorkspaceFrame(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  const frame = getWorkspaceFramesSnapshot().find((item) => item.id === catalogEntry.key)
  if (!frame?.atoms?.length) {
    return { ok: false, error: `Asset ${catalogEntry.name} is no longer in the workspace` }
  }

  return await loadPortableStructure({
    label: frame.label,
    // Frames store atomic numbers; the portable form speaks element symbols.
    atoms: frame.atoms.map(({ element, position }) => ({
      element: atomicNumberToSymbol(element),
      position,
    })),
    bonds: frame.bonds,
    latticeMatrix: frame.latticeMatrix,
  })
}

/** Network fetch from RCSB; the importer owns parsing and store hand-off. */
async function loadRcsb(pdbId: string): Promise<ModelLoadOutcome> {
  const { importRcsbPdb } = await import("../../services/unified-file-import")
  const result = await importRcsbPdb(pdbId)
  if (!result.success) return { ok: false, error: result.error }
  return {
    ok: true,
    asset: { name: `${pdbId.trim().toUpperCase()}.pdb`, source: "import" },
    message: result.message,
  }
}

/**
 * Trajectories are RCSB ensembles except for the one synthetic demo, which
 * ships as a bundled file and so takes the bundled importer.
 */
async function loadTrajectory(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  const example = BIOMOLECULE_TRAJECTORY_EXAMPLES.find((item) => item.id === catalogEntry.key)
  const sourcePath = example && "src" in example ? example.src : undefined
  if (!sourcePath) return loadRcsb(catalogEntry.key)

  const { importBundledBiomoleculePdb } = await import("../../services/unified-file-import")
  const result = await importBundledBiomoleculePdb(sourcePath, catalogEntry.key)
  if (!result.success) return { ok: false, error: result.error }
  return {
    ok: true,
    asset: { name: `${catalogEntry.key}.pdb`, source: "template" },
    message: result.message,
  }
}

/**
 * Load one catalog entry. Never throws: every failure comes back as
 * `{ ok: false, error }` so both call sites can render it inline.
 */
export async function loadModelCatalogEntry(catalogEntry: ModelCatalogEntry): Promise<ModelLoadOutcome> {
  try {
    switch (catalogEntry.kind) {
      case "crystal": return await loadCrystal(catalogEntry)
      case "molecule": return await loadMolecule(catalogEntry)
      case "biomolecule": return await loadRcsb(catalogEntry.key)
      case "trajectory": return await loadTrajectory(catalogEntry)
      case "user": return await loadUserStructure(catalogEntry)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Model load failed" }
  }
}

export interface CatalogRemoval {
  /** Wording for the confirm prompt — the two origins are not equally reversible. */
  confirm: string
  /** Past-tense line shown after the removal lands. */
  done: string
  apply: () => void
}

/**
 * How to remove one entry from the grid, or `null` if it has no removal path.
 *
 * This exists because the Templates grid puts bundled models and the user's own
 * saved structures in the same grid, where they look alike but are stored in two
 * unrelated places. Before this, removing a bundled template meant leaving the
 * panel for the Model Market and finding an "uninstall" action there, while a
 * saved structure was deleted in place — the surface you were looking at could
 * not act on half of what it displayed.
 *
 * The two removals stay genuinely different in meaning, and the copy says so:
 * a bundled model is only hidden and can be reinstalled from the Model Market,
 * whereas a saved structure is the user's only copy and is gone for good. What
 * is unified is the routing, not the semantics.
 *
 * Returns `null` for macromolecules and trajectories: they are fetched from RCSB
 * on demand and the marketplace does not curate them, so there is nothing to
 * hide and no registry that could bring them back.
 */
export function catalogRemoval(catalogEntry: ModelCatalogEntry): CatalogRemoval | null {
  /**
   * Batch assets are not removable from here. They belong to a batch, and the
   * Assets panel is where they are organised; deleting one as a side effect of
   * tidying the Templates grid would destroy live work that the grid only
   * borrowed for search.
   */
  if (catalogEntry.origin === "workspace") return null
  if (catalogEntry.origin === "user") {
    return {
      confirm: `Delete “${catalogEntry.name}” permanently? This is the only copy — it cannot be restored.`,
      done: `Deleted ${catalogEntry.name}`,
      apply: () => { deleteCustomFragment(catalogEntry.key) },
    }
  }
  const installedId = catalogEntry.installedId
  if (!installedId) return null
  return {
    confirm: `Hide “${catalogEntry.name}” from Templates? You can reinstall it from the Model Market.`,
    done: `Hid ${catalogEntry.name}`,
    apply: () => { useInstalledTemplatesStore.getState().remove(installedId) },
  }
}

/** Free-text filter over the prebuilt haystack; every term must match. */
export function filterModelCatalog(
  entries: readonly ModelCatalogEntry[],
  query: string,
): readonly ModelCatalogEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return entries
  return entries.filter((item) => terms.every((term) => item.search.includes(term)))
}
