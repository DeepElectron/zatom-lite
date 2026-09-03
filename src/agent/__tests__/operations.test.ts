import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  applyStructureOperations,
  evaluateStructureSelection,
  parseStructureOperations,
  parseStructureSelection,
  StructureOperationInputError,
  type StructureOperation,
} from '../operations'
import { fingerprintStructure } from '../structure-math'

const periodicParent: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'periodic parent',
  lattice: { vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], periodic: [true, true, true] },
  atoms: [
    { id: 'a', element: 'Si', position: [0, 0, 0] },
    { id: 'b', element: 'Si', position: [1, 1, 1] },
  ],
}

function approximate(actual: number, expected: number, tolerance = 1e-10) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testComposablePeriodicPipeline() {
  const operations = parseStructureOperations([
    { op: 'supercell', scaling: [2, 1, 1] },
    { op: 'substitute', selection: { parentAtomIds: ['a'] }, element: 'Ge', count: 1, seed: 7 },
    { op: 'vacancy', selection: { atomIds: ['b@1,0,0'] } },
    { op: 'interstitial', atoms: [{ id: 'oxygen-contact', element: 'O', position: [3, 1, 1] }] },
    { op: 'translate', selection: { elements: ['Ge'] }, vector: [0, 0, 0.2] },
    { op: 'affine', matrix: [[1.1, 0, 0], [0, 1, 0], [0, 0, 1]], deformLattice: true },
    { op: 'wrap' },
  ])
  const first = applyStructureOperations({ structure: periodicParent, operations, seed: 99 })
  const second = applyStructureOperations({ structure: periodicParent, operations, seed: 99 })

  assertEqual(first.structure.atoms.length, 4)
  assertTrue(Math.abs((first.structure.lattice?.vectors[0][0] ?? 0) - 4.4) < 1e-10)
  assertEqual(first.structure.atoms.filter((atom) => atom.element === 'Ge').length, 1)
  assertEqual(first.structure.atoms.filter((atom) => atom.element === 'O').length, 1)
  assertEqual(first.validation.verdict, 'pass')
  assertEqual(first.operations.length, 7)
  assertEqual(first.changeSet.addedCount, 4)
  assertEqual(first.changeSet.removedCount, 2)
  assertTrue(first.inspectionTargets.length >= 1)
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
}

function testInPlaceChangeSetClassifiesEveryMutation() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'c-1', element: 'C', position: [0, 0, 0] },
      { id: 'c-2', element: 'C', position: [2, 0, 0] },
      { id: 'c-3', element: 'C', position: [4, 0, 0] },
    ],
  }
  const operations: StructureOperation[] = [
    { op: 'substitute', selection: { atomIds: ['c-1'] }, element: 'N' },
    { op: 'translate', selection: { atomIds: ['c-2'] }, vector: [0, 1, 0] },
    { op: 'vacancy', selection: { atomIds: ['c-3'] } },
    { op: 'interstitial', atoms: [{ id: 'h-new', element: 'H', position: [6, 0, 0] }] },
  ]
  const result = applyStructureOperations({ structure: source, operations })
  assertEqual(result.changeSet.kind, 'mutate')
  assertEqual(result.changeSet.addedCount, 1)
  assertEqual(result.changeSet.removedCount, 1)
  assertEqual(result.changeSet.movedCount, 1)
  assertEqual(result.changeSet.relabeledCount, 1)
  assertEqual(result.changeSet.maxPositionDisplacementA, 1)
  assertEqual(result.validation.verdict, 'pass')
}

function testSetPositionsUsesExactIdsAndAbsoluteCoordinates() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'fixed', element: 'C', position: [0, 0, 0] },
      { id: 'move-a', element: 'C', position: [2, 0, 0] },
      { id: 'move-b', element: 'H', position: [3, 0, 0] },
    ],
    bonds: [{ id: 'moving-bond', atomIds: ['move-a', 'move-b'], order: 1 }],
  }
  const result = applyStructureOperations({
    structure: source,
    operations: parseStructureOperations([{
      op: 'set_positions',
      positions: [
        { atomId: 'move-a', position: [2, 1, 0] },
        { atomId: 'move-b', position: [3, 1, 0] },
      ],
    }]),
  })

  assertDeepEqual(result.structure.atoms.map((atom) => atom.position), [
    [0, 0, 0],
    [2, 1, 0],
    [3, 1, 0],
  ])
  assertDeepEqual(result.structure.bonds, source.bonds)
  assertEqual(result.operations[0].selectedAtomCount, 2)
  assertEqual(result.operations[0].changedAtomCount, 2)
  assertEqual(result.changeSet.movedCount, 2)
  assertTrue(result.checks.some((check) => check.id === 'operation.1.absolute_positions' && check.status === 'pass'))
  assertEqual(result.validation.verdict, 'pass')
}

function testSetLatticeHasExplicitCoordinateSemantics() {
  const vectors: [[number, number, number], [number, number, number], [number, number, number]] = [
    [4, 0, 0],
    [0, 3, 0],
    [0, 0, 8],
  ]
  const preserveCartesian = applyStructureOperations({
    structure: periodicParent,
    operations: parseStructureOperations([{
      op: 'set_lattice',
      vectors,
      periodic: [true, false, true],
      coordinateMode: 'preserve-cartesian',
    }]),
  })
  assertDeepEqual(preserveCartesian.structure.atoms.map((atom) => atom.position), periodicParent.atoms.map((atom) => atom.position))
  assertDeepEqual(preserveCartesian.structure.lattice, { vectors, periodic: [true, false, true] })
  assertEqual(preserveCartesian.operations[0].changedAtomCount, 0)
  assertEqual(preserveCartesian.changeSet.latticeChanged, true)
  assertTrue(preserveCartesian.checks.some((check) => check.id === 'operation.1.lattice' && check.status === 'pass'))

  const skewSource: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[2, 0, 0], [1, 3, 0], [0.5, 0.25, 4]], periodic: [true, true, true] },
    atoms: [
      { id: 'origin', element: 'Si', position: [0, 0, 0] },
      { id: 'fractional-site', element: 'Si', position: [1.375, 1.6875, 3] },
    ],
  }
  const preserveFractional = applyStructureOperations({
    structure: skewSource,
    operations: parseStructureOperations([{
      op: 'set_lattice',
      vectors,
      periodic: [true, true, true],
      coordinateMode: 'preserve-fractional',
    }]),
  })
  assertDeepEqual(preserveFractional.structure.atoms[0].position, [0, 0, 0])
  assertDeepEqual(preserveFractional.structure.atoms[1].position, [1, 1.5, 6])
  assertEqual(preserveFractional.operations[0].changedAtomCount, 1)
  assertEqual(preserveFractional.changeSet.movedCount, 1)
  assertEqual(preserveFractional.changeSet.latticeChanged, true)
  assertEqual(preserveFractional.validation.verdict, 'pass')

  let missingSourceLattice: unknown
  try {
    applyStructureOperations({
      structure: {
        schemaVersion: ZATOM_STRUCTURE_SCHEMA,
        atoms: [{ id: 'finite', element: 'He', position: [0, 0, 0] }],
      },
      operations: parseStructureOperations([{
        op: 'set_lattice',
        vectors,
        periodic: [false, false, false],
        coordinateMode: 'preserve-fractional',
      }]),
    })
  } catch (error) {
    missingSourceLattice = error
  }
  assertTrue(missingSourceLattice instanceof StructureOperationInputError)
  assertEqual((missingSourceLattice as StructureOperationInputError).code, 'lattice_required')
}

async function testAbsolutePositionAndLatticeFailuresNeverWrite() {
  let active = structuredClone(periodicParent)
  let writeCount = 0
  const context: ZatomToolContext = {
    readStructure: () => structuredClone(active),
    writeStructure: (structure) => {
      writeCount++
      active = structuredClone(structure)
    },
  }
  const sourceFingerprint = fingerprintStructure(active)

  const missingId = await callZatomMcpTool('structure_apply_operations', {
    operations: [{
      op: 'set_positions',
      positions: [
        { atomId: 'a', position: [0.25, 0, 0] },
        { atomId: 'absent', position: [1.25, 1, 1] },
      ],
    }],
    applyToWorkspace: true,
  }, context)
  assertEqual(missingId.structuredContent.ok, false)
  assertEqual(missingId.structuredContent.error?.code, 'position_atom_ids_missing')
  assertEqual(writeCount, 0)
  assertEqual(fingerprintStructure(active), sourceFingerprint)

  const singularLattice = await callZatomMcpTool('structure_apply_operations', {
    operations: [{
      op: 'set_lattice',
      vectors: [[2, 0, 0], [4, 0, 0], [0, 0, 2]],
      periodic: [true, true, true],
      coordinateMode: 'preserve-fractional',
    }],
    applyToWorkspace: true,
  }, context)
  assertEqual(singularLattice.structuredContent.ok, false)
  assertEqual(singularLattice.structuredContent.error?.code, 'invalid_lattice')
  assertEqual(writeCount, 0)
  assertEqual(fingerprintStructure(active), sourceFingerprint)

  const overlappingPosition = await callZatomMcpTool('structure_apply_operations', {
    operations: [{
      op: 'set_positions',
      positions: [{ atomId: 'b', position: [0, 0, 0] }],
    }],
    applyToWorkspace: true,
  }, context)
  const overlapData = overlappingPosition.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    result: { validation: { verdict: string } }
  }
  assertEqual(overlappingPosition.structuredContent.ok, true)
  assertEqual(overlapData.result.validation.verdict, 'fail')
  assertEqual(overlapData.applicationBlocked, true)
  assertEqual(overlapData.appliedToWorkspace, false)
  assertEqual(writeCount, 0)
  assertEqual(fingerprintStructure(active), sourceFingerprint)

  for (const invalid of [
    [{ op: 'set_positions', positions: [{ atomId: 'a', position: [Number.NaN, 0, 0] }] }],
    [{
      op: 'set_positions',
      positions: [
        { atomId: 'a', position: [0, 0, 0] },
        { atomId: 'a', position: [1, 0, 0] },
      ],
    }],
  ]) {
    let caught: unknown
    try {
      parseStructureOperations(invalid)
    } catch (error) {
      caught = error
    }
    assertTrue(caught instanceof StructureOperationInputError)
  }
}

async function testFailingCandidateCannotOverwriteViewport() {
  let writeCount = 0
  const context: ZatomToolContext = {
    readStructure: () => periodicParent,
    writeStructure: () => { writeCount++ },
  }
  const response = await callZatomMcpTool('structure_apply_operations', {
    operations: [{ op: 'interstitial', atoms: [{ id: 'overlap', element: 'H', position: [0, 0, 0] }] }],
    applyToWorkspace: true,
  }, context)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    result: { validation: { verdict: string } }
  }
  assertTrue(response.structuredContent.ok, 'candidate generation itself should succeed')
  assertEqual(data.result.validation.verdict, 'fail')
  assertEqual(data.applicationBlocked, true)
  assertEqual(data.appliedToWorkspace, false)
  assertEqual(writeCount, 0)
}

function testEveryExplicitSelectorIdMustExist() {
  for (const operation of [
    { op: 'vacancy', selection: { atomIds: ['a', 'typo-id'] } },
    { op: 'translate', selection: { parentAtomIds: ['a', 'typo-parent'] }, vector: [1, 0, 0] },
    { op: 'vacancy', selection: { atomIds: ['typo-id'], invert: true } },
  ] as StructureOperation[]) {
    let caught = false
    try {
      applyStructureOperations({ structure: periodicParent, operations: [operation] })
    } catch (error) {
      caught = error instanceof StructureOperationInputError && error.code === 'missing_selector_ids'
    }
    assertTrue(caught, 'an exact selector must never continue after any requested ID is absent')
  }
}

function testPeriodicSphereRequiresPeriodicLattice() {
  let caught = false
  try {
    applyStructureOperations({
      structure: {
        schemaVersion: ZATOM_STRUCTURE_SCHEMA,
        atoms: [
          { id: 'a', element: 'C', position: [0, 0, 0] },
          { id: 'b', element: 'C', position: [1, 0, 0] },
        ],
      },
      operations: [{
        op: 'translate',
        selection: { sphere: { center: [0, 0, 0], radius: 0.5, periodic: true } },
        vector: [0, 1, 0],
      }],
    })
  } catch (error) {
    caught = error instanceof StructureOperationInputError && error.code === 'periodic_lattice_required'
  }
  assertTrue(caught, 'periodic selection must not silently degrade to finite Euclidean distance')
}

function testFractionalBoxAndCartesianHalfSpaceSelections() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[2, 0, 0], [1, 2, 0], [0, 0, 4]], periodic: [true, true, true] },
    atoms: [
      { id: 'wrapped-low', element: 'Si', position: [2.3, 0.2, 0.4] },
      { id: 'high', element: 'Si', position: [1.5, 0.2, 3.2] },
    ],
  }
  const result = applyStructureOperations({
    structure: source,
    operations: parseStructureOperations([
      {
        op: 'substitute',
        selection: { fractionalBox: { min: [0, 0, 0], max: [0.3, 0.3, 0.3] } },
        element: 'B',
      },
      {
        op: 'translate',
        selection: {
          elements: ['B'],
          cartesianHalfSpace: { origin: [0, 0, 2], normal: [0, 0, 4], side: 'negative' },
        },
        vector: [0, 0, 0.2],
      },
    ]),
  })

  assertEqual(result.operations[0].selectedAtomCount, 1)
  assertEqual(result.operations[1].selectedAtomCount, 1)
  assertEqual(result.structure.atoms[0].element, 'B')
  approximate(result.structure.atoms[0].position[2], 0.6)
  assertEqual(result.structure.atoms[1].element, 'Si')
  approximate(result.structure.atoms[1].position[2], 3.2)
}

function testFractionalBoxRequiresLattice() {
  let caught = false
  try {
    applyStructureOperations({
      structure: {
        schemaVersion: ZATOM_STRUCTURE_SCHEMA,
        atoms: [
          { id: 'a', element: 'C', position: [0, 0, 0] },
          { id: 'b', element: 'C', position: [1, 0, 0] },
        ],
      },
      operations: parseStructureOperations([{
        op: 'translate',
        selection: { fractionalBox: { min: [0, 0, 0], max: [0.5, 0.5, 0.5] } },
        vector: [0, 1, 0],
      }]),
    })
  } catch (error) {
    caught = error instanceof StructureOperationInputError && error.code === 'lattice_required'
  }
  assertTrue(caught, 'fractional selection must not guess a basis when no lattice exists')
}

function testCylinderAndOrderedSelectionCombinations() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: Array.from({ length: 25 }, (_, index) => {
      const x = (index % 5) - 2
      const y = Math.floor(index / 5) - 2
      return { id: `grid:${x}:${y}`, element: 'Si', position: [x, y, 0] }
    }),
  }
  const rawSelection = {
    cartesianHalfSpace: { origin: [0, 0, 0], normal: [0, 1, 0], side: 'negative' },
    combine: [
      { operator: 'subtract', selection: { sphere: { center: [1, 0, 0], radius: 0.1 } } },
      { operator: 'union', selection: { cylinder: { axisPoint: [0, 0, 0], axis: [0, 4, 0], radius: 0.1 } } },
    ],
  }
  const selection = parseStructureSelection(rawSelection)
  const selected = evaluateStructureSelection(source, selection)
  assertEqual(selected.atomIds.length, 16)
  assertTrue(selected.atomIds.includes('grid:0:2'), 'the cylindrical pillar must extend above the base half-space')
  assertTrue(!selected.atomIds.includes('grid:1:0'), 'the spherical subtraction must remove its selected atom')
  assertTrue(!selected.atomIds.includes('grid:2:2'), 'unselected space must stay outside the composite region')
  assertDeepEqual(selection.combine?.[1].selection.cylinder?.axis, [0, 1, 0])

  const inverted = evaluateStructureSelection(source, parseStructureSelection({ ...rawSelection, invert: true }))
  assertEqual(inverted.atomIds.length, 9)

  let missingId: unknown
  try {
    evaluateStructureSelection(source, parseStructureSelection({
      all: true,
      combine: [{ operator: 'subtract', selection: { atomIds: ['absent'] } }],
    }))
  } catch (error) {
    missingId = error
  }
  assertTrue(missingId instanceof StructureOperationInputError)
  assertEqual((missingId as StructureOperationInputError).code, 'missing_selector_ids')
}

function testTopologySurvivesReplicationAndVacancy() {
  const molecule: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
    atoms: [
      { id: 'h-left', element: 'H', position: [0, 0, 0] },
      { id: 'h-right', element: 'H', position: [0.74, 0, 0] },
    ],
    bonds: [{ id: 'h-bond', atomIds: ['h-left', 'h-right'], order: 1 }],
  }
  const result = applyStructureOperations({
    structure: molecule,
    operations: [
      { op: 'supercell', scaling: [2, 1, 1] },
      { op: 'vacancy', selection: { atomIds: ['h-left@0,0,0'] } },
    ],
  })
  assertEqual(result.structure.bonds?.length, 1)
  assertDeepEqual(result.structure.bonds?.[0].atomIds, ['h-left@1,0,0', 'h-right@1,0,0'])
  assertEqual(result.changeSet.addedBondCount, 1)
  assertEqual(result.changeSet.removedBondCount, 1)
  assertTrue(result.validation.checks.some((check) => check.id === 'structure.bond_endpoints_present' && check.status === 'pass'))
}

function testExplicitBondDsl() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'c', element: 'C', position: [0, 0, 0] },
      { id: 'o', element: 'O', position: [1.2, 0, 0] },
    ],
  }
  const operations = parseStructureOperations([
    { op: 'bond_add', bonds: [{ id: 'co', atomIds: ['c', 'o'], order: 1 }] },
    { op: 'bond_set_order', bondIds: ['co'], order: 2 },
  ])
  const result = applyStructureOperations({ structure: source, operations })
  assertEqual(result.structure.bonds?.length, 1)
  assertEqual(result.structure.bonds?.[0].order, 2)
  assertEqual(result.changeSet.addedBondCount, 1)
  assertEqual(result.operations[0].changedBondCount, 1)
  assertEqual(result.operations[1].changedBondCount, 1)
  assertTrue(result.validation.checks.some((check) => check.id === 'structure.bond_orders_supported' && check.status === 'pass'))
}

function testRigidRotationPreservesTopologyAndLocalizesBoundary() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'fixed', element: 'C', position: [0, 0, 0] },
      { id: 'moving-a', element: 'C', position: [1, 0, 0] },
      { id: 'moving-b', element: 'C', position: [2, 0, 0] },
    ],
    bonds: [
      { id: 'boundary', atomIds: ['fixed', 'moving-a'], order: 1 },
      { id: 'internal', atomIds: ['moving-a', 'moving-b'], order: 1 },
    ],
  }
  const result = applyStructureOperations({
    structure: source,
    operations: parseStructureOperations([{
      op: 'rotate',
      selection: { atomIds: ['moving-a', 'moving-b'] },
      axis: [0, 0, 4],
      angleDeg: 90,
      origin: [0, 0, 0],
    }]),
  })
  const movingA = result.structure.atoms.find((atom) => atom.id === 'moving-a')!
  const movingB = result.structure.atoms.find((atom) => atom.id === 'moving-b')!
  approximate(movingA.position[0], 0)
  approximate(movingA.position[1], 1)
  approximate(movingB.position[0], 0)
  approximate(movingB.position[1], 2)
  approximate(Math.hypot(
    movingB.position[0] - movingA.position[0],
    movingB.position[1] - movingA.position[1],
    movingB.position[2] - movingA.position[2],
  ), 1)
  assertTrue(result.checks.some((check) => check.id === 'operation.1.rigid_rotation' && check.status === 'pass'))
  assertTrue(result.checks.some((check) => check.id === 'operation.1.rotation_boundary_bonds' && check.status === 'warn'))
  assertTrue(result.inspectionTargets.some((target) => target.id === 'structure-operation-rotation-boundary-bonds'))
}

function testDirectionAlignmentAndWholeCellRotation() {
  const finite: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'left', element: 'H', position: [0, 0, 0] },
      { id: 'right', element: 'H', position: [1, 0, 0] },
    ],
    bonds: [{ id: 'h2', atomIds: ['left', 'right'], order: 1 }],
  }
  const aligned = applyStructureOperations({
    structure: finite,
    operations: parseStructureOperations([{
      op: 'align',
      fromVector: [2, 0, 0],
      toVector: [0, 5, 0],
    }]),
  })
  approximate(aligned.structure.atoms[0].position[0], 0.5)
  approximate(aligned.structure.atoms[0].position[1], -0.5)
  approximate(aligned.structure.atoms[1].position[0], 0.5)
  approximate(aligned.structure.atoms[1].position[1], 0.5)
  assertTrue(aligned.checks.some((check) => check.id === 'operation.1.direction_alignment' && check.status === 'pass'))

  const rotatedCell = applyStructureOperations({
    structure: periodicParent,
    operations: parseStructureOperations([{
      op: 'rotate', axis: [0, 0, 1], angleDeg: 90, origin: [0, 0, 0],
    }]),
  })
  assertDeepEqual(rotatedCell.structure.lattice?.periodic, [true, true, true])
  approximate(rotatedCell.structure.lattice!.vectors[0][0], 0)
  approximate(rotatedCell.structure.lattice!.vectors[0][1], 2)
  approximate(rotatedCell.structure.lattice!.vectors[1][0], -2)
  approximate(rotatedCell.structure.atoms[1].position[0], -1)
  approximate(rotatedCell.structure.atoms[1].position[1], 1)
  assertEqual(rotatedCell.changeSet.latticeChanged, true)
  assertTrue(rotatedCell.checks.some((check) => check.id === 'operation.1.rotation_cell_scope' && check.status === 'pass'))
  assertTrue(rotatedCell.inspectionTargets.some((target) => target.id === 'structure-operation-cell-overview'))

  const fullTurn = applyStructureOperations({
    structure: periodicParent,
    operations: parseStructureOperations([{
      op: 'rotate', axis: [0, 0, 1], angleDeg: 360, origin: [0, 0, 0],
    }]),
  })
  assertEqual(fullTurn.changeSet.latticeChanged, false)
  assertEqual(fingerprintStructure(fullTurn.structure), fingerprintStructure(periodicParent))
}

function testAmbiguousOrInvalidRotationIsRejected() {
  let zeroAxis: unknown
  try {
    parseStructureOperations([{ op: 'rotate', axis: [0, 0, 0], angleDeg: 20 }])
  } catch (error) {
    zeroAxis = error
  }
  assertTrue(zeroAxis instanceof StructureOperationInputError)
  assertEqual((zeroAxis as StructureOperationInputError).code, 'invalid_direction')

  let antiparallel: unknown
  try {
    applyStructureOperations({
      structure: periodicParent,
      operations: parseStructureOperations([{
        op: 'align', fromVector: [1, 0, 0], toVector: [-1, 0, 0],
      }]),
    })
  } catch (error) {
    antiparallel = error
  }
  assertTrue(antiparallel instanceof StructureOperationInputError)
  assertEqual((antiparallel as StructureOperationInputError).code, 'ambiguous_antiparallel_alignment')

  const resolved = applyStructureOperations({
    structure: periodicParent,
    operations: parseStructureOperations([{
      op: 'align',
      fromVector: [1, 0, 0],
      toVector: [-1, 0, 0],
      antiparallelAxis: [0, 0, 1],
      rotateLattice: false,
    }]),
  })
  assertTrue(resolved.checks.some((check) => check.id === 'operation.1.direction_alignment' && check.status === 'pass'))
}

async function testRotationMcpContract() {
  const response = await callZatomMcpTool('structure_apply_operations', {
    structure: periodicParent,
    operations: [{
      op: 'rotate', axis: [0, 0, 1], angleDeg: 45, origin: [0, 0, 0], rotateLattice: true,
    }],
    applyToWorkspace: false,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    result: { operations: Array<{ op: string }>; checks: Array<{ id: string; status: string }> }
    appliedToWorkspace: boolean
  }
  assertEqual(data.appliedToWorkspace, false)
  assertEqual(data.result.operations[0].op, 'rotate')
  assertTrue(data.result.checks.some((check) => check.id === 'operation.1.rigid_rotation' && check.status === 'pass'))
}

async function testSpatialSelectionMcpContract() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 2]], periodic: [true, true, true] },
    atoms: [{ id: 'site', element: 'Si', position: [0.5, 0.5, 1] }],
  }
  const response = await callZatomMcpTool('structure_apply_operations', {
    structure: source,
    operations: [
      { op: 'supercell', scaling: [4, 4, 1] },
      {
        op: 'vacancy',
        selection: {
          all: true,
          combine: [{
            operator: 'intersect',
            selection: { cylinder: { axisPoint: [2, 2, 0], axis: [0, 0, 1], radius: 1 }, invert: true },
          }],
        },
      },
      { op: 'set_periodicity', periodic: [false, false, true] },
    ],
    applyToWorkspace: false,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    result: {
      structure: ZatomStructure
      operations: Array<{ selectedAtomCount: number }>
      provenance: { engineVersion: string }
      checks: Array<{ id: string; status: string }>
      validation: { verdict: string }
      inspectionTargets: Array<{ id: string }>
    }
  }
  assertEqual(data.result.structure.atoms.length, 4)
  assertDeepEqual(data.result.structure.lattice?.periodic, [false, false, true])
  assertTrue(data.result.structure.atoms.every((atom) => Math.hypot(atom.position[0] - 2, atom.position[1] - 2) <= 1 + 1e-12))
  assertTrue(data.result.validation.verdict !== 'fail')
  assertTrue(data.result.checks.some((check) => check.id === 'operation.3.periodicity' && check.status === 'pass'))
  assertTrue(data.result.inspectionTargets.some((target) => target.id === 'structure-operation-cell-overview'))
  assertEqual(data.result.provenance.engineVersion, '7.0.0')
}

async function testReadOnlySelectionToolContract() {
  const response = await callZatomMcpTool('structure_select_atoms', {
    structure: periodicParent,
    selection: {
      fractionalBox: { min: [0, 0, 0], max: [0.1, 0.1, 0.1] },
      cartesianHalfSpace: { origin: [0, 0, 0.5], normal: [0, 0, 1], side: 'negative' },
      combine: [{ operator: 'union', selection: { atomIds: ['b'] } }],
    },
    maxSelectedAtoms: 2,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    structureFingerprint: string
    atomIds: string[]
    selectedAtomCount: number
    inspectionTargets: Array<{ atomIds: string[] }>
  }
  assertEqual(data.structureFingerprint, fingerprintStructure(periodicParent))
  assertDeepEqual(data.atomIds, ['a', 'b'])
  assertEqual(data.selectedAtomCount, 2)
  assertDeepEqual(data.inspectionTargets[0].atomIds, ['a', 'b'])
}

async function main() {
  testComposablePeriodicPipeline()
  testInPlaceChangeSetClassifiesEveryMutation()
  testSetPositionsUsesExactIdsAndAbsoluteCoordinates()
  testSetLatticeHasExplicitCoordinateSemantics()
  await testAbsolutePositionAndLatticeFailuresNeverWrite()
  await testFailingCandidateCannotOverwriteViewport()
  testEveryExplicitSelectorIdMustExist()
  testPeriodicSphereRequiresPeriodicLattice()
  testFractionalBoxAndCartesianHalfSpaceSelections()
  testFractionalBoxRequiresLattice()
  testCylinderAndOrderedSelectionCombinations()
  testTopologySurvivesReplicationAndVacancy()
  testExplicitBondDsl()
  testRigidRotationPreservesTopologyAndLocalizesBoundary()
  testDirectionAlignmentAndWholeCellRotation()
  testAmbiguousOrInvalidRotationIsRejected()
  await testRotationMcpContract()
  await testSpatialSelectionMcpContract()
  await testReadOnlySelectionToolContract()
}

void main()
