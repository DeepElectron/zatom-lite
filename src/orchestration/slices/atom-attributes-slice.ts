/**
 * Shared per-atom display attributes for analysis overlays.
 *
 * OVITO PTM fields are derived only from a validated canonical annotation when
 * an Agent candidate is written into the viewport. The store does not run or
 * guess a second local-structure classifier.
 *
 *   - polyhedraCentralElements: an empty set prioritizes metal centers automatically,
 *     falling back to non-H atoms when no metals exist; a nonempty set analyzes only
 *     local coordination regions centered on those elements.
 *
 *   - importBaderJson / parseBaderText are loader helpers accepting these formats:
 *       { "atom_id": 0.42, ... }
 *       [{ atom_id, charge }, ...]
 *       Plain text: "atomId charge\n..."
 *
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { CoordinationEnvironmentSummary } from '../../lib/crystal/polyhedra'
import {
  ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID,
  ZATOM_OVITO_PTM_TYPE_BY_ID,
  type ZatomOvitoPtmAnnotationSummary,
  type ZatomOvitoPtmClassification,
  type ZatomOvitoPtmOrderingType,
} from '../../agent/ovito-ptm-annotation'
import {
  computeAllMetalRacs,
  describeSbuTopology,
  detectSbus,
  type RacVector,
  type SBU,
  type SBUKind,
  type SbuDetectionResult,
} from '../../lib/analysis/mof'

export interface AtomAttributes {
  /** Bader charge in electrons (positive = electron-deficient). Loaded from a calc output. */
  bader_charge?: number
  /** Verified OVITO PTM annotation derived from the canonical structure. */
  ptmAnalyzed?: boolean
  ptmStructureType?: ZatomOvitoPtmClassification
  ptmRmsd?: number
  ptmInteratomicDistanceA?: number
  ptmOrderingType?: ZatomOvitoPtmOrderingType
  ptmElasticStrainMagnitude?: number
  ptmElasticVolumeRatio?: number
  /** Optional per-atom label string for custom overlays. */
  custom_label?: string
  /** MOF SBU id this atom belongs to (sparse — only when MOF analysis was run). */
  sbu_id?: string
  /** Quick read of which SBU kind the atom belongs to, for colour-by-SBU. */
  sbu_kind?: SBUKind
  /** Initial collinear magnetic moment (μB) for spin-polarised DFT. Sign = spin
   *  direction; 0 / undefined = non-magnetic. Flows to the engine (ABACUS STRU). */
  magmom?: number
  /** Non-collinear spin direction (degrees): magmomTheta = polar angle from +z
   *  (ABACUS angle1), magmomPhi = azimuth in xy (ABACUS angle2). When set, the
   *  engine emits a non-collinear STRU (mag |m| angle1 angle2) + nspin 4. Undefined
   *  on both = collinear (the magmom sign carries ±z). */
  magmomTheta?: number
  magmomPhi?: number
}

/** Sensible high-spin initial magnetic-moment guesses (μB) for spin-polarised DFT,
 *  keyed by element symbol. Unlisted elements default to 0 (non-magnetic). */
export const MAGMOM_BY_ELEMENT: Record<string, number> = {
  // 3d transition metals
  Sc: 1, Ti: 2, V: 3, Cr: 5, Mn: 5, Fe: 4, Co: 3, Ni: 2, Cu: 1,
  // 4d / 5d that are commonly magnetic in init guesses
  Mo: 4, Tc: 5, Ru: 2, Rh: 1, W: 2, Re: 3, Os: 2, Ir: 1,
  // lanthanides / actinides (high-spin f)
  Ce: 1, Pr: 2, Nd: 3, Sm: 5, Eu: 7, Gd: 7, Tb: 6, Dy: 5, Ho: 4, Er: 3, Tm: 2, U: 3,
}

/** Atom colors per SBU kind for the colour-by-SBU overlay. */
export const SBU_KIND_COLORS: Record<SBUKind, string> = {
  metal_cluster: '#f59e0b',       // amber — generic metal node
  metal_paddlewheel: '#ec4899',   // pink — Cu2 / Zn2 paddle-wheel
  metal_oxocluster: '#a855f7',    // purple — Zn4O / Cr3O
  metal_monomer: '#22d3ee',       // cyan — isolated metal
  linker: '#10b981',              // green — organic linker
  capping: '#94a3b8',             // slate — terminal ligand
}

/** OVITO 3.15.5 default PTM type colors, kept consistent with engine output. */
export const PTM_STRUCTURE_COLORS: Record<ZatomOvitoPtmClassification, string> = {
  other: '#F2F2F2',
  fcc: '#66FF66',
  hcp: '#FF6666',
  bcc: '#6666FF',
  ico: '#F2CC33',
  sc: '#A014FE',
  'cubic-diamond': '#13A0FE',
  'hexagonal-diamond': '#FE8900',
  graphene: '#A078FE',
}

export const PTM_STRUCTURE_LABELS: Record<ZatomOvitoPtmClassification, string> = {
  other: 'Other',
  fcc: 'FCC',
  hcp: 'HCP',
  bcc: 'BCC',
  ico: 'Icosahedral',
  sc: 'Simple cubic',
  'cubic-diamond': 'Cubic diamond',
  'hexagonal-diamond': 'Hexagonal diamond',
  graphene: 'Graphene',
}

export const PTM_STRUCTURE_ORDER = ZATOM_OVITO_PTM_TYPE_BY_ID

export const PTM_ORDERING_LABELS: Record<ZatomOvitoPtmOrderingType, string> = {
  other: 'Other',
  pure: 'Pure',
  l10: 'L1₀',
  'l12-a': 'L1₂ (A)',
  'l12-b': 'L1₂ (B)',
  b2: 'B2',
  'zincblende-wurtzite': 'Zincblende / wurtzite',
  'boron-nitride': 'Boron nitride',
}

export const PTM_ORDERING_ORDER = ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID

export function resolveAtomOverlayColor(
  elementColor: string,
  attrs: AtomAttributes | undefined,
  showMofSbuColoring: boolean,
  showPtmColoring: boolean,
  /** Precomputed trajectory scalar→colormap hex (highest priority). When a
   *  trajectory "color by" property is active, the renderer computes the
   *  colormap colour and passes it here; null/undefined ⇒ no override. */
  trajectoryColor?: string | null,
): string {
  if (trajectoryColor) {
    return trajectoryColor
  }
  if (showMofSbuColoring && attrs?.sbu_kind) {
    return SBU_KIND_COLORS[attrs.sbu_kind]
  }
  if (showPtmColoring && attrs?.ptmAnalyzed && attrs.ptmStructureType) {
    return PTM_STRUCTURE_COLORS[attrs.ptmStructureType]
  }
  return elementColor
}

export function stripMofAtomAttributes(
  atomAttributes: Record<string, AtomAttributes>,
): Record<string, AtomAttributes> {
  const cleaned: Record<string, AtomAttributes> = {}
  for (const [id, attrs] of Object.entries(atomAttributes)) {
    const { sbu_id: _sbuId, sbu_kind: _sbuKind, ...rest } = attrs
    if (Object.keys(rest).length > 0) cleaned[id] = rest
  }
  return cleaned
}

export function stripPtmAtomAttributes(
  atomAttributes: Record<string, AtomAttributes>,
): Record<string, AtomAttributes> {
  const cleaned: Record<string, AtomAttributes> = {}
  for (const [id, attrs] of Object.entries(atomAttributes)) {
    const {
      ptmAnalyzed: _ptmAnalyzed,
      ptmStructureType: _ptmStructureType,
      ptmRmsd: _ptmRmsd,
      ptmInteratomicDistanceA: _ptmInteratomicDistanceA,
      ptmOrderingType: _ptmOrderingType,
      ptmElasticStrainMagnitude: _ptmElasticStrainMagnitude,
      ptmElasticVolumeRatio: _ptmElasticVolumeRatio,
      ...rest
    } = attrs
    if (Object.keys(rest).length) cleaned[id] = rest
  }
  return cleaned
}

/** Keep only user/engine identity-bound attributes across a same-atom structure write. */
export function stripDerivedAtomAttributes(
  atomAttributes: Record<string, AtomAttributes>,
): Record<string, AtomAttributes> {
  const cleaned: Record<string, AtomAttributes> = {}
  for (const [id, attrs] of Object.entries(atomAttributes)) {
    const next: AtomAttributes = {}
    if (attrs.bader_charge !== undefined) next.bader_charge = attrs.bader_charge
    if (attrs.custom_label !== undefined) next.custom_label = attrs.custom_label
    if (attrs.magmom !== undefined) next.magmom = attrs.magmom
    if (attrs.magmomTheta !== undefined) next.magmomTheta = attrs.magmomTheta
    if (attrs.magmomPhi !== undefined) next.magmomPhi = attrs.magmomPhi
    if (Object.keys(next).length) cleaned[id] = next
  }
  return cleaned
}

export function analysisOverlayResetPatch() {
  return {
    atomAttributes: {},
    ptmAnalysis: null,
    mofSbus: [],
    mofRacs: [],
    mofWarnings: [],
    showMofSbuColoring: false,
    showPtmColoring: false,
    selectedSbuId: null,
    coordinationAnalysisSummary: null,
  }
}

export interface BaderImportResult {
  ok: boolean
  error?: string
  /** Number of atoms updated when ok=true. */
  count?: number
}

export interface AtomAttributesSlice {
  /** Map atomId → attributes. Sparse — atoms without entries get no overlay. */
  atomAttributes: Record<string, AtomAttributes>
  setAtomAttributes: (atomId: string, attrs: AtomAttributes) => void
  setAtomAttributesBulk: (entries: Record<string, AtomAttributes>) => void
  clearAtomAttributes: () => void

  /**
   * Freeze or release degrees of freedom for the specified atoms via Atom.fixed.
   *
   * fixed=null removes the constraint and restores freedom on all three axes. Do not
   * write [false,false,false]: export would include the atom in the selective-dynamics
   * block as explicitly movable, which differs from never having been constrained.
   */
  setAtomsFixed: (atomIds: readonly string[], fixed: [boolean, boolean, boolean] | null) => void
  /** Freeze the whole selection if any atom is not fully fixed; otherwise release all. */
  toggleSelectedFixed: () => void
  /** Remove constraints from every atom in the structure. */
  clearAllFixed: () => void

  /** Canonical OVITO PTM summary and its visualization toggle. */
  ptmAnalysis: ZatomOvitoPtmAnnotationSummary | null
  showPtmColoring: boolean
  setShowPtmColoring: (show: boolean) => void

  /** Other visualization toggles. */
  showBaderLabels: boolean
  setShowBaderLabels: (show: boolean) => void
  showGrainColoring: boolean
  setShowGrainColoring: (show: boolean) => void
  showCoordinationPolyhedra: boolean
  setShowCoordinationPolyhedra: (show: boolean) => void
  coordinationAnalysisSummary: CoordinationEnvironmentSummary | null
  setCoordinationAnalysisSummary: (summary: CoordinationEnvironmentSummary | null) => void

  /** Polyhedra config */
  polyhedraCentralElements: Set<string>
  setPolyhedraCentralElements: (els: Set<string>) => void
  polyhedraOpacity: number
  setPolyhedraOpacity: (v: number) => void

  /** Cell-level compute settings (structure-wide, not per-atom): total system
   *  charge q (→ backend solver.charge → ABACUS nelec) and an optional fixed net
   *  spin n↑−n↓ (→ engineOptions.nupdown, ABACUS). 0 / null = neutral / unconstrained. */
  cellCharge: number
  setCellCharge: (q: number) => void
  netSpin: number | null
  setNetSpin: (s: number | null) => void

  /** Magnetism: per-atom magmom label overlay toggle + an element-defaults filler. */
  showMagmomLabels: boolean
  setShowMagmomLabels: (show: boolean) => void
  /** Set magmom on every atom from MAGMOM_BY_ELEMENT (magnetic elements get a
   *  high-spin guess, everything else 0). Returns the number of magnetic atoms set. */
  applyMagmomByElement: () => number

  /** Loaders / actions */
  importBaderJson: (json: string) => BaderImportResult
  importBaderText: (text: string) => BaderImportResult
  /** MOF analysis state. mofSbus + mofRacs are populated by runMofAnalysis. */
  mofSbus: Array<SBU & { topology: string }>
  mofRacs: RacVector[]
  mofWarnings: string[]
  /** Visualization toggle for SBU atom coloring. */
  showMofSbuColoring: boolean
  setShowMofSbuColoring: (show: boolean) => void
  /** Currently focused SBU id (UI-driven; null = none). */
  selectedSbuId: string | null
  setSelectedSbuId: (id: string | null) => void
  /** Run SBU detection + RAC computation on current atoms / bonds. */
  runMofAnalysis: () => { ok: boolean; sbuCount: number; racCount: number; warnings: string[] }
  clearMofAnalysis: () => void
}

/** Parse a simple text format: lines of "atomId charge" (whitespace-separated). */
export function parseBaderText(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const id = parts[0]
    const charge = parseFloat(parts[1])
    if (!Number.isFinite(charge)) continue
    out[id] = charge
  }
  return out
}

/**
 * Parse a Bader-charge JSON dump in one of two shapes:
 *   1. { "atomId": charge, ... }
 *   2. [{ atom_id: string, charge: number }, ...]
 *
 * Returns a flat `{ atomId: charge }` map. Throws on malformed JSON;
 * silently skips entries with non-finite charges.
 */
export function parseBaderJson(raw: string): Record<string, number> {
  const parsed: unknown = JSON.parse(raw)
  const out: Record<string, number> = {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v
      }
    }
    return out
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        const id = rec.atom_id ?? rec.atomId ?? rec.id
        const ch = rec.charge ?? rec.bader_charge ?? rec.value
        if (typeof id === 'string' && typeof ch === 'number' && Number.isFinite(ch)) {
          out[id] = ch
        }
      }
    }
    return out
  }
  throw new Error('Bader JSON must be an object map or an array of {atom_id, charge}.')
}

export const createAtomAttributesSlice: StateCreator<CrystalStore, [], [], AtomAttributesSlice> = (set, get) => ({
  atomAttributes: {},

  setAtomAttributes: (atomId, attrs) => {
    set((state) => {
      const existing = state.atomAttributes[atomId] ?? {}
      return {
        atomAttributes: {
          ...state.atomAttributes,
          [atomId]: { ...existing, ...attrs },
        },
      }
    })
  },

  setAtomAttributesBulk: (entries) => {
    set((state) => {
      const next = { ...state.atomAttributes }
      for (const [id, attrs] of Object.entries(entries)) {
        next[id] = { ...(next[id] ?? {}), ...attrs }
      }
      return { atomAttributes: next }
    })
  },

  clearAtomAttributes: () => set({ atomAttributes: {} }),

  setAtomsFixed: (atomIds, fixed) => {
    if (!atomIds.length) return
    const targets = new Set(atomIds)
    // structureSnapshot deep-copies atoms, including fixed, so constraints are
    // history-managed structure state. Record a frame or undo could silently erase them.
    const changes = get().atoms.some((atom) => {
      if (!targets.has(atom.id)) return false
      if (fixed === null) return atom.fixed !== undefined
      return (
        atom.fixed === undefined || atom.fixed.some((axis, index) => axis !== fixed[index])
      )
    })
    if (!changes) return
    get().pushHistory()
    set((state) => ({
      atoms: state.atoms.map((atom) => {
        if (!targets.has(atom.id)) return atom
        if (fixed === null) {
          if (atom.fixed === undefined) return atom
          const { fixed: _drop, ...rest } = atom
          return rest
        }
        return { ...atom, fixed: [...fixed] as [boolean, boolean, boolean] }
      }),
    }))
  },

  toggleSelectedFixed: () => {
    const { selectedAtomIds, atoms, setAtomsFixed } = get()
    if (!selectedAtomIds.size) return
    const selected = atoms.filter((atom) => selectedAtomIds.has(atom.id))
    // If any atom is not fixed on all three axes, freeze the batch; release it only
    // when all are fixed. One click therefore normalizes a mixed selection.
    const allFixed = selected.every((atom) => atom.fixed?.every(Boolean) === true)
    setAtomsFixed(selected.map((atom) => atom.id), allFixed ? null : [true, true, true])
  },

  clearAllFixed: () => {
    if (!get().atoms.some((atom) => atom.fixed !== undefined)) return
    get().pushHistory()
    set((state) => ({
      atoms: state.atoms.map((atom) => {
        if (atom.fixed === undefined) return atom
        const { fixed: _drop, ...rest } = atom
        return rest
      }),
    }))
  },

  ptmAnalysis: null,
  showPtmColoring: false,
  setShowPtmColoring: (show) => set((state) => ({ showPtmColoring: !!state.ptmAnalysis && show })),

  showBaderLabels: false,
  setShowBaderLabels: (show) => set({ showBaderLabels: show }),
  showGrainColoring: false,
  setShowGrainColoring: (show) => set({ showGrainColoring: show }),
  showCoordinationPolyhedra: false,
  setShowCoordinationPolyhedra: (show) => set({
    showCoordinationPolyhedra: show,
    coordinationAnalysisSummary: null,
    stylePresetId: 'custom',
  }),
  coordinationAnalysisSummary: null,
  setCoordinationAnalysisSummary: (summary) => set({ coordinationAnalysisSummary: summary }),

  cellCharge: 0,
  setCellCharge: (q) => set({ cellCharge: Number.isFinite(q) ? q : 0 }),
  netSpin: null,
  setNetSpin: (s) => set({ netSpin: s === null || Number.isFinite(s) ? s : null }),

  showMagmomLabels: false,
  setShowMagmomLabels: (show) => set({ showMagmomLabels: show }),
  applyMagmomByElement: () => {
    const { atoms } = get()
    if (atoms.length === 0) return 0
    const entries: Record<string, AtomAttributes> = {}
    let nMagnetic = 0
    for (const atom of atoms) {
      const mag = MAGMOM_BY_ELEMENT[atom.element] ?? 0
      entries[atom.id] = { magmom: mag }
      if (mag !== 0) nMagnetic += 1
    }
    get().setAtomAttributesBulk(entries)
    return nMagnetic
  },

  polyhedraCentralElements: new Set<string>(),
  setPolyhedraCentralElements: (els) => set({
    polyhedraCentralElements: new Set(els),
    coordinationAnalysisSummary: null,
  }),
  polyhedraOpacity: 0.35,
  setPolyhedraOpacity: (v) => set({
    polyhedraOpacity: Math.max(0, Math.min(1, v)),
    stylePresetId: 'custom',
  }),

  importBaderJson: (json) => {
    let charges: Record<string, number>
    try {
      charges = parseBaderJson(json)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const entries: Record<string, AtomAttributes> = {}
    for (const [id, charge] of Object.entries(charges)) {
      entries[id] = { bader_charge: charge }
    }
    get().setAtomAttributesBulk(entries)
    return { ok: true, count: Object.keys(entries).length }
  },

  importBaderText: (text) => {
    const charges = parseBaderText(text)
    if (Object.keys(charges).length === 0) {
      return { ok: false, error: 'No valid "<atomId> <charge>" lines found.' }
    }
    const entries: Record<string, AtomAttributes> = {}
    for (const [id, charge] of Object.entries(charges)) {
      entries[id] = { bader_charge: charge }
    }
    get().setAtomAttributesBulk(entries)
    return { ok: true, count: Object.keys(entries).length }
  },

  // ── MOF analysis ────────────────────────────────────────────────────────
  mofSbus: [],
  mofRacs: [],
  mofWarnings: [],
  showMofSbuColoring: false,
  setShowMofSbuColoring: (show) => set({ showMofSbuColoring: show }),
  selectedSbuId: null,
  setSelectedSbuId: (id) => set({ selectedSbuId: id }),

  runMofAnalysis: () => {
    const { atoms, bonds } = get()
    if (atoms.length === 0) {
      return { ok: false, sbuCount: 0, racCount: 0, warnings: ['No atoms loaded'] }
    }
    // Adapt store atoms into the lib API shape (id + element + cartesian).
    const sbuAtoms = atoms
      .map((a) => {
        const cart = a.cartesian ?? a.position
        if (!cart) return null
        return { id: a.id, element: a.element, cartesian: cart as [number, number, number] }
      })
      .filter((x): x is { id: string; element: string; cartesian: [number, number, number] } => x !== null)
    const sbuBonds = bonds.map((b) => ({ atom1Id: b.atom1Id, atom2Id: b.atom2Id }))

    const result: SbuDetectionResult = detectSbus(sbuAtoms, sbuBonds)

    // Decorate each SBU with a topology label for the UI.
    const decorated = result.sbus.map((sbu) => ({
      ...sbu,
      topology: describeSbuTopology(sbu, sbuAtoms, sbuBonds),
    }))

    // Write sbu_id + sbu_kind to per-atom attributes for colouring. Start from
    // existing non-MOF attributes so reruns cannot leave stale SBU assignments.
    const nextAtomAttributes = stripMofAtomAttributes(get().atomAttributes)
    for (const [atomId, sbuId] of Object.entries(result.atom_to_sbu)) {
      const sbu = result.sbus.find((s) => s.id === sbuId)
      if (!sbu) continue
      nextAtomAttributes[atomId] = {
        ...(nextAtomAttributes[atomId] ?? {}),
        sbu_id: sbuId,
        sbu_kind: sbu.kind,
      }
    }

    const racs = computeAllMetalRacs(sbuAtoms, sbuBonds)

    set({
      atomAttributes: nextAtomAttributes,
      mofSbus: decorated,
      mofRacs: racs,
      mofWarnings: result.warnings,
    })
    return {
      ok: true,
      sbuCount: decorated.length,
      racCount: racs.length,
      warnings: result.warnings,
    }
  },

  clearMofAnalysis: () => {
    // Clear sbu_id / sbu_kind from per-atom attributes; keep other fields.
    set((state) => {
      return {
        atomAttributes: stripMofAtomAttributes(state.atomAttributes),
        mofSbus: [],
        mofRacs: [],
        mofWarnings: [],
        selectedSbuId: null,
      }
    })
  },
})
