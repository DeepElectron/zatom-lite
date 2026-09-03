import { describe, expect, it } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { createCrystalStore } from '../orchestration/crystalStore'
import { atomBelongsToGroup, hiddenGroupIds } from '../orchestration/slices/structure-groups-slice'
import { classifyBioSubsystemAtoms } from '../lib/biomolecule/subsystems'
import { visibleBioStructure } from '../ui/components/crystal-viewer/biomolecule-layer'
import { biomoleculePlaceholderDisplayNames } from '../lib/biomolecule/selection-label'
import { bioResidueKey } from '../lib/biomolecule/constants'

/**
 * Biomolecular structure layers with the same semantics as periodic structures.
 *
 * Invariant: atoms.length > 0 iff a Base layer exists, and groups[0] is always Base.
 *
 * Biomolecular atoms are rebuilt mirrors of bioStructure, so membership derives from stable residue
 * identity keys rather than transient atom ids.
 */

const PDB = [
  'ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00  0.00           N',
  'ATOM      2  CA  GLY A   1       1.450   0.000   0.000  1.00  0.00           C',
  'ATOM      3  C   GLY A   1       2.900   0.000   0.000  1.00  0.00           C',
  'END',
].join('\n')

const METHANE = [
  { element: 'C', position: [20, 20, 20] as [number, number, number] },
  { element: 'H', position: [21.09, 20, 20] as [number, number, number] },
  { element: 'H', position: [19.64, 21.03, 20] as [number, number, number] },
  { element: 'H', position: [19.64, 19.48, 20.89] as [number, number, number] },
  { element: 'H', position: [19.64, 19.48, 19.11] as [number, number, number] },
]

const WATER = [
  { element: 'O', position: [30, 30, 30] as [number, number, number] },
  { element: 'H', position: [30.96, 30, 30] as [number, number, number] },
  { element: 'H', position: [29.76, 30.93, 30] as [number, number, number] },
]

function loadedStore() {
  const store = createCrystalStore()
  store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: true }))
  return store
}

function countIn(store: ReturnType<typeof loadedStore>, groupId: string): number {
  const { atoms, structureGroups } = store.getState()
  return atoms.filter((atom) => atomBelongsToGroup(atom, groupId, structureGroups)).length
}

describe('生物场景结构图层', () => {
  it('装载生物文档即建立 Base 层（图层树常驻，不必等合并）', () => {
    const store = loadedStore()
    const { structureGroups, atoms } = store.getState()
    expect(structureGroups.map((group) => group.name)).toEqual(['Base'])
    expect(countIn(store, structureGroups[0].id)).toBe(atoms.length)
  })

  it('拖入分子生成 Base + 子层，成员数与母层总数一致', () => {
    const store = loadedStore()
    expect(store.getState().appendBioHetComponent('Methane.xyz', METHANE)).toBe(true)

    const { structureGroups, atoms, activeGroupId } = store.getState()
    expect(structureGroups.map((group) => group.name)).toEqual(['Base', 'Methane'])
    expect(countIn(store, structureGroups[0].id)).toBe(3)
    expect(countIn(store, structureGroups[1].id)).toBe(5)
    expect(atoms).toHaveLength(8)
    // A new layer becomes active, matching periodic merge behavior.
    expect(activeGroupId).toBe(structureGroups[1].id)
  })

  it('归属按残基身份键推导，重解析（删原子）后不失效', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    const ligandGroupId = store.getState().structureGroups[1].id

    // Deleting a polymer atom reparses bioStructure and rebuilds atom ids.
    const polymerAtomId = store.getState().atoms.find((atom) => atom.groupId === undefined)!.id
    store.getState().deleteBioAtoms(new Set([polymerAtomId]))

    expect(store.getState().bioStructure).not.toBeNull()
    expect(countIn(store, ligandGroupId)).toBe(5)
    expect(countIn(store, store.getState().structureGroups[0].id)).toBe(2)
  })

  it('删除子层移除其原子但保留 Base（图层树是常驻主干）', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)

    store.getState().removeGroup(store.getState().structureGroups[1].id)

    const { structureGroups, atoms } = store.getState()
    expect(structureGroups.map((group) => group.name)).toEqual(['Base'])
    expect(store.getState().activeGroupId).toBeNull()
    expect(atoms).toHaveLength(3)
    expect(store.getState().bioStructure).not.toBeNull()
    // Base covers every remaining atom.
    expect(countIn(store, structureGroups[0].id)).toBe(3)
  })

  it('Base 不可删除（删它等于删整个结构）', () => {
    const store = loadedStore()
    store.getState().removeGroup(store.getState().structureGroups[0].id)

    expect(store.getState().structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(store.getState().atoms).toHaveLength(3)
  })

  it('从选区提取新层：按整残基提升，Base 相应减少', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)

    // Selecting one methane atom promotes the entire LIG residue.
    const methaneGroupId = store.getState().structureGroups[1].id
    const oneMethaneAtom = store
      .getState()
      .atoms.find((atom) => atom.groupId === methaneGroupId)!
    store.getState().selectAtom(oneMethaneAtom.id, false)

    const created = store.getState().createGroupFromSelection('Fragment')
    expect(created).not.toBeNull()

    const { structureGroups } = store.getState()
    expect(structureGroups.map((g) => g.name)).toEqual(['Base', 'Methane', 'Fragment'])
    // Partial selection moves the entire residue and all five atoms into the new layer.
    expect(countIn(store, created!)).toBe(5)
    expect(countIn(store, methaneGroupId)).toBe(0)
    expect(store.getState().activeGroupId).toBe(created!)
  })

  it('空选区不产生图层', () => {
    const store = loadedStore()
    expect(store.getState().createGroupFromSelection('Nope')).toBeNull()
    expect(store.getState().structureGroups).toHaveLength(1)
  })

  it('复制单残基子层：原子数翻倍且位置平移', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    const sourceId = store.getState().structureGroups[1].id

    const copyId = store.getState().duplicateGroup(sourceId)
    expect(copyId).not.toBeNull()
    expect(store.getState().atoms).toHaveLength(13)
    expect(countIn(store, copyId!)).toBe(5)

    // Translate the duplicate along X so it does not overlap the source.
    const sourceMaxX = Math.max(
      ...store.getState().atoms.filter((a) => a.groupId === sourceId).map((a) => (a.cartesian ?? a.position)[0]),
    )
    const copyMinX = Math.min(
      ...store.getState().atoms.filter((a) => a.groupId === copyId).map((a) => (a.cartesian ?? a.position)[0]),
    )
    expect(copyMinX).toBeGreaterThan(sourceMaxX)
  })

  it('多残基层不支持复制（需要链级拓扑克隆）', () => {
    const store = loadedStore()
    // Base contains polymer residues rather than a single HET component.
    expect(store.getState().duplicateGroup(store.getState().structureGroups[0].id)).toBeNull()
  })

  it('solo 隔离：只留该层，退出后恢复', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    const [base, methane] = store.getState().structureGroups

    store.getState().toggleSoloGroup(methane.id)
    let hidden = hiddenGroupIds(store.getState().structureGroups, store.getState().soloGroupId)
    expect(hidden.has(base.id)).toBe(true)
    expect(hidden.has(methane.id)).toBe(false)

    store.getState().toggleSoloGroup(methane.id)
    hidden = hiddenGroupIds(store.getState().structureGroups, store.getState().soloGroupId)
    expect(hidden.size).toBe(0)
  })

  it('隐藏图层只影响显示，不改变结构原子数', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    const methaneId = store.getState().structureGroups[1].id

    store.getState().toggleGroupVisible(methaneId)

    // Visibility is visual only; atoms and bioStructure used by export and computation remain unchanged.
    expect(store.getState().atoms).toHaveLength(8)
    expect(store.getState().bioStructure!.atoms).toHaveLength(8)
    expect(hiddenGroupIds(store.getState().structureGroups, null).has(methaneId)).toBe(true)
  })

  it('拖入组分按配体分类，不因残基名撞标准残基而落进聚合物', () => {
    const store = loadedStore()
    // "Methane.xyz" begins with MET. Avoid classifying the imported ligand as methionine polymer,
    // which would enter cartoon rendering without a backbone and become invisible.
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)

    const structure = store.getState().bioStructure!
    const classified = classifyBioSubsystemAtoms(structure)
    expect(classified.ligand.size).toBe(5)
    expect(classified.polymer.size).toBe(3)
    expect(structure.residues.every((residue) => residue.name !== 'MET')).toBe(true)
  })

  it('拖入的水保留 HOH 并归入 water 子系统，不被改名成 LIG 当配体', () => {
    const store = loadedStore()
    // Preserve HOH so subsystem selection and interactions continue to recognize water, not ligand.
    expect(store.getState().appendBioHetComponent('HOH.xyz', WATER)).toBe(true)

    const structure = store.getState().bioStructure!
    const classified = classifyBioSubsystemAtoms(structure)
    expect(structure.residues.some((residue) => residue.name === 'HOH')).toBe(true)
    expect(classified.water.size).toBe(3)
    expect(classified.ligand.size).toBe(0)
  })

  it('占位 LIG 在标注上显示所属图层真名，真实残基名不被覆盖', () => {
    const store = loadedStore()
    // Methane falls back from colliding MET to LIG, but its displayed name remains Methane.
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    // ATP is a precise chemical identity and must not be replaced by the layer name.
    store.getState().appendBioHetComponent('ATP.xyz', METHANE)

    const structure = store.getState().bioStructure!
    const displayNames = biomoleculePlaceholderDisplayNames(structure, store.getState().structureGroups)!
    const shown = structure.residues.map((residue) => displayNames.get(bioResidueKey(residue.identity)))

    expect(shown).toContain('Methane')
    // ATP and polymer GLY retain their own names and stay out of the placeholder map.
    expect(shown.filter((name) => name !== undefined)).toEqual(['Methane'])
  })

  it('设计候选标签不被截成假代号，水图层副本仍是水', () => {
    const store = loadedStore()
    // A Boltz layer name such as "Cand 1 · 0.87" must not be truncated into a misleading CAN residue.
    store.getState().appendBioHetComponent('Cand 1 · 0.87', METHANE)
    // Do not turn every multiword label into LIG; "HOH copy" must retain water identity.
    store.getState().appendBioHetComponent('HOH copy', WATER)

    const structure = store.getState().bioStructure!
    expect(structure.residues.every((residue) => residue.name !== 'CAN')).toBe(true)
    expect(structure.residues.some((residue) => residue.name === 'HOH')).toBe(true)
    expect(classifyBioSubsystemAtoms(structure).water.size).toBe(3)

    // Once normalized to placeholder LIG, display logic can show the real layer name.
    const displayNames = biomoleculePlaceholderDisplayNames(structure, store.getState().structureGroups)!
    const shown = structure.residues.map((residue) => displayNames.get(bioResidueKey(residue.identity)))
    expect(shown).toContain('Cand 1 · 0.87')
  })

  it('隐藏图层从 BioStructure 裁掉，cartoon 无法绕过', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Ligand.xyz', METHANE)
    const { structureGroups, atoms } = store.getState()
    const source = store.getState().bioStructure!
    const baseId = structureGroups[0].id
    const hidden = new Set(
      atoms.filter((a) => atomBelongsToGroup(a, baseId, structureGroups)).map((a) => a.id),
    )

    // Hiding Base must remove polymer residues from the visible structure, not only from an atom list.
    const visible = visibleBioStructure(source, atoms, hidden)
    expect(visible).not.toBeNull()
    expect(visible!.atoms).toHaveLength(5)
    expect(classifyBioSubsystemAtoms(visible!).polymer.size).toBe(0)

    // No hidden atoms returns the source; hiding all atoms returns null rather than showing everything.
    expect(visibleBioStructure(source, atoms, null)!.atoms).toHaveLength(8)
    expect(visibleBioStructure(source, atoms, new Set(source.atoms.map((a) => a.id)))).toBeNull()
  })

  it('换生物文档重建 Base，不残留上一份结构的子层', () => {
    const store = loadedStore()
    store.getState().appendBioHetComponent('Methane.xyz', METHANE)
    expect(store.getState().structureGroups).toHaveLength(2)

    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: true }))

    expect(store.getState().structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(store.getState().atoms.every((atom) => atom.groupId === undefined)).toBe(true)
  })
})
