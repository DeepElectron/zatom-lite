/**
 * structure-groups-slice -- Persistent structure-layer hierarchy for combined structures.
 *
 * Structure:
 *   ▣ <document name>     <- parent folder; selected means edit all (activeGroupId=null)
 *     ├─ Base             <- the document's own structure, always first
 *     └─ CO molecule      <- child layer created by merge, extraction, or duplication
 *
 * ## Invariant
 *
 *   atoms.length > 0 iff structureGroups.length >= 1, and structureGroups[0] is always Base.
 *
 * This replaces the old sentinel meaning where an empty group array could also represent a
 * single structure. Membership is now well-defined, and every non-empty structure has a layer tree.
 * `structureGroups.length === 0` means only that no structure exists.
 *
 * Two operations maintain the invariant:
 *   - `resetStructureGroupsToBase` runs when installing a document (CIF, XYZ, PDB, frame
 *     restoration, or replaceAtomsDirectly), replacing old groups with Base.
 *   - `ensureBaseGroup` is the sole Base creation point and guards child-layer insertion.
 *   `clearStructureGroups` is reserved for truly empty documents.
 *
 * ## Membership is derived, not stored as static id lists
 *
 * Periodic scenes:
 *   - `atom.groupId === g.id` means the atom belongs to g.
 *   - `atom.groupId === undefined` means Base. Supercell regeneration creates new ids without
 *     groupId, so Base naturally includes regenerated atoms without synchronization.
 *   - An orphaned groupId also falls into Base, preserving the invariant that layer counts sum
 *     to the total atom count and preventing atoms from disappearing from the tree.
 *
 * Biological scenes: `atoms` is rebuilt as a derived mirror of `bioStructure`, so groupId is
 * not stable. Membership derives from `bioResidueKeys`, whose residue identities survive
 * reparsing, and `viewerAtoms` assigns groupId to join the same rules above.
 *
 * `structureGroups` and `activeGroupId` belong to HistoryState for consistent undo/redo.
 * `soloGroupId` is transient view state and is neither historical nor persisted.
 */

import type { StateCreator } from 'zustand'
import type { Atom } from '../../lib/crystal/types'
import { recomputeBonds } from '../recompute-bonds'
import { generateAtomId } from '../../lib/crystal/supercell-utils'
import { bioResidueKey } from '../../lib/biomolecule/constants'
import type { BioStructure } from '../../lib/biomolecule/types'
import type { CrystalStore } from '../crystal-store-types'

/** Default Base-layer name; the parent already displays the document name. */
export const BASE_LAYER_NAME = 'Base'

export interface StructureGroup {
  id: string
  name: string
  visible: boolean
  /**
   * In biological scenes, this group's members are atoms matching these residue identity keys.
   *
   * Biological atoms are a derived mirror of bioStructure and cannot retain groupId. Residue
   * identity keys (chain:seq:ins) remain stable across reparsing, so they define membership.
   * Periodic groups omit this field and use explicit atom.groupId values.
   */
  bioResidueKeys?: readonly string[]
}

/** Atom input for merging: element plus world-space Cartesian coordinates. */
export interface GroupAtomInput {
  element: string
  cartesian: [number, number, number]
}

/**
 * Derive membership. Base, the first group, additionally includes:
 *   - unmarked atoms created by supercell regeneration
 *   - orphans whose groupId no longer exists
 * Including orphans keeps the sum of layer counts equal to the total atom count.
 */
export function atomBelongsToGroup(atom: Atom, groupId: string, groups: StructureGroup[]): boolean {
  if (atom.groupId === groupId) return true
  if (groups.length === 0 || groups[0].id !== groupId) return false
  return atom.groupId === undefined || !groups.some((g) => g.id === atom.groupId)
}

/**
 * Single visibility rule: solo takes precedence and hides every other group; otherwise use
 * each group's visible flag. Both crystal-scene and biomolecule-layer call this helper.
 */
export function hiddenGroupIds(groups: StructureGroup[], soloGroupId: string | null): Set<string> {
  const hidden = new Set<string>()
  const soloed = soloGroupId !== null && groups.some((g) => g.id === soloGroupId)
  for (const group of groups) {
    if (soloed ? group.id !== soloGroupId : !group.visible) hidden.add(group.id)
  }
  return hidden
}

let groupIdCounter = 0
function generateGroupId(): string {
  groupIdCounter += 1
  return `group-${Date.now().toString(36)}-${groupIdCounter}`
}

/**
 * Serialize layers for Asset persistence. Asset creation and bound-frame writeback share
 * this path so neither omits fields such as biological membership.
 * soloGroupId is transient view state and must not be persisted.
 */
export function serializeStructureGroups(groups: readonly StructureGroup[]): StructureGroup[] {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    visible: g.visible,
    ...(g.bioResidueKeys && g.bioResidueKeys.length > 0 ? { bioResidueKeys: [...g.bioResidueKeys] } : {}),
  }))
}

/**
 * Restore layers from a persisted Asset while enforcing the invariant.
 *
 * Assets saved before persistent layers lack structureGroups and represent a single structure.
 * Restoration adds Base so those assets also receive a persistent layer tree.
 */
export function restoreStructureGroups(
  saved: readonly StructureGroup[] | undefined,
  atomCount: number,
): StructureGroup[] {
  if (atomCount === 0) return []
  if (saved && saved.length > 0) {
    return saved.map((g) => ({
      id: g.id,
      name: g.name,
      visible: g.visible,
      ...(g.bioResidueKeys ? { bioResidueKeys: [...g.bioResidueKeys] } : {}),
    }))
  }
  return [{ id: generateGroupId(), name: BASE_LAYER_NAME, visible: true }]
}

/**
 * Whether this group can be duplicated in a biological scene.
 *
 * Only a HET component containing one nonstandard residue is supported. The underlying
 * appendBioHetComponent can express one new HET residue, whereas polymer duplication requires
 * chain-level topology cloning; appending GLY as HETATM would create a false disconnected residue.
 *
 * A shared predicate keeps button availability and action execution on the same rule.
 */
export function bioGroupIsDuplicable(
  members: readonly Atom[],
  bioStructure: BioStructure,
): boolean {
  if (members.length === 0) return false
  const memberIds = new Set(members.map((m) => m.id))
  const residueIndices = new Set(
    bioStructure.atoms.filter((a) => memberIds.has(a.id)).map((a) => a.residueIndex),
  )
  if (residueIndices.size !== 1) return false
  const residue = bioStructure.residues[[...residueIndices][0]]
  return residue !== undefined && !residue.isStandard
}

/** Whether this is the first, Base group. Base cannot be removed; clear the document instead. */
export function isBaseGroup(groups: StructureGroup[], groupId: string): boolean {
  return groups.length > 0 && groups[0].id === groupId
}

export interface StructureGroupsSlice {
  structureGroups: StructureGroup[]
  /** null selects the parent layer (all); otherwise editing is restricted to this group. */
  activeGroupId: string | null
  /** Solo view: render only this group. Transient, neither historical nor persisted. */
  soloGroupId: string | null

  /**
   * Sole entry point at document installation: replace old groups and create Base immediately.
   * Call in the same transaction that installs a structure after parsing succeeds.
   */
  resetStructureGroupsToBase: () => void
  /** Sole Base creation point and child-layer invariant guard; returns the first id if present. */
  ensureBaseGroup: (name: string) => string
  /** Append Cartesian atoms through addAtomToSupercell, assign groupId, and create a group. Caller owns history. */
  addGroupWithAtoms: (name: string, atomInputs: GroupAtomInput[]) => string
  /**
   * In biological scenes, register only a group derived from residue identity keys. Do not
   * create atoms or recompute bonds; bioStructure reparsing created them with explicit PDB topology.
   */
  addBioGroup: (name: string, residueKeys: readonly string[]) => string
  /**
   * Extract the selection into a child layer. Biological scenes promote complete residues,
   * matching residue-level deletion. Return null for an empty selection.
   */
  createGroupFromSelection: (name: string) => string | null
  /**
   * Duplicate a layer, translate it along X by its bounding-box span plus a gap, activate it,
   * and leave fine adjustment to the gizmo. Biological scenes support only single-residue HET
   * groups; polymer chains require chain-level topology cloning. Return null when unsupported.
   */
  duplicateGroup: (groupId: string) => string | null
  setActiveGroup: (groupId: string | null) => void
  renameGroup: (groupId: string, name: string) => void
  toggleGroupVisible: (groupId: string) => void
  /** Toggle solo view; selecting the same group again exits solo mode. */
  toggleSoloGroup: (groupId: string) => void
  /** Remove a non-Base group and all its atoms through deleteAtomsByIds, which records history. */
  removeGroup: (groupId: string) => void
  /** Use only for a truly empty document through clearStructure or clearBiomolecule. */
  clearStructureGroups: () => void
}

export const createStructureGroupsSlice: StateCreator<CrystalStore, [], [], StructureGroupsSlice> = (set, get) => ({
  structureGroups: [],
  activeGroupId: null,
  soloGroupId: null,

  resetStructureGroupsToBase: () => {
    set({
      structureGroups: [{ id: generateGroupId(), name: BASE_LAYER_NAME, visible: true }],
      activeGroupId: null,
      soloGroupId: null,
    })
  },

  ensureBaseGroup: (name) => {
    const { structureGroups } = get()
    if (structureGroups.length > 0) return structureGroups[0].id
    const group: StructureGroup = { id: generateGroupId(), name, visible: true }
    set({ structureGroups: [group] })
    return group.id
  },

  addGroupWithAtoms: (name, atomInputs) => {
    get().ensureBaseGroup(BASE_LAYER_NAME)
    const groupId = generateGroupId()
    const newAtoms: Atom[] = atomInputs.map((input) => ({
      id: generateAtomId(),
      element: input.element,
      position: input.cartesian,
      cartesian: input.cartesian,
      groupId,
    }))

    const { atoms, userAddedAtomIds, structureGroups } = get()
    // userAddedAtomIds protects these atoms from supercell regeneration, matching addAtomToSupercell.
    const newUserAdded = new Set(userAddedAtomIds)
    newAtoms.forEach((a) => newUserAdded.add(a.id))

    set({
      atoms: [...atoms, ...newAtoms],
      userAddedAtomIds: newUserAdded,
      structureGroups: [...structureGroups, { id: groupId, name, visible: true }],
    })

    // Recompute bonds, including interfaces between existing and new atoms.
    setTimeout(() => {
      const s = get()
      const bonds = recomputeBonds(s)
      set({ bonds })
    }, 0)

    return groupId
  },

  addBioGroup: (name, residueKeys) => {
    get().ensureBaseGroup(BASE_LAYER_NAME)
    const groupId = generateGroupId()
    set({
      structureGroups: [
        ...get().structureGroups,
        { id: groupId, name, visible: true, bioResidueKeys: [...residueKeys] },
      ],
    })
    return groupId
  },

  createGroupFromSelection: (name) => {
    const { selectedAtomIds, bioStructure, atoms } = get()
    if (selectedAtomIds.size === 0) return null

    get().pushHistory()

    if (bioStructure) {
      // In biological scenes, map selected atoms to residue identity keys. Promote partially
      // selected residues in full, matching residue-level deletion and picking.
      const keys = new Set<string>()
      for (const atom of bioStructure.atoms) {
        if (!selectedAtomIds.has(atom.id)) continue
        const residue = bioStructure.residues[atom.residueIndex]
        if (residue) keys.add(bioResidueKey(residue.identity))
      }
      if (keys.size === 0) return null
      const groupId = get().addBioGroup(name, [...keys])
      // Membership changed; rederive groupId in the atoms mirror.
      get().refreshBioLayerMembership()
      set({ activeGroupId: groupId })
      get().markBoundFrameDirty()
      return groupId
    }

    const groupId = generateGroupId()
    get().ensureBaseGroup(BASE_LAYER_NAME)
    set({
      atoms: atoms.map((atom) => (selectedAtomIds.has(atom.id) ? { ...atom, groupId } : atom)),
      structureGroups: [...get().structureGroups, { id: groupId, name, visible: true }],
      activeGroupId: groupId,
    })
    get().markBoundFrameDirty()
    return groupId
  },

  duplicateGroup: (groupId) => {
    const { structureGroups, atoms, bioStructure } = get()
    const group = structureGroups.find((g) => g.id === groupId)
    if (!group) return null

    const members = atoms.filter((a) => atomBelongsToGroup(a, groupId, structureGroups))
    if (members.length === 0) return null

    // Shift along X by the bounding-box span plus a 2 Å gap so copies are adjacent without overlap.
    const xs = members.map((a) => (a.cartesian ?? a.position)[0])
    const shift = Math.max(...xs) - Math.min(...xs) + 2
    const copyName = `${group.name} copy`

    if (bioStructure) {
      if (!bioGroupIsDuplicable(members, bioStructure)) return null
      const appended = get().appendBioHetComponent(
        copyName,
        members.map((a) => {
          const p = (a.cartesian ?? a.position) as [number, number, number]
          return { element: a.element, position: [p[0] + shift, p[1], p[2]] as [number, number, number] }
        }),
      )
      // appendBioHetComponent creates and activates its own group.
      return appended ? get().activeGroupId : null
    }

    get().pushHistory()
    const newGroupId = get().addGroupWithAtoms(
      copyName,
      members.map((a) => {
        const p = (a.cartesian ?? a.position) as [number, number, number]
        return { element: a.element, cartesian: [p[0] + shift, p[1], p[2]] as [number, number, number] }
      }),
    )
    set({ activeGroupId: newGroupId })
    return newGroupId
  },

  setActiveGroup: (groupId) => {
    if (groupId !== null && !get().structureGroups.some((g) => g.id === groupId)) return
    // Clear selections when changing edit scope to prevent stale cross-group selections.
    set({ activeGroupId: groupId, selectedAtomIds: new Set(), selectedBondIds: new Set() })
  },

  renameGroup: (groupId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set({
      structureGroups: get().structureGroups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
    })
    // Layer metadata persists with the Asset, so trigger bound-frame writeback.
    get().markBoundFrameDirty()
  },

  toggleGroupVisible: (groupId) => {
    set({
      structureGroups: get().structureGroups.map((g) => (g.id === groupId ? { ...g, visible: !g.visible } : g)),
    })
    get().markBoundFrameDirty()
  },

  toggleSoloGroup: (groupId) => {
    set({ soloGroupId: get().soloGroupId === groupId ? null : groupId })
  },

  removeGroup: (groupId) => {
    const { structureGroups, atoms } = get()
    const group = structureGroups.find((g) => g.id === groupId)
    if (!group) return
    // Base owns the document structure; removing it means clearing the document.
    if (isBaseGroup(structureGroups, groupId)) return

    const memberIds = atoms.filter((a) => atomBelongsToGroup(a, groupId, structureGroups)).map((a) => a.id)
    // deleteAtomsByIds pushes history with pre-delete group state and maintains userAdded/userDeleted.
    get().deleteAtomsByIds(memberIds)

    // Preserve Base after deleting a child; the layer tree remains persistent.
    set({
      structureGroups: get().structureGroups.filter((g) => g.id !== groupId),
      activeGroupId: get().activeGroupId === groupId ? null : get().activeGroupId,
      soloGroupId: get().soloGroupId === groupId ? null : get().soloGroupId,
    })
  },

  clearStructureGroups: () => {
    if (get().structureGroups.length === 0 && get().activeGroupId === null && get().soloGroupId === null) return
    set({ structureGroups: [], activeGroupId: null, soloGroupId: null })
  },
})
