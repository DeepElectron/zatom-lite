import { assertDeepEqual, assertEqual } from '../testing/assert'
import {
  analysisOverlayResetPatch,
  resolveAtomOverlayColor,
  stripDerivedAtomAttributes,
  stripMofAtomAttributes,
  stripPtmAtomAttributes,
  type AtomAttributes,
} from '../orchestration/slices/atom-attributes-slice'

function testResolveAtomOverlayColorPrioritizesMofOverPtm() {
  const attrs: AtomAttributes = {
    ptmAnalyzed: true,
    ptmStructureType: 'fcc',
    ptmRmsd: 0.02,
    sbu_kind: 'metal_paddlewheel',
  }

  assertEqual(
    resolveAtomOverlayColor('#abcdef', attrs, true, true),
    '#ec4899',
    'SBU color should win over PTM color',
  )
  assertEqual(
    resolveAtomOverlayColor('#abcdef', attrs, false, true),
    '#66FF66',
    'OVITO PTM color should apply when SBU coloring is off',
  )
  assertEqual(
    resolveAtomOverlayColor('#abcdef', attrs, false, false),
    '#abcdef',
    'element color should apply when overlays are off',
  )
  assertEqual(
    resolveAtomOverlayColor('#abcdef', { ...attrs, ptmAnalyzed: false }, false, true),
    '#abcdef',
    'unanalyzed atoms must retain their element color',
  )
}

function testStripMofAtomAttributesKeepsOtherFields() {
  const input: Record<string, AtomAttributes> = {
    a0: { sbu_id: 'sbu-0', sbu_kind: 'metal_cluster', bader_charge: 0.42 },
    a1: { sbu_id: 'sbu-0', sbu_kind: 'metal_cluster' },
    a2: { ptmAnalyzed: true, ptmStructureType: 'hcp', ptmRmsd: 0.03 },
  }

  assertDeepEqual(stripMofAtomAttributes(input), {
    a0: { bader_charge: 0.42 },
    a2: { ptmAnalyzed: true, ptmStructureType: 'hcp', ptmRmsd: 0.03 },
  })
}

function testStripDerivedAtomAttributesKeepsOnlyIdentityBoundFields() {
  const input: Record<string, AtomAttributes> = {
    a0: {
      bader_charge: 0,
      magmom: 2,
      ptmAnalyzed: true,
      ptmStructureType: 'bcc',
      ptmRmsd: 0.01,
      sbu_id: 'sbu-0',
      sbu_kind: 'metal_cluster',
    },
    a1: { ptmAnalyzed: false, ptmStructureType: 'other', ptmRmsd: 0 },
  }

  assertDeepEqual(stripDerivedAtomAttributes(input), {
    a0: { bader_charge: 0, magmom: 2 },
  })
}

function testStripPtmAtomAttributesKeepsUnrelatedOverlays() {
  assertDeepEqual(stripPtmAtomAttributes({
    a0: {
      bader_charge: -0.1,
      ptmAnalyzed: true,
      ptmStructureType: 'fcc',
      ptmRmsd: 0.02,
      ptmInteratomicDistanceA: 2.5,
      ptmOrderingType: 'l10',
      ptmElasticStrainMagnitude: 0.04,
      ptmElasticVolumeRatio: 0.99,
      sbu_id: 'sbu-0',
      sbu_kind: 'metal_cluster',
    },
    a1: { ptmAnalyzed: false, ptmStructureType: 'other', ptmRmsd: 0 },
  }), {
    a0: { bader_charge: -0.1, sbu_id: 'sbu-0', sbu_kind: 'metal_cluster' },
  })
}

function testAnalysisOverlayResetPatchClearsDerivedState() {
  assertDeepEqual(analysisOverlayResetPatch(), {
    atomAttributes: {},
    ptmAnalysis: null,
    mofSbus: [],
    mofRacs: [],
    mofWarnings: [],
    showMofSbuColoring: false,
    showPtmColoring: false,
    selectedSbuId: null,
    coordinationAnalysisSummary: null,
  })
}

function run() {
  testResolveAtomOverlayColorPrioritizesMofOverPtm()
  testStripMofAtomAttributesKeepsOtherFields()
  testStripDerivedAtomAttributesKeepsOnlyIdentityBoundFields()
  testStripPtmAtomAttributesKeepsUnrelatedOverlays()
  testAnalysisOverlayResetPatchClearsDerivedState()
  console.log('atom attributes tests passed')
}

run()
