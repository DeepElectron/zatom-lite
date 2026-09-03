import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import {
  parseZatomOvitoPtmAnnotation,
  ZATOM_OVITO_PTM_ANNOTATION_SCHEMA,
  ZatomOvitoPtmAnnotationInputError,
} from '../ovito-ptm-annotation'

function annotatedStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      {
        id: 'fcc-site',
        element: 'Cu',
        position: [0, 0, 0],
        properties: {
          'zatom.analysis.ptm.analyzed': true,
          'zatom.analysis.ptm.structureTypeId': 1,
          'zatom.analysis.ptm.structureType': 'fcc',
          'zatom.analysis.ptm.rmsd': 0.01,
          'zatom.analysis.ptm.interatomicDistanceA': 2.55,
          'zatom.analysis.ptm.orientationXyzw': [0, 0, 0, 1],
          'zatom.analysis.ptm.orderingTypeId': 1,
          'zatom.analysis.ptm.orderingType': 'pure',
          'zatom.analysis.ptm.elasticDeformationGradientColumnMajor': [1, 0, 0, 0, 1, 0, 0, 0, 1],
          'zatom.analysis.ptm.elasticGreenLagrangeStrainMagnitude': 0,
          'zatom.analysis.ptm.elasticVolumeRatio': 1,
        },
      },
      {
        id: 'other-site',
        element: 'Cu',
        position: [2.55, 0, 0],
        properties: {
          'zatom.analysis.ptm.analyzed': true,
          'zatom.analysis.ptm.structureTypeId': 0,
          'zatom.analysis.ptm.structureType': 'other',
          'zatom.analysis.ptm.rmsd': 0.15,
          'zatom.analysis.ptm.orderingTypeId': 0,
          'zatom.analysis.ptm.orderingType': 'other',
        },
      },
      {
        id: 'second-other-site',
        element: 'Cu',
        position: [0, 2.55, 0],
        properties: {
          'zatom.analysis.ptm.analyzed': true,
          'zatom.analysis.ptm.structureTypeId': 0,
          'zatom.analysis.ptm.structureType': 'other',
          'zatom.analysis.ptm.rmsd': 0,
          'zatom.analysis.ptm.orderingTypeId': 0,
          'zatom.analysis.ptm.orderingType': 'other',
        },
      },
    ],
    metadata: {
      'zatom.analysis.ptm': {
        schemaVersion: ZATOM_OVITO_PTM_ANNOTATION_SCHEMA,
        engine: 'OVITO',
        engineVersion: '3.15.5',
        numpyVersion: '2.4.6',
        packageSha256: `sha256:${'a'.repeat(64)}`,
        rmsdCutoff: 0.1,
        enabledStructureTypes: ['fcc', 'hcp', 'bcc'],
        analyzedAtomCount: 3,
        counts: {
          other: 2,
          fcc: 1,
          hcp: 0,
          bcc: 0,
          ico: 0,
          sc: 0,
          'cubic-diamond': 0,
          'hexagonal-diamond': 0,
          graphene: 0,
        },
        recognizedFraction: 1 / 3,
        otherFraction: 2 / 3,
        maximumOtherFraction: 0.6,
        orderingEnabled: true,
        orderingCounts: {
          other: 2,
          pure: 1,
          l10: 0,
          'l12-a': 0,
          'l12-b': 0,
          b2: 0,
          'zincblende-wurtzite': 0,
          'boron-nitride': 0,
        },
        deformationGradientEnabled: true,
        deformationGradientAtomCount: 1,
        maximumElasticStrainMagnitude: 0,
        maximumElasticStrainAtomId: 'fcc-site',
        scopeWarning: 'PTM Other is not a defect label.',
        citations: ['OVITO PTM'],
      },
    },
  }
}

function testParsesCompleteCanonicalAnnotation() {
  const parsed = parseZatomOvitoPtmAnnotation(annotatedStructure())
  assertTrue(parsed !== null)
  assertEqual(parsed!.summary.engineVersion, '3.15.5')
  assertEqual(parsed!.summary.analyzedAtomCount, 3)
  assertEqual(parsed!.summary.totalAtomCount, 3)
  assertEqual(parsed!.summary.counts.fcc, 1)
  assertEqual(parsed!.atoms.get('fcc-site')?.structureType, 'fcc')
  assertEqual(parsed!.atoms.get('fcc-site')?.interatomicDistanceA, 2.55)
  assertEqual(parsed!.atoms.get('fcc-site')?.orderingType, 'pure')
  assertEqual(parsed!.atoms.get('fcc-site')?.elasticGreenLagrangeStrainMagnitude, 0)
  assertEqual(parsed!.summary.deformationGradientAtomCount, 1)
  assertEqual(parsed!.atoms.get('second-other-site')?.analyzed, true)
}

function testRejectsTypeAndCountDrift() {
  const structure = annotatedStructure()
  structure.atoms[0].properties!['zatom.analysis.ptm.structureType'] = 'bcc'
  let error: unknown
  try {
    parseZatomOvitoPtmAnnotation(structure)
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof ZatomOvitoPtmAnnotationInputError)

  const countDrift = annotatedStructure()
  const metadata = countDrift.metadata!['zatom.analysis.ptm'] as Record<string, unknown>
  ;(metadata.counts as Record<string, number>).fcc = 2
  error = null
  try {
    parseZatomOvitoPtmAnnotation(countDrift)
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof ZatomOvitoPtmAnnotationInputError)

  const invariantDrift = annotatedStructure()
  invariantDrift.atoms[0].properties!['zatom.analysis.ptm.elasticVolumeRatio'] = 1.1
  error = null
  try {
    parseZatomOvitoPtmAnnotation(invariantDrift)
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof ZatomOvitoPtmAnnotationInputError)
}

function run() {
  testParsesCompleteCanonicalAnnotation()
  testRejectsTypeAndCountDrift()
  console.log('agent OVITO PTM annotation tests passed')
}

run()
