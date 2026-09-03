import { parseCIF } from '../lib/crystal/cif-parser'
import { STRUCTURE_TEMPLATE_CIFS } from '../lib/crystal/crystal-template-cifs'
import { createCrystalStore } from '../orchestration/crystalStore'
import { TEMPLATE_DEFAULT_INSTALLED } from '../orchestration/installedTemplatesStore'
import { assertDeepEqual, assertEqual } from '../testing/assert'

const expectedAtomCounts: Record<keyof typeof STRUCTURE_TEMPLATE_CIFS, number> = {
  hcp: 2,
  bcc: 2,
  fcc: 4,
  diamond: 8,
  nacl: 8,
  perovskite: 5,
  graphite: 4,
  zincblende: 8,
  sbs6: 14,
  rutile: 6,
}

const expectedMigratedBondCounts: Record<string, number> = {
  diamond: 86,
  nacl: 12,
  perovskite: 36,
  sbs6: 12,
  rutile: 62,
}

async function run() {
  for (const id of ['diamond', 'nacl', 'perovskite', 'sbs6', 'rutile']) {
    assertEqual(TEMPLATE_DEFAULT_INSTALLED.includes(`crystal:${id}`), true, `${id} must be visible in the default template catalog`)
  }
  for (const [id, template] of Object.entries(STRUCTURE_TEMPLATE_CIFS)) {
    const parsed = parseCIF(template.cif)
    assertEqual(parsed.success, true, `${template.name} must parse through the canonical CIF path`)
    if (!parsed.success) continue
    assertEqual(parsed.data.atoms.length, expectedAtomCounts[id], `${template.name} atom count must stay canonical`)
    assertEqual(parsed.data.latticeParams.a > 0, true, `${template.name} must define a positive lattice`)
    assertEqual(parsed.data.latticeParams.b > 0, true, `${template.name} must define a positive lattice`)
    assertEqual(parsed.data.latticeParams.c > 0, true, `${template.name} must define a positive lattice`)

    const store = createCrystalStore()
    const loaded = await store.getState().loadTemplate(id)
    assertEqual(loaded.success, true, `${template.name} must load through the public template action`)
    assertEqual(store.getState().unitCellAtoms.length, expectedAtomCounts[id], `${template.name} load must preserve its canonical atom count`)
    const expectedSupercell = template.defaultSupercell ?? [1, 1, 1]
    assertDeepEqual(
      [store.getState().supercellParams.nx, store.getState().supercellParams.ny, store.getState().supercellParams.nz],
      expectedSupercell,
      `${template.name} must apply its default supercell before load resolves`,
    )
    assertEqual(
      store.getState().atoms.length,
      expectedAtomCounts[id] * expectedSupercell[0] * expectedSupercell[1] * expectedSupercell[2],
      `${template.name} must materialize the complete default supercell`,
    )
    assertDeepEqual(
      store.getState().bondSettings.elementPairRadii,
      template.bondPairRadii ?? {},
      `${template.name} must install only its own pair cutoffs`,
    )
    assertEqual(
      store.getState().bondSettings.restrictToConfiguredPairs,
      Boolean(template.bondPairRadii),
      `${template.name} must preserve explicit bond-rule semantics`,
    )
    if (template.bondPairRadii) {
      const atomsById = new Map(store.getState().atoms.map((atom) => [atom.id, atom]))
      const actualPairs = new Set(store.getState().bonds.map((bond) => {
        const first = atomsById.get(bond.atom1Id)?.element ?? ''
        const second = atomsById.get(bond.atom2Id)?.element ?? ''
        return [first, second].sort().join('-')
      }))
      assertDeepEqual(
        Array.from(actualPairs).sort(),
        Object.keys(template.bondPairRadii).sort(),
        `${template.name} must not create bonds outside its explicit rules`,
      )
    }
    if (id in expectedMigratedBondCounts) {
      // Count intra-cell bonds only. latticeOffset adds periodic boundary bonds whose count depends
      // on render extent rather than canonical intra-cell topology.
      const intraCellBonds = store.getState().bonds.filter((bond) => {
        const off = bond.latticeOffset
        return !off || (off[0] === 0 && off[1] === 0 && off[2] === 0)
      })
      assertEqual(intraCellBonds.length, expectedMigratedBondCounts[id], `${template.name} bond topology must stay canonical`)
      // Periodic bonds need nonzero offsets so they cannot degrade into duplicate intra-cell bonds.
      for (const bond of store.getState().bonds) {
        const off = bond.latticeOffset
        if (!off) continue
        assertEqual(
          off.every((v) => Number.isInteger(v)),
          true,
          `${template.name} periodic bond offsets must be integer lattice vectors`,
        )
      }
    }
    assertDeepEqual(
      Array.from(store.getState().polyhedraCentralElements).sort(),
      [...(template.polyhedraCentralElements ?? [])].sort(),
      `${template.name} must install its coordination-center selection`,
    )
    assertEqual(store.getState().latticeParams.centeringType, template.centeringType, `${template.name} must restore its conventional centering`)
    assertEqual(store.getState().latticeParams.spaceGroupNumber, template.spaceGroupNumber, `${template.name} must restore its space-group number`)
  }

  const sequential = createCrystalStore()
  for (const id of ['perovskite', 'diamond', 'rutile', 'sbs6']) {
    const template = STRUCTURE_TEMPLATE_CIFS[id]
    const loaded = await sequential.getState().loadTemplate(id)
    assertEqual(loaded.success, true, `${id} must load after another rule-bearing template`)
    assertDeepEqual(sequential.getState().bondSettings.elementPairRadii, template.bondPairRadii ?? {}, `${id} cutoffs must not leak from the previous template`)
    assertDeepEqual(Array.from(sequential.getState().polyhedraCentralElements), template.polyhedraCentralElements ?? [], `${id} centers must not leak from the previous template`)
    assertDeepEqual(
      [sequential.getState().supercellParams.nx, sequential.getState().supercellParams.ny, sequential.getState().supercellParams.nz],
      template.defaultSupercell ?? [1, 1, 1],
      `${id} supercell must not leak from the previous template`,
    )
    sequential.getState().autoDetectBonds()
    const atomById = new Map(sequential.getState().atoms.map((atom) => [atom.id, atom]))
    const pairs = new Set(sequential.getState().bonds.map((bond) => [
      atomById.get(bond.atom1Id)?.element ?? '',
      atomById.get(bond.atom2Id)?.element ?? '',
    ].sort().join('-')))
    assertDeepEqual(Array.from(pairs).sort(), Object.keys(template.bondPairRadii ?? {}).sort(), `${id} re-detection must retain its pair allowlist`)
  }

  const presetOwnership = createCrystalStore()
  presetOwnership.getState().applyCrystalStylePreset('vesta')
  await presetOwnership.getState().loadTemplate('rutile')
  assertEqual(presetOwnership.getState().stylePresetId, 'custom', 'template polyhedron defaults must invalidate a conflicting visual preset label')
  presetOwnership.getState().applyCrystalStylePreset('textbook')
  presetOwnership.getState().replaceAtomsDirectly([])
  assertEqual(presetOwnership.getState().stylePresetId, 'custom', 'structure replacement must invalidate a conflicting polyhedron preset label')

  await sequential.getState().loadTemplate('rutile')
  const movedRutileAtoms = sequential.getState().atoms.map((atom, index) => index === 0
    ? { ...atom, cartesian: atom.cartesian ? [atom.cartesian[0] + 0.01, atom.cartesian[1], atom.cartesian[2]] as [number, number, number] : atom.cartesian }
    : atom)
  sequential.getState().setAtomsDirectly(movedRutileAtoms)
  assertEqual(sequential.getState().bondSettings.restrictToConfiguredPairs, true, 'same-document atom updates must preserve template bond rules')
  assertDeepEqual(sequential.getState().bondSettings.elementPairRadii, { 'O-Ti': 2.1 }, 'same-document atom updates must preserve pair cutoffs')
  assertDeepEqual(Array.from(sequential.getState().polyhedraCentralElements), ['Ti'], 'same-document atom updates must preserve coordination centers')
  assertEqual(sequential.getState().showCoordinationPolyhedra, true, 'same-document atom updates must preserve polyhedron visibility')

  sequential.getState().replaceAtomsDirectly([
    { id: 'replace-c', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
    { id: 'replace-h', element: 'H', position: [1.09, 0, 0], cartesian: [1.09, 0, 0] },
  ])
  assertEqual(sequential.getState().bondSettings.restrictToConfiguredPairs, false, 'explicit structure replacement must clear template bond rules')
  assertDeepEqual(sequential.getState().bondSettings.elementPairRadii, {}, 'explicit structure replacement must clear pair cutoffs')
  assertDeepEqual(Array.from(sequential.getState().polyhedraCentralElements), [], 'explicit structure replacement must clear coordination centers')
  assertEqual(sequential.getState().showCoordinationPolyhedra, false, 'explicit structure replacement must clear polyhedron visibility')

  await sequential.getState().loadTemplate('sbs6')

  const xyzLoaded = await sequential.getState().loadFromXYZ('2\nCH test\nC 0 0 0\nH 1.09 0 0\n')
  assertEqual(xyzLoaded.success, true, 'ordinary XYZ must load after a rule-bearing template')
  assertEqual(sequential.getState().bondSettings.restrictToConfiguredPairs, false, 'template bond allowlists must not leak into XYZ imports')
  assertDeepEqual(sequential.getState().bondSettings.elementPairRadii, {}, 'template cutoffs must not leak into XYZ imports')
  assertDeepEqual(Array.from(sequential.getState().polyhedraCentralElements), [], 'template coordination centers must not leak into XYZ imports')
  assertEqual(sequential.getState().showCoordinationPolyhedra, false, 'template polyhedron visibility must not leak into XYZ imports')
  assertEqual(sequential.getState().bonds.length, 1, 'generic XYZ bonding must remain active after a template')

  console.log('crystal template tests passed')
}

void run()
