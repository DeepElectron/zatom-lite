import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import {
  fingerprintChemicalStateEnsemble,
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  type ZatomChemicalStateRecord,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from '../chemical-state-ensemble'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  fitMicrostateEquilibriumPotentials,
  microstatePotentialEnsemblePopulationRows,
  microstatePopulationStandardDeviations,
  parseZatomMicrostateTransitionGraph,
  solveZatomMicrostatePopulations,
  type ZatomMicrostateTransitionGraph,
  ZatomMicrostateTransitionGraphInputError,
  ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA,
} from '../microstate-transition-graph'
import {
  scanZatomMicrostateTitration,
  ZATOM_MICROSTATE_TITRATION_SERIES_SCHEMA,
} from '../microstate-titration'
import {
  fingerprintMicrostateStateCoverage,
  parseZatomMicrostateStateCoverage,
  type ZatomMicrostateStateCoverage,
  ZatomMicrostateStateCoverageInputError,
  ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA,
} from '../microstate-state-coverage'
import {
  composeZatomMicrostatePotentialMixture,
  fingerprintMicrostateEquilibriumPotentialEnsemble,
  parseZatomMicrostateEquilibriumPotentialEnsemble,
  type ZatomMicrostateEquilibriumPotentialEnsemble,
  ZatomMicrostateEquilibriumPotentialEnsembleInputError,
  ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
} from '../microstate-equilibrium-potential-ensemble'
import {
  createZatomMicrostatePotentialSampleDiagnostics,
  fingerprintMicrostatePotentialSampleDiagnostics,
  parseZatomMicrostatePotentialSampleDiagnostics,
  type ZatomMicrostatePotentialSampleDiagnosticsDraft,
  ZatomMicrostatePotentialSampleDiagnosticsInputError,
  ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA,
} from '../microstate-potential-sample-diagnostics'
import { ZATOM_PROVIDER_SCHEMA, ZatomProviderError, type ZatomModelingProvider } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintStructure } from '../structure-math'

const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083
const TEMPERATURE_K = 298.15
const ONE_LOG10_KCAL_PER_MOL = GAS_CONSTANT_KCAL_PER_MOL_K * TEMPERATURE_K * Math.log(10)

function state(
  id: string,
  canonicalIsomericSmiles: string,
  formula: string,
  formalCharge: number,
  explicitHydrogenCount: number,
): ZatomChemicalStateRecord {
  return {
    id,
    canonicalIsomericSmiles,
    formula,
    formalCharge,
    atomCount: 4 + explicitHydrogenCount,
    bondCount: 3 + explicitHydrogenCount,
    heavyAtomCount: 4,
    explicitHydrogenCount,
    assignedStereocenterCount: 0,
    unassignedStereocenterCount: 0,
  }
}

function fixture(): {
  structure: ZatomStructure
  ensemble: ZatomChemicalStateEnsemble
  graph: ZatomMicrostateTransitionGraph
} {
  const selectedStateId = 'a-h'
  const selectedSmiles = 'CC(=O)O'
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'explicit acetic-acid four-microstate graph fixture',
    atoms: [
      { id: 'c-methyl', element: 'C', position: [-1.25, 0, 0], properties: { formalCharge: 0 } },
      { id: 'c-carbonyl', element: 'C', position: [0.05, 0, 0], properties: { formalCharge: 0 } },
      { id: 'o-carbonyl', element: 'O', position: [0.75, 1.0, 0], properties: { formalCharge: 0 } },
      { id: 'o-hydroxyl', element: 'O', position: [0.75, -1.0, 0], properties: { formalCharge: 0 } },
      { id: 'h-methyl-1', element: 'H', position: [-1.7, 0.9, 0], properties: { formalCharge: 0 } },
      { id: 'h-methyl-2', element: 'H', position: [-1.7, -0.45, 0.78], properties: { formalCharge: 0 } },
      { id: 'h-methyl-3', element: 'H', position: [-1.7, -0.45, -0.78], properties: { formalCharge: 0 } },
      { id: 'h-acidic', element: 'H', position: [1.7, -0.9, 0], properties: { formalCharge: 0 } },
    ],
    bonds: [
      { id: 'b-cc', atomIds: ['c-methyl', 'c-carbonyl'], order: 1 },
      { id: 'b-co-double', atomIds: ['c-carbonyl', 'o-carbonyl'], order: 2 },
      { id: 'b-co-single', atomIds: ['c-carbonyl', 'o-hydroxyl'], order: 1 },
      { id: 'b-ch-1', atomIds: ['c-methyl', 'h-methyl-1'], order: 1 },
      { id: 'b-ch-2', atomIds: ['c-methyl', 'h-methyl-2'], order: 1 },
      { id: 'b-ch-3', atomIds: ['c-methyl', 'h-methyl-3'], order: 1 },
      { id: 'b-oh', atomIds: ['o-hydroxyl', 'h-acidic'], order: 1 },
    ],
    metadata: {
      'zatom.chemical.stateId': selectedStateId,
      'zatom.chemical.canonicalIsomericSmiles': selectedSmiles,
      'zatom.chemical.formula': 'C2H4O2',
      'zatom.chemical.formalCharge': 0,
      'zatom.chemical.enumerationKind': 'tautomer-protonation',
    },
  }
  const states = [
    state('a-h', selectedSmiles, 'C2H4O2', 0, 4),
    state('a-d', 'CC(=O)[O-]', 'C2H3O2-', -1, 3),
    state('b-h', 'C=C(O)O', 'C2H4O2', 0, 4),
    state('b-d', 'C=C(O)[O-]', 'C2H3O2-', -1, 3),
  ].sort((left, right) => (
    left.canonicalIsomericSmiles < right.canonicalIsomericSmiles ? -1
      : left.canonicalIsomericSmiles > right.canonicalIsomericSmiles ? 1
        : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))
  const ensembleDraft: ZatomChemicalStateEnsemble = {
    schemaVersion: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
    selectedStructureFingerprint: fingerprintStructure(structure),
    enumeration: {
      kind: 'tautomer-protonation',
      complete: true,
      status: 'Fixture enumerated two protonation levels and two tautomers at each level',
    },
    source: {
      canonicalIsomericSmiles: selectedSmiles,
      formula: 'C2H4O2',
      formalCharge: 0,
    },
    normalized: {
      canonicalIsomericSmiles: selectedSmiles,
      formula: 'C2H4O2',
      formalCharge: 0,
      method: 'Fixture preserves source graph',
    },
    states,
    selection: {
      selectedStateId,
      selectedStateIndex: states.findIndex((item) => item.id === selectedStateId),
      method: 'explicit',
      rationale: 'Bind the neutral keto reference for visual validation; population ranking is not yet known.',
    },
    provenance: {
      engine: 'fixture-joint-microstate-enumerator',
      engineVersion: '1.0.0',
      method: 'Fixture complete joint tautomer/protonation enumeration',
      parameters: {},
      citations: ['urn:zatom:test:microstate-enumeration'],
      scopeWarning: 'Fixture state identities are test data.',
    },
  }
  const ensemble = parseZatomChemicalStateEnsemble(ensembleDraft, { structure }).ensemble
  const graph: ZatomMicrostateTransitionGraph = {
    schemaVersion: ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA,
    chemicalStateEnsembleFingerprint: fingerprintChemicalStateEnsemble(ensemble),
    conditions: {
      temperatureK: TEMPERATURE_K,
      medium: 'aqueous fixture',
      ionicStrengthMolar: 0.1,
      standardState: '1 mol/L solute and unit proton activity fixture',
    },
    completeness: {
      transitionsComplete: true,
      status: 'Fixture supplies the complete square graph',
    },
    states: [
      { stateId: 'b-d', relativeProtonCount: 0 },
      { stateId: 'a-h', relativeProtonCount: 1 },
      { stateId: 'a-d', relativeProtonCount: 0 },
      { stateId: 'b-h', relativeProtonCount: 1 },
    ],
    edges: [
      {
        id: 'edge-b-deprotonation',
        kind: 'proton-transfer',
        fromStateId: 'b-h',
        toStateId: 'b-d',
        pKa: 3,
        uncertainty: { standardDeviation: 0.2, unit: 'pKa', method: 'Fixture Gaussian pKa SD' },
        evidenceSourceIds: ['source-pka'],
      },
      {
        id: 'edge-a-protonated-to-b-protonated',
        kind: 'isomerization',
        fromStateId: 'a-h',
        toStateId: 'b-h',
        deltaGToMinusFromKcalMol: ONE_LOG10_KCAL_PER_MOL,
        uncertainty: { standardDeviation: 0.1, unit: 'kcal/mol', method: 'Fixture Gaussian free-energy SD' },
        evidenceSourceIds: ['source-free-energy'],
        selectedStructureAtomIds: ['o-carbonyl', 'o-hydroxyl'],
      },
      {
        id: 'edge-a-deprotonation',
        kind: 'proton-transfer',
        fromStateId: 'a-h',
        toStateId: 'a-d',
        pKa: 4,
        uncertainty: { standardDeviation: 0.2, unit: 'pKa', method: 'Fixture Gaussian pKa SD' },
        evidenceSourceIds: ['source-pka'],
        selectedStructureAtomIds: ['o-hydroxyl'],
      },
      {
        id: 'edge-a-deprotonated-to-b-deprotonated',
        kind: 'isomerization',
        fromStateId: 'a-d',
        toStateId: 'b-d',
        deltaGToMinusFromKcalMol: 0,
        uncertainty: { standardDeviation: 0.1, unit: 'kcal/mol', method: 'Fixture Gaussian free-energy SD' },
        evidenceSourceIds: ['source-free-energy'],
      },
    ],
    evidenceSources: [
      {
        id: 'source-pka',
        kind: 'microscopic-pka',
        engine: 'fixture-pka',
        engineVersion: '1.0.0',
        method: 'Fixture microscopic pKa edges',
        artifacts: [{ id: 'pka-fixture', role: 'microscopic pKa evidence', fingerprint: 'fnv1a64:1111111111111111' }],
        citations: ['urn:zatom:test:microstate-pka'],
        evidenceStatement: 'Fixture pKa values and standard deviations.',
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact fixture only.',
          reasons: ['Constructed analytic regression case.'],
        },
        scopeWarning: 'Fixture pKa values are not scientific predictions.',
      },
      {
        id: 'source-free-energy',
        kind: 'relative-free-energy',
        engine: 'fixture-free-energy',
        engineVersion: '1.0.0',
        method: 'Fixture relative tautomer free energies',
        artifacts: [{ id: 'free-energy-fixture', role: 'relative free-energy evidence', fingerprint: 'sha256:fixture' }],
        citations: ['urn:zatom:test:microstate-free-energy'],
        evidenceStatement: 'Fixture free energies close the thermodynamic square exactly.',
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact fixture only.',
          reasons: ['Constructed analytic regression case.'],
        },
        scopeWarning: 'Fixture free energies are not scientific predictions.',
      },
    ],
    acceptance: { maximumCycleClosureResidualLog10: 1e-8 },
    provenance: {
      engine: 'fixture-graph-assembler',
      engineVersion: '1.0.0',
      method: 'Assemble one exact thermodynamic square',
      parameters: { topology: 'square' },
      citations: ['urn:zatom:test:microstate-graph'],
      scopeWarning: 'Fixture graph proves contract mechanics only.',
    },
  }
  return { structure, ensemble, graph }
}

function withCorrelatedEdgeErrors(
  graph: ZatomMicrostateTransitionGraph,
  edgeIds: string[] = graph.edges.map((edge) => edge.id),
): ZatomMicrostateTransitionGraph {
  const canonicalIds = graph.edges.map((edge) => edge.id).sort()
  const loadings = new Map(canonicalIds.map((edgeId, index) => (
    [edgeId, [0.1, -0.2, 0.3, -0.4][index] ?? 0.05] as const
  )))
  return {
    ...graph,
    edgeCorrelation: {
      kind: 'full-correlation-matrix',
      edgeIds,
      correlationMatrix: edgeIds.map((rowId, rowIndex) => edgeIds.map((columnId, columnIndex) => (
        rowIndex === columnIndex ? 1 : loadings.get(rowId)! * loadings.get(columnId)!
      ))),
      method: 'Fixture one-factor full edge-error correlation model',
      assumptions: ['Fixture loadings are treated as exact.', 'Residual edge errors are independent.'],
      scopeWarning: 'Fixture correlations exist only to exercise generalized least squares.',
    },
  }
}

function expectInputError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomMicrostateTransitionGraphInputError)
  assertEqual((observed as ZatomMicrostateTransitionGraphInputError).code, code)
}

function expectCoverageError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomMicrostateStateCoverageInputError)
  assertEqual((observed as ZatomMicrostateStateCoverageInputError).code, code)
}

function expectPotentialEnsembleError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError)
  assertEqual((observed as ZatomMicrostateEquilibriumPotentialEnsembleInputError).code, code)
}

function expectPotentialSampleDiagnosticsError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomMicrostatePotentialSampleDiagnosticsInputError)
  assertEqual((observed as ZatomMicrostatePotentialSampleDiagnosticsInputError).code, code)
}

function potentialEnsembleFixture(
  graphValidation: ReturnType<typeof parseZatomMicrostateTransitionGraph>,
  pHDomain: { minimum: number; maximum: number } = { minimum: 0, maximum: 14 },
): ZatomMicrostateEquilibriumPotentialEnsemble {
  const stateIds = graphValidation.graph.states.map((state) => state.stateId).reverse()
  const referenceStateId = graphValidation.graph.states[0].stateId
  const rawSamples: Array<{
    id: string
    weight: number
    potentials: Record<string, number>
  }> = [
    {
      id: 'sample-z',
      weight: 0.2,
      potentials: { 'a-d': 0, 'a-h': 3, 'b-d': -2, 'b-h': 5 },
    },
    {
      id: 'sample-a',
      weight: 0.3,
      potentials: { 'a-d': 0, 'a-h': 5, 'b-d': 1, 'b-h': 2 },
    },
    {
      id: 'sample-m',
      weight: 0.5,
      potentials: { 'a-d': 0, 'a-h': 2, 'b-d': 4, 'b-h': 1 },
    },
  ]
  return {
    schemaVersion: ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    referenceStateId,
    stateIds,
    pHDomain,
    samples: rawSamples.map((sample) => {
      const referencePotential = sample.potentials[referenceStateId]
      return {
        id: sample.id,
        weight: sample.weight,
        log10WeightsRelativeToReference: stateIds.map((stateId) => (
          sample.potentials[stateId] - referencePotential
        )),
      }
    }),
    acceptance: { minimumWeightEffectiveSampleSize: 2 },
    uncertaintyModel: {
      kind: 'posterior-samples',
      method: 'Fixture weighted, correlated, deliberately non-Gaussian joint posterior draws',
      assumptions: [
        'Each fixture row is one complete joint draw.',
        'Fixture weights define the discrete posterior exactly.',
      ],
      applicability: {
        assessment: 'in-domain',
        domain: 'This exact four-state regression fixture from pH 0 through 14.',
        reasons: ['Constructed to exercise direct nonlinear propagation.'],
      },
      scopeWarning: 'Fixture samples are regression data, not scientific predictions.',
    },
    provenance: {
      engine: 'fixture-joint-potential-sampler',
      engineVersion: '1.0.0',
      method: 'Construct three weighted multimodal joint intrinsic-potential samples',
      artifacts: [{
        id: 'fixture-potential-samples',
        role: 'Exact regression evidence',
        fingerprint: 'sha256:fixture-joint-potential-samples',
      }],
      parameters: { sampleConstruction: 'weighted-discrete' },
      citations: ['urn:zatom:test:joint-potential-samples'],
      scopeWarning: 'Fixture-only evidence.',
    },
  }
}

function reorderPotentialEnsemble(
  artifact: ZatomMicrostateEquilibriumPotentialEnsemble,
  stateIds: string[],
): ZatomMicrostateEquilibriumPotentialEnsemble {
  const oldIndex = new Map(artifact.stateIds.map((stateId, index) => [stateId, index]))
  return {
    ...artifact,
    stateIds,
    samples: [...artifact.samples].reverse().map((sample) => ({
      ...sample,
      log10WeightsRelativeToReference: stateIds.map((stateId) => (
        sample.log10WeightsRelativeToReference[oldIndex.get(stateId)!]
      )),
    })),
  }
}

function mcmcPotentialEnsembleFixture(
  graphValidation: ReturnType<typeof parseZatomMicrostateTransitionGraph>,
  separatedChains = false,
): {
  artifact: ZatomMicrostateEquilibriumPotentialEnsemble
  chains: Array<{ id: string; sampleIds: string[] }>
} {
  const canonicalStateIds = graphValidation.graph.states.map((state) => state.stateId)
  const stateIds = [...canonicalStateIds].reverse()
  const referenceStateId = canonicalStateIds[0]
  const pattern = [-0.7, 0.4, -0.5, 0.6, -0.3, 0.8, -0.1, 1]
  const chainIds = ['chain-a', 'chain-b']
  const chains = chainIds.map((chainId) => ({
    id: chainId,
    sampleIds: Array.from({ length: 16 }, (_, drawIndex) => (
      `${chainId}-${drawIndex.toString().padStart(2, '0')}`
    )),
  }))
  const samples = chains.flatMap((chain, chainIndex) => chain.sampleIds.map((id, drawIndex) => ({
    id,
    weight: 1 / 32,
    log10WeightsRelativeToReference: stateIds.map((stateId) => {
      if (stateId === referenceStateId) return 0
      const stateIndex = canonicalStateIds.indexOf(stateId)
      const phase = chainIndex === 0 ? drawIndex : (drawIndex + 3) % pattern.length
      const chainOffset = separatedChains && chainIndex === 1 ? 4 * stateIndex : 0
      return stateIndex * 0.75 + pattern[phase % pattern.length] * (0.08 + stateIndex * 0.01)
        + chainOffset
    }),
  })))
  return {
    artifact: {
      schemaVersion: ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
      chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: graphValidation.fingerprint,
      referenceStateId,
      stateIds,
      pHDomain: { minimum: 0, maximum: 14 },
      samples: [...samples].reverse(),
      acceptance: { minimumWeightEffectiveSampleSize: 30 },
      uncertaintyModel: {
        kind: 'posterior-samples',
        method: 'Fixture retained equal-weight draws from two ordered MCMC chains',
        assumptions: [
          'Warmup was removed before these retained fixture draws.',
          'Each retained row is one complete joint state-potential draw.',
        ],
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact four-state regression fixture from pH 0 through 14.',
          reasons: ['Constructed to exercise ordered-chain diagnostics and propagation.'],
        },
        scopeWarning: 'Fixture chains are contract test data, not scientific convergence evidence.',
      },
      provenance: {
        engine: 'fixture-mcmc-potential-sampler',
        engineVersion: '1.0.0',
        method: separatedChains
          ? 'Construct two deliberately separated retained chains'
          : 'Construct two phase-shifted retained chains with the same empirical distribution',
        artifacts: [{
          id: 'fixture-mcmc-draws',
          role: 'Ordered retained-chain regression evidence',
          fingerprint: separatedChains ? 'sha256:fixture-separated-mcmc' : 'sha256:fixture-mixed-mcmc',
        }],
        parameters: { chainCount: 2, retainedDrawsPerChain: 16, separatedChains },
        citations: ['urn:zatom:test:mcmc-potential-samples'],
        scopeWarning: 'Fixture-only evidence.',
      },
    },
    chains,
  }
}

function potentialSampleDiagnosticsDraft(
  potentialValidation: ReturnType<typeof parseZatomMicrostateEquilibriumPotentialEnsemble>,
  chains: Array<{ id: string; sampleIds: string[] }>,
): ZatomMicrostatePotentialSampleDiagnosticsDraft {
  return {
    schemaVersion: ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA,
    equilibriumPotentialEnsembleFingerprint: potentialValidation.fingerprint,
    sampleIds: potentialValidation.ensemble.samples.map((sample) => sample.id).reverse(),
    design: {
      kind: 'mcmc-chains',
      chains: [...chains].reverse(),
      method: 'Rank-normalized and folded split-R-hat plus per-chain initial-positive-sequence ESS',
      assumptions: [
        'The two chains are independently initialized.',
        'The ordered IDs are post-warmup retained draws without thinning metadata loss.',
      ],
      scopeWarning: 'These finite-chain screens do not prove stationarity or tail exploration.',
    },
    acceptance: {
      maximumSplitRhat: 1.2,
      minimumCombinedEffectiveSamples: 20,
      maximumAutocorrelationLag: 7,
    },
    provenance: {
      engine: 'zatom-fixture-chain-diagnostics',
      engineVersion: '1.0.0',
      method: 'Independently recompute every reported diagnostic from ordered retained draws',
      artifacts: [{
        id: 'fixture-chain-manifest',
        role: 'Exact chain membership and order',
        fingerprint: 'sha256:fixture-chain-manifest',
      }],
      parameters: { rankNormalization: 'blom-3/8', folded: true, split: true },
      citations: ['urn:zatom:test:mcmc-diagnostics'],
      scopeWarning: 'No warmup, divergence, tail-ESS, or sampler-energy audit is represented here.',
    },
  }
}

function populationById(
  result: ReturnType<typeof solveZatomMicrostatePopulations>,
  stateId: string,
): ReturnType<typeof solveZatomMicrostatePopulations>['solution']['populations'][number] {
  return result.solution.populations.find((entry) => entry.stateId === stateId)!
}

function assertApprox(actual: number, expected: number, tolerance = 1e-10): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `Expected ${expected} ± ${tolerance}, received ${actual}`)
}

function standardDeviationFromGradient(gradient: readonly number[], covariance: readonly number[][]): number {
  let variance = 0
  for (let row = 0; row < gradient.length; row++) {
    for (let column = 0; column < gradient.length; column++) {
      variance += gradient[row] * covariance[row][column] * gradient[column]
    }
  }
  return Math.sqrt(Math.max(0, variance))
}

function invertDenseForTest(matrix: readonly number[][]): number[][] {
  const size = matrix.length
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => rowIndex === columnIndex ? 1 : 0),
  ])
  for (let column = 0; column < size; column++) {
    let pivotRow = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row
    }
    ;[augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]]
    const pivot = augmented[column][column]
    for (let index = 0; index < size * 2; index++) augmented[column][index] /= pivot
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let index = 0; index < size * 2; index++) {
        augmented[row][index] -= factor * augmented[column][index]
      }
    }
  }
  return augmented.map((row) => row.slice(size))
}

function matrixVector(matrix: readonly number[][], vector: readonly number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0))
}

async function testCanonicalValidationAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const parsed = parseZatomMicrostateTransitionGraph(graph, { structure, chemicalStateEnsemble: ensemble })
  assertEqual(parsed.graph.states.length, 4)
  assertEqual(parsed.graph.edges.length, 4)
  assertEqual(parsed.thermodynamicAudit.componentCount, 1)
  assertEqual(parsed.thermodynamicAudit.cycleRank, 1)
  assertTrue(parsed.thermodynamicAudit.maximumCycleClosureResidualLog10 < 1e-12)
  assertTrue(parsed.checks.some((check) => check.id === 'microstate_graph.cycle_closure' && check.status === 'pass'))
  assertTrue(parsed.inspectionTargets.some((target) => target.id === 'microstate-graph-selected-state-transitions'))
  assertTrue(parsed.inspectionTargets.every((target) => (
    target.atomIds.every((atomId) => structure.atoms.some((atom) => atom.id === atomId))
  )))

  const reversed = {
    ...graph,
    states: [...graph.states].reverse(),
    edges: graph.edges.map((edge) => (
      edge.id === 'edge-a-protonated-to-b-protonated' && edge.kind === 'isomerization'
      ? {
          ...edge,
          fromStateId: edge.toStateId,
          toStateId: edge.fromStateId,
          deltaGToMinusFromKcalMol: -edge.deltaGToMinusFromKcalMol,
        }
      : edge)).reverse(),
    evidenceSources: [...graph.evidenceSources].reverse(),
  }
  assertEqual(
    parseZatomMicrostateTransitionGraph(reversed, { structure, chemicalStateEnsemble: ensemble }).fingerprint,
    parsed.fingerprint,
  )

  const tool = await callZatomMcpTool('microstate_validate_transition_graph', {
    graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const data = tool.structuredContent.data as ZatomMicrostateTransitionGraphValidationLike
  assertEqual(data.thermodynamicAudit.cycleRank, 1)
}

interface ZatomMicrostateTransitionGraphValidationLike {
  thermodynamicAudit: { cycleRank: number }
}

async function testPopulationEquationsUncertaintyAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const solved = solveZatomMicrostatePopulations(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
  })
  const aH = populationById(solved, 'a-h')
  const aD = populationById(solved, 'a-d')
  const bH = populationById(solved, 'b-h')
  const bD = populationById(solved, 'b-d')
  assertApprox(aD.fraction / aH.fraction, 10)
  assertApprox(bH.fraction / aH.fraction, 0.1)
  assertApprox(bD.fraction / aD.fraction, 1)
  assertApprox(solved.solution.populations.reduce((sum, entry) => sum + entry.fraction, 0), 1, 1e-14)
  assertTrue(solved.solution.maximumPopulationStateIds.includes('a-d'))
  assertTrue(solved.solution.maximumPopulationStateIds.includes('b-d'))
  assertTrue(solved.solution.populations.every((entry) => entry.standardDeviation === undefined))
  assertTrue(solved.checks.some((check) => (
    check.id === 'microstate_population.selected_structure_scope' && check.status === 'warn'
  )))
  assertEqual(solved.ensembleWithPopulationModel.populationModel?.populations.length, 4)
  assertTrue(solved.solutionFingerprint.startsWith('fnv1a64:'))
  assertTrue(solved.ensembleWithPopulationModelFingerprint.startsWith('fnv1a64:'))

  const propagated = solveZatomMicrostatePopulations(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'independent-gaussian-delta-method',
  })
  assertTrue(propagated.solution.populations.every((entry) => (
    entry.standardDeviation !== undefined && entry.standardDeviation > 0
  )))
  assertEqual(
    propagated.solution.uncertainty?.method,
    'weighted-least-squares-independent-gaussian-edge-errors-delta-method',
  )
  assertTrue(propagated.checks.some((check) => (
    check.id === 'microstate_population.uncertainty' && check.status === 'pass'
  )))

  const tool = await callZatomMcpTool('microstate_solve_populations', {
    graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'independent-gaussian-delta-method',
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { solutionFingerprint: string }
  assertEqual(toolData.solutionFingerprint, propagated.solutionFingerprint)
}

async function testTitrationSeriesMacroscopicPkaAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const expectedMacroscopicPka = Math.log10(5_500)
  const scanned = scanZatomMicrostateTitration(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 15,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
  })
  assertEqual(scanned.series.schemaVersion, ZATOM_MICROSTATE_TITRATION_SERIES_SCHEMA)
  assertEqual(scanned.series.points.length, 15)
  assertEqual(scanned.series.protonationLevels.length, 2)
  assertEqual(scanned.series.macroscopicSteps.length, 1)
  assertApprox(scanned.series.macroscopicSteps[0].pKa, expectedMacroscopicPka)
  assertEqual(scanned.series.macroscopicSteps[0].fromRelativeProtonCount, 1)
  assertEqual(scanned.series.macroscopicSteps[0].toRelativeProtonCount, 0)
  assertTrue(scanned.series.macroscopicSteps[0].standardDeviation === undefined)
  const atPh5 = scanned.series.points.find((point) => point.pH === 5)!
  const leastProtonated = atPh5.protonationLevelFractions.find((level) => level.relativeProtonCount === 0)!
  const mostProtonated = atPh5.protonationLevelFractions.find((level) => level.relativeProtonCount === 1)!
  assertApprox(leastProtonated.fraction / mostProtonated.fraction, 10 ** (5 - expectedMacroscopicPka))
  assertApprox(atPh5.populations.reduce((sum, entry) => sum + entry.fraction, 0), 1, 1e-14)
  assertApprox(atPh5.protonationLevelFractions.reduce((sum, entry) => sum + entry.fraction, 0), 1, 1e-14)
  assertTrue(scanned.series.points.every((point) => point.protonationSusceptibilityPerPH >= 0))
  assertTrue(scanned.series.points.every((point, index, points) => (
    index === 0 || point.meanRelativeProtonCount <= points[index - 1].meanRelativeProtonCount + 1e-14
  )))
  assertTrue(scanned.seriesFingerprint.startsWith('fnv1a64:'))
  assertTrue(scanned.checks.some((check) => (
    check.id === 'microstate_titration.macroscopic_pka' && check.status === 'pass'
  )))

  const propagated = scanZatomMicrostateTitration(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pHMinimum: expectedMacroscopicPka - 1,
    pHMaximum: expectedMacroscopicPka + 1,
    pointCount: 3,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'independent-gaussian-delta-method',
  })
  assertTrue((propagated.series.macroscopicSteps[0].standardDeviation ?? 0) > 0)
  assertTrue(propagated.series.points.every((point) => (
    point.populations.every((entry) => (entry.standardDeviation ?? 0) > 0)
    && point.protonationLevelFractions.every((entry) => (entry.standardDeviation ?? 0) > 0)
  )))
  const midpoint = propagated.series.points[1]
  const midpointLeast = midpoint.protonationLevelFractions.find((level) => level.relativeProtonCount === 0)!
  const midpointMost = midpoint.protonationLevelFractions.find((level) => level.relativeProtonCount === 1)!
  assertApprox(midpointLeast.fraction, 0.5)
  assertApprox(midpointMost.fraction, 0.5)
  assertTrue(propagated.checks.some((check) => (
    check.id === 'microstate_titration.uncertainty' && check.status === 'pass'
  )))

  const canonicalGraph = propagated.graphValidation.graph
  const baseFit = fitMicrostateEquilibriumPotentials(
    canonicalGraph,
    0,
    'independent-gaussian-delta-method',
  )
  const midpointFractions = midpoint.populations.map((entry) => entry.fraction)
  const directPopulationSds = microstatePopulationStandardDeviations(midpointFractions, baseFit.covariance!)
  midpoint.populations.forEach((entry, stateIndex) => {
    const gradient = Array.from({ length: midpointFractions.length - 1 }, (_, variable) => {
      const variableState = variable + 1
      return Math.LN10 * midpointFractions[stateIndex]
        * ((stateIndex === variableState ? 1 : 0) - midpointFractions[variableState])
    })
    assertApprox(directPopulationSds[stateIndex], standardDeviationFromGradient(gradient, baseFit.covariance!), 1e-12)
    assertApprox(entry.standardDeviation!, directPopulationSds[stateIndex], 1e-12)
  })
  midpoint.protonationLevelFractions.forEach((entry) => {
    const memberIndices = new Set(canonicalGraph.states
      .map((state, index) => state.relativeProtonCount === entry.relativeProtonCount ? index : -1)
      .filter((index) => index >= 0))
    const gradient = Array.from({ length: midpointFractions.length - 1 }, (_, variable) => {
      const stateIndex = variable + 1
      return Math.LN10 * midpointFractions[stateIndex]
        * ((memberIndices.has(stateIndex) ? 1 : 0) - entry.fraction)
    })
    assertApprox(entry.standardDeviation!, standardDeviationFromGradient(gradient, baseFit.covariance!), 1e-12)
  })

  const conditionalByLevel = new Map<number, Map<number, number>>()
  for (const level of propagated.series.protonationLevels) {
    const indices = canonicalGraph.states
      .map((state, index) => state.relativeProtonCount === level.relativeProtonCount ? index : -1)
      .filter((index) => index >= 0)
    const maximum = Math.max(...indices.map((index) => baseFit.log10Weights[index]))
    const weights = indices.map((index) => 10 ** (baseFit.log10Weights[index] - maximum))
    const sum = weights.reduce((total, value) => total + value, 0)
    conditionalByLevel.set(level.relativeProtonCount, new Map(
      indices.map((stateIndex, offset) => [stateIndex, weights[offset] / sum]),
    ))
  }
  const macro = propagated.series.macroscopicSteps[0]
  const macroGradient = Array.from({ length: canonicalGraph.states.length - 1 }, (_, variable) => {
    const stateIndex = variable + 1
    return (conditionalByLevel.get(macro.fromRelativeProtonCount)?.get(stateIndex) ?? 0)
      - (conditionalByLevel.get(macro.toRelativeProtonCount)?.get(stateIndex) ?? 0)
  })
  assertApprox(
    macro.standardDeviation!,
    standardDeviationFromGradient(macroGradient, baseFit.covariance!),
    1e-12,
  )

  const tool = await callZatomMcpTool('microstate_scan_titration', {
    graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 15,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { seriesFingerprint: string }
  assertEqual(toolData.seriesFingerprint, scanned.seriesFingerprint)
}

async function testStateCoverageCensoringBoundsAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const censoredEnsemble = parseZatomChemicalStateEnsemble({
    ...ensemble,
    enumeration: {
      ...ensemble.enumeration,
      complete: false,
      status: 'Fixture intentionally censors additional states',
    },
  }, { structure }).ensemble
  const graphValidation = parseZatomMicrostateTransitionGraph({
    ...graph,
    chemicalStateEnsembleFingerprint: fingerprintChemicalStateEnsemble(censoredEnsemble),
  }, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
  })
  const coverageDraft: ZatomMicrostateStateCoverage = {
    schemaVersion: ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA,
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    returnedStateCount: graphValidation.graph.states.length,
    pHDomain: { minimum: 0, maximum: 14 },
    assessment: {
      kind: 'bounded-total-omitted-fraction',
      totalOmittedFractionUpperBound: 0.05,
      method: 'Fixture direct pointwise bound on total omitted population',
      assumptions: ['The fixture total bound is exact at every pH in the declared domain.'],
      applicability: {
        assessment: 'in-domain',
        domain: 'This exact regression fixture.',
        reasons: ['Constructed bounded-censoring regression case.'],
      },
      scopeWarning: 'Fixture coverage is not scientific evidence.',
    },
    provenance: {
      engine: 'fixture-state-coverage',
      engineVersion: '1.0.0',
      method: 'Constructed direct total omitted-population bound',
      artifacts: [{
        id: 'fixture-coverage-source',
        role: 'Exact regression evidence',
        fingerprint: 'sha256:fixture-state-coverage',
      }],
      parameters: { totalOmittedFractionUpperBound: 0.05 },
      citations: ['urn:zatom:test:state-coverage'],
      scopeWarning: 'Fixture-only evidence.',
    },
  }
  const coverageValidation = parseZatomMicrostateStateCoverage(coverageDraft, {
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    stateEnumerationComplete: false,
    returnedStateCount: graphValidation.graph.states.length,
  })
  assertEqual(coverageValidation.coverage.assessment.kind, 'bounded-total-omitted-fraction')
  assertEqual(fingerprintMicrostateStateCoverage(coverageValidation.coverage), coverageValidation.fingerprint)
  assertTrue(coverageValidation.checks.some((check) => (
    check.id === 'microstate_state_coverage.assessment' && check.status === 'pass'
  )))
  expectCoverageError(
    () => parseZatomMicrostateStateCoverage({
      ...coverageDraft,
      microstateTransitionGraphFingerprint: 'fnv1a64:0000000000000000',
    }, {
      chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: graphValidation.fingerprint,
      stateEnumerationComplete: false,
      returnedStateCount: graphValidation.graph.states.length,
    }),
    'microstate_state_coverage_fingerprint_mismatch',
  )
  expectCoverageError(
    () => parseZatomMicrostateStateCoverage(coverageDraft, {
      chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: graphValidation.fingerprint,
      stateEnumerationComplete: true,
      returnedStateCount: graphValidation.graph.states.length,
    }),
    'microstate_state_coverage_completeness_mismatch',
  )

  const solved = solveZatomMicrostatePopulations(graphValidation.graph, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: false,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
    stateCoverage: coverageValidation.coverage,
  })
  assertEqual(solved.solution.populationScope.normalization, 'conditional-on-returned-states')
  assertEqual(solved.solution.populationScope.coverageAssessment, 'bounded')
  assertEqual(solved.solution.populationScope.totalOmittedFractionBounds?.maximum, 0.05)
  assertEqual(solved.solution.populationScope.retainedUniverseFractionBounds?.minimum, 0.95)
  assertEqual(solved.solution.populationScope.globalMaximumCertified, true)
  solved.solution.populations.forEach((entry) => {
    assertApprox(entry.censoringBounds!.minimum, entry.fraction * 0.95, 1e-14)
    assertApprox(entry.censoringBounds!.maximum, entry.fraction, 1e-14)
  })
  assertEqual(
    solved.ensembleWithPopulationModel.populationModel?.normalizationScope?.kind,
    'conditional-on-returned-states',
  )
  assertEqual(
    solved.ensembleWithPopulationModel.populationModel?.normalizationScope?.totalOmittedFractionUpperBound,
    0.05,
  )

  const titration = scanZatomMicrostateTitration(graphValidation.graph, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 3,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: false,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
    stateCoverage: coverageValidation.coverage,
  })
  assertEqual(titration.series.populationScope.coverageAssessment, 'bounded')
  assertEqual(titration.series.populationScope.macroscopicPkaScope, 'returned-states-only')
  const midpointLevel = titration.series.points[1].protonationLevelFractions[0]
  assertApprox(midpointLevel.censoringBounds!.minimum, midpointLevel.fraction * 0.95, 1e-14)
  assertApprox(
    midpointLevel.censoringBounds!.maximum,
    midpointLevel.fraction + 0.05 * (1 - midpointLevel.fraction),
    1e-14,
  )
  assertTrue(titration.checks.some((check) => (
    check.id === 'microstate_titration.macroscopic_pka' && check.status === 'warn'
  )))

  const unknownCoverage = parseZatomMicrostateStateCoverage({
    ...coverageDraft,
    assessment: {
      ...coverageDraft.assessment,
      kind: 'unknown-total-omitted-fraction',
      totalOmittedFractionUpperBound: undefined,
      method: 'Fixture exposes no total omitted-population bound',
    },
  }, {
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    stateEnumerationComplete: false,
    returnedStateCount: graphValidation.graph.states.length,
  }).coverage
  const unknownSolved = solveZatomMicrostatePopulations(graphValidation.graph, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: false,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
    stateCoverage: unknownCoverage,
  })
  assertEqual(unknownSolved.solution.populationScope.coverageAssessment, 'unknown')
  assertEqual(unknownSolved.solution.populations[0].censoringBounds, undefined)
  assertEqual(unknownSolved.solution.populationScope.globalMaximumCertified, false)

  const tool = await callZatomMcpTool('microstate_validate_state_coverage', {
    stateCoverage: coverageValidation.coverage,
    graph: graphValidation.graph,
    chemicalStateEnsemble: censoredEnsemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as {
    coverageValidation: { fingerprint: string }
  }
  assertEqual(toolData.coverageValidation.fingerprint, coverageValidation.fingerprint)
}

async function testJointPotentialSampleEnsemblePropagationAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const graphValidation = parseZatomMicrostateTransitionGraph(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  const parseOptions = {
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
    referenceStateId: graphValidation.graph.states[0].stateId,
  }
  const artifactDraft = potentialEnsembleFixture(graphValidation)
  const potentialValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(artifactDraft, parseOptions)
  assertEqual(potentialValidation.ensemble.samples.length, 3)
  assertTrue(potentialValidation.weightEffectiveSampleSize > 2.6)
  assertEqual(
    fingerprintMicrostateEquilibriumPotentialEnsemble(potentialValidation.ensemble),
    potentialValidation.fingerprint,
  )
  assertTrue(potentialValidation.ensemble.samples.every((sample) => (
    sample.log10WeightsRelativeToReference[0] === 0
  )))
  const reordered = reorderPotentialEnsemble(
    artifactDraft,
    [...graphValidation.graph.states.map((state) => state.stateId)],
  )
  assertEqual(
    parseZatomMicrostateEquilibriumPotentialEnsemble(reordered, parseOptions).fingerprint,
    potentialValidation.fingerprint,
  )

  const referenceInputIndex = artifactDraft.stateIds.indexOf(artifactDraft.referenceStateId)
  expectPotentialEnsembleError(
    () => parseZatomMicrostateEquilibriumPotentialEnsemble({
      ...artifactDraft,
      samples: artifactDraft.samples.map((sample, sampleIndex) => ({
        ...sample,
        log10WeightsRelativeToReference: sample.log10WeightsRelativeToReference.map((value, stateIndex) => (
          sampleIndex === 0 && stateIndex === referenceInputIndex ? 0.01 : value
        )),
      })),
    }, parseOptions),
    'microstate_potential_ensemble_gauge_mismatch',
  )
  expectPotentialEnsembleError(
    () => parseZatomMicrostateEquilibriumPotentialEnsemble({
      ...artifactDraft,
      samples: artifactDraft.samples.map((sample, index) => ({
        ...sample,
        weight: index === 0 ? sample.weight + 0.1 : sample.weight,
      })),
    }, parseOptions),
    'microstate_potential_ensemble_weight_mismatch',
  )
  expectPotentialEnsembleError(
    () => parseZatomMicrostateEquilibriumPotentialEnsemble({
      ...artifactDraft,
      acceptance: { minimumWeightEffectiveSampleSize: 3 },
    }, parseOptions),
    'microstate_potential_ensemble_weight_effective_size_failed',
  )
  expectPotentialEnsembleError(
    () => parseZatomMicrostateEquilibriumPotentialEnsemble({
      ...artifactDraft,
      provenance: { ...artifactDraft.provenance, artifacts: [] },
    }, parseOptions),
    'invalid_microstate_equilibrium_potential_ensemble',
  )

  const graphWithoutEdgeSds = {
    ...graph,
    edges: graph.edges.map(({ uncertainty: _uncertainty, ...edge }) => edge),
  }
  const graphWithoutEdgeSdsValidation = parseZatomMicrostateTransitionGraph(graphWithoutEdgeSds, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  const noSdPotentialValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    potentialEnsembleFixture(graphWithoutEdgeSdsValidation),
    {
      chemicalStateEnsembleFingerprint: graphWithoutEdgeSdsValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: graphWithoutEdgeSdsValidation.fingerprint,
      canonicalStateIds: graphWithoutEdgeSdsValidation.graph.states.map((state) => state.stateId),
      referenceStateId: graphWithoutEdgeSdsValidation.graph.states[0].stateId,
    },
  )
  const solved = solveZatomMicrostatePopulations(graphWithoutEdgeSdsValidation.graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    equilibriumPotentialEnsemble: noSdPotentialValidation.ensemble,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 2,
  })
  assertEqual(
    solved.solution.solver.equilibriumPotentialEnsembleFingerprint,
    noSdPotentialValidation.fingerprint,
  )
  assertEqual(solved.solution.uncertainty?.method, 'weighted-joint-equilibrium-potential-sample-ensemble')
  assertEqual(solved.solution.uncertainty?.sampleCount, 3)
  assertEqual(solved.solution.uncertainty?.sampleDiagnosticsAssessment, 'missing-explicitly-allowed')
  assertTrue(solved.checks.some((check) => (
    check.id === 'microstate_population.sample_diagnostics' && check.status === 'warn'
  )))
  assertTrue(solved.solution.provenance.citations.includes('urn:zatom:test:joint-potential-samples'))
  assertTrue(solved.populationModel.method.includes('joint sample uncertainty remains in solution'))
  assertApprox(
    solved.solution.uncertainty!.weightEffectiveSampleSize!,
    noSdPotentialValidation.weightEffectiveSampleSize,
  )
  const sampleRows = microstatePotentialEnsemblePopulationRows(
    graphWithoutEdgeSdsValidation.graph,
    noSdPotentialValidation.ensemble,
    5,
  )
  sampleRows.forEach((row) => assertApprox(row.reduce((sum, value) => sum + value, 0), 1, 1e-14))
  const bDIndex = graphWithoutEdgeSdsValidation.graph.states.findIndex((state) => state.stateId === 'b-d')
  const bD = populationById(solved, 'b-d')
  const weights = noSdPotentialValidation.ensemble.samples.map((sample) => sample.weight)
  const bDSampleValues = sampleRows.map((row) => row[bDIndex])
  const expectedMean = bDSampleValues.reduce((sum, value, index) => sum + weights[index] * value, 0)
  const expectedVariance = bDSampleValues.reduce((sum, value, index) => (
    sum + weights[index] * (value - expectedMean) ** 2
  ), 0)
  assertApprox(bD.sampleUncertainty!.mean, expectedMean, 1e-14)
  assertApprox(bD.sampleUncertainty!.standardDeviation, Math.sqrt(expectedVariance), 1e-14)
  assertApprox(bD.standardDeviation!, bD.sampleUncertainty!.standardDeviation, 1e-14)
  assertEqual(bD.sampleUncertainty!.intervalProbability, 0.8)
  assertTrue(bD.sampleUncertainty!.lowerQuantile < bD.sampleUncertainty!.median)
  assertTrue(bD.sampleUncertainty!.median < bD.sampleUncertainty!.upperQuantile)
  assertTrue(Math.abs(bD.sampleUncertainty!.mean - bD.fraction) > 0.1)
  assertTrue(solved.solution.populations.every((entry) => entry.censoringBounds !== undefined))

  const validationTool = await callZatomMcpTool('microstate_validate_potential_ensemble', {
    potentialEnsemble: noSdPotentialValidation.ensemble,
    graph: graphWithoutEdgeSdsValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(validationTool.structuredContent.ok, validationTool.structuredContent.summary)
  const validationToolData = validationTool.structuredContent.data as {
    potentialEnsembleValidation: { fingerprint: string }
  }
  assertEqual(validationToolData.potentialEnsembleValidation.fingerprint, noSdPotentialValidation.fingerprint)

  const solveTool = await callZatomMcpTool('microstate_solve_populations', {
    graph: graphWithoutEdgeSdsValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    equilibriumPotentialEnsemble: noSdPotentialValidation.ensemble,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 2,
  })
  assertTrue(solveTool.structuredContent.ok, solveTool.structuredContent.summary)
  const solveToolData = solveTool.structuredContent.data as { solutionFingerprint: string }
  assertEqual(solveToolData.solutionFingerprint, solved.solutionFingerprint)

  const titration = scanZatomMicrostateTitration(graphWithoutEdgeSdsValidation.graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    equilibriumPotentialEnsemble: noSdPotentialValidation.ensemble,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 2,
  })
  assertEqual(titration.series.uncertainty?.method, 'weighted-joint-equilibrium-potential-sample-ensemble')
  assertEqual(titration.series.uncertainty?.sampleDiagnosticsAssessment, 'missing-explicitly-allowed')
  assertTrue(titration.series.provenance.citations.includes('urn:zatom:test:joint-potential-samples'))
  assertEqual(
    titration.series.solver.equilibriumPotentialEnsembleFingerprint,
    noSdPotentialValidation.fingerprint,
  )
  assertTrue(titration.series.points.every((point) => point.populations.every((entry) => (
    entry.sampleUncertainty !== undefined && entry.standardDeviation !== undefined
  ))))
  assertTrue(titration.series.points.every((point) => point.protonationLevelFractions.every((entry) => (
    entry.sampleUncertainty !== undefined && entry.standardDeviation !== undefined
  ))))
  assertTrue(titration.series.points.every((point) => (
    point.sampleUncertainty?.meanRelativeProtonCount !== undefined
      && point.sampleUncertainty.meanFormalCharge !== undefined
      && point.sampleUncertainty.protonationSusceptibilityPerPH !== undefined
  )))
  assertTrue(titration.series.macroscopicSteps.every((step) => (
    step.sampleUncertainty !== undefined && step.standardDeviation !== undefined
  )))
  assertTrue(titration.checks.some((check) => (
    check.id === 'microstate_titration.uncertainty' && check.status === 'pass'
  )))

  const scanTool = await callZatomMcpTool('microstate_scan_titration', {
    graph: graphWithoutEdgeSdsValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    equilibriumPotentialEnsemble: noSdPotentialValidation.ensemble,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 2,
  })
  assertTrue(scanTool.structuredContent.ok, scanTool.structuredContent.summary)
  const scanToolData = scanTool.structuredContent.data as { seriesFingerprint: string }
  assertEqual(scanToolData.seriesFingerprint, titration.seriesFingerprint)

  expectInputError(
    () => solveZatomMicrostatePopulations(graphValidation.graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'equilibrium-potential-sample-ensemble',
      sampleDiagnosticsPolicy: 'allow-missing',
      equilibriumPotentialEnsemble: potentialEnsembleFixture(graphValidation, { minimum: 0, maximum: 4 }),
      sampleIntervalProbability: 0.8,
      minimumSampleWeightEffectiveSize: 2,
    }),
    'microstate_potential_ensemble_ph_outside_domain',
  )
  expectInputError(
    () => scanZatomMicrostateTitration(graphWithoutEdgeSdsValidation.graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pHMinimum: 0,
      pHMaximum: 14,
      pointCount: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'equilibrium-potential-sample-ensemble',
      sampleDiagnosticsPolicy: 'allow-missing',
      equilibriumPotentialEnsemble: noSdPotentialValidation.ensemble,
      sampleIntervalProbability: 0.8,
      minimumSampleWeightEffectiveSize: 2,
      maxPointPotentialStateSamples: 1,
    }),
    'microstate_titration_budget_exceeded',
  )

  const censoredEnsemble = parseZatomChemicalStateEnsemble({
    ...ensemble,
    enumeration: {
      ...ensemble.enumeration,
      complete: false,
      status: 'Fixture intentionally censors additional states for joint-sample propagation',
    },
  }, { structure }).ensemble
  const censoredGraphValidation = parseZatomMicrostateTransitionGraph({
    ...graphWithoutEdgeSdsValidation.graph,
    chemicalStateEnsembleFingerprint: fingerprintChemicalStateEnsemble(censoredEnsemble),
  }, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
  })
  const coverage = parseZatomMicrostateStateCoverage({
    schemaVersion: ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA,
    chemicalStateEnsembleFingerprint: censoredGraphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: censoredGraphValidation.fingerprint,
    returnedStateCount: censoredGraphValidation.graph.states.length,
    pHDomain: { minimum: 0, maximum: 14 },
    assessment: {
      kind: 'bounded-total-omitted-fraction',
      totalOmittedFractionUpperBound: 0.05,
      method: 'Fixture direct total omitted-population bound',
      assumptions: ['The pointwise fixture bound is exact.'],
      applicability: {
        assessment: 'in-domain',
        domain: 'This exact regression fixture.',
        reasons: ['Constructed censoring regression case.'],
      },
      scopeWarning: 'Fixture-only bound.',
    },
    provenance: {
      engine: 'fixture-state-coverage',
      engineVersion: '1.0.0',
      method: 'Construct a five-percent total omitted-population bound',
      artifacts: [{ id: 'coverage', role: 'Regression evidence', fingerprint: 'sha256:coverage' }],
      parameters: { totalOmittedFractionUpperBound: 0.05 },
      citations: ['urn:zatom:test:state-coverage'],
      scopeWarning: 'Fixture-only evidence.',
    },
  }, {
    chemicalStateEnsembleFingerprint: censoredGraphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: censoredGraphValidation.fingerprint,
    stateEnumerationComplete: false,
    returnedStateCount: censoredGraphValidation.graph.states.length,
  }).coverage
  const censoredPotential = parseZatomMicrostateEquilibriumPotentialEnsemble(
    potentialEnsembleFixture(censoredGraphValidation),
    {
      chemicalStateEnsembleFingerprint: censoredGraphValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: censoredGraphValidation.fingerprint,
      canonicalStateIds: censoredGraphValidation.graph.states.map((state) => state.stateId),
      referenceStateId: censoredGraphValidation.graph.states[0].stateId,
    },
  ).ensemble
  const censoredSolved = solveZatomMicrostatePopulations(censoredGraphValidation.graph, {
    structure,
    chemicalStateEnsemble: censoredEnsemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: false,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    stateCoverage: coverage,
    equilibriumPotentialEnsemble: censoredPotential,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 2,
  })
  censoredSolved.solution.populations.forEach((entry) => {
    assertTrue(entry.sampleUncertainty !== undefined)
    assertApprox(entry.censoringBounds!.minimum, 0.95 * entry.fraction, 1e-14)
    assertApprox(entry.censoringBounds!.maximum, entry.fraction, 1e-14)
  })
}

async function testPotentialModelMixtureCompositionAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const graphValidation = parseZatomMicrostateTransitionGraph(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  const parseOptions = {
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
    referenceStateId: graphValidation.graph.states[0].stateId,
  }
  const first = potentialEnsembleFixture(graphValidation)
  const referenceIndex = first.stateIds.indexOf(first.referenceStateId)
  const second: ZatomMicrostateEquilibriumPotentialEnsemble = {
    ...first,
    samples: first.samples.map((sample) => ({
      ...sample,
      log10WeightsRelativeToReference: sample.log10WeightsRelativeToReference.map((value, index) => (
        index === referenceIndex ? 0 : value + 0.5 * (index + 1)
      )),
    })),
    uncertaintyModel: {
      ...first.uncertaintyModel,
      kind: 'bootstrap-replicates',
      method: 'Second fixture correlation/model family with shifted joint potentials',
    },
    provenance: {
      ...first.provenance,
      engine: 'fixture-second-potential-family',
      artifacts: [{
        id: 'fixture-second-potential-samples',
        role: 'Exact second-family regression evidence',
        fingerprint: 'sha256:fixture-second-joint-potential-samples',
      }],
      citations: ['urn:zatom:test:second-joint-potential-family'],
    },
  }
  const composition = {
    components: [
      { id: 'family-b', weight: 0.4, potentialEnsemble: second },
      { id: 'family-a', weight: 0.6, potentialEnsemble: first },
    ],
    acceptance: {
      minimumComponentWeightEffectiveCount: 1.9,
      minimumWeightEffectiveSampleSize: 5,
    },
    uncertaintyModel: {
      method: 'Fixture calibrated mixture across two alternate correlation/model families',
      assumptions: [
        'The fixture family weights are treated as calibrated probabilities.',
        'Each component sample distribution remains conditional on its named family.',
      ],
      applicability: {
        assessment: 'in-domain' as const,
        domain: 'Exact four-state model-mixture regression fixture from pH 0 through 14.',
        reasons: ['Both constructed components cover the same exact fixture domain.'],
      },
      scopeWarning: 'Fixture mixture weights and families are not scientific predictions.',
    },
    provenance: {
      engine: 'fixture-potential-mixture-composer',
      engineVersion: '1.0.0',
      method: 'Multiply model-family weights by exact within-family sample weights',
      calibrationArtifacts: [{
        id: 'fixture-family-weight-calibration',
        role: 'Exact fixture family-weight calibration evidence',
        fingerprint: 'sha256:fixture-family-weight-calibration',
      }],
      parameters: { familyWeightMethod: 'fixture-discrete' },
      citations: ['urn:zatom:test:potential-model-mixture'],
      scopeWarning: 'Fixture model-family composition only.',
    },
  }
  const mixture = composeZatomMicrostatePotentialMixture(composition, parseOptions)
  assertEqual(mixture.components.map((component) => component.id).join(','), 'family-a,family-b')
  assertApprox(mixture.componentWeightEffectiveCount, 1 / (0.6 ** 2 + 0.4 ** 2), 1e-12)
  assertEqual(mixture.potentialEnsembleValidation.ensemble.samples.length, 6)
  assertEqual(mixture.potentialEnsembleValidation.ensemble.uncertaintyModel.kind, 'model-ensemble')
  assertTrue(mixture.potentialEnsembleValidation.weightEffectiveSampleSize > 5)
  assertEqual(
    fingerprintMicrostateEquilibriumPotentialEnsemble(
      mixture.potentialEnsembleValidation.ensemble,
    ),
    mixture.potentialEnsembleValidation.fingerprint,
  )
  assertTrue(mixture.stateVarianceDecomposition.some((diagnostic) => (
    diagnostic.stateId !== parseOptions.referenceStateId
    && diagnostic.betweenComponentVariance > 0
    && diagnostic.totalVariance > diagnostic.withinComponentVariance
  )))
  mixture.stateVarianceDecomposition.forEach((diagnostic) => assertApprox(
    diagnostic.totalVariance,
    diagnostic.withinComponentVariance + diagnostic.betweenComponentVariance,
    1e-12,
  ))
  assertTrue(mixture.checks.some((check) => (
    check.id === 'microstate_potential_mixture.variance_decomposition'
    && check.status === 'pass'
  )))
  const reordered = composeZatomMicrostatePotentialMixture({
    ...composition,
    components: [...composition.components].reverse().map((component) => ({
      ...component,
      potentialEnsemble: {
        ...component.potentialEnsemble,
        samples: [...component.potentialEnsemble.samples].reverse(),
      },
    })),
  }, parseOptions)
  assertEqual(
    reordered.potentialEnsembleValidation.fingerprint,
    mixture.potentialEnsembleValidation.fingerprint,
  )

  expectPotentialEnsembleError(
    () => composeZatomMicrostatePotentialMixture({
      ...composition,
      components: composition.components.map((component, index) => ({
        ...component,
        weight: index === 0 ? 0.99 : 0.01,
      })),
    }, parseOptions),
    'microstate_potential_mixture_component_effective_count_failed',
  )
  expectPotentialEnsembleError(
    () => composeZatomMicrostatePotentialMixture({
      ...composition,
      components: composition.components.map((component, index) => ({
        ...component,
        potentialEnsemble: index === 0 ? component.potentialEnsemble : {
          ...component.potentialEnsemble,
          pHDomain: { minimum: 1, maximum: 14 },
        },
      })),
    }, parseOptions),
    'microstate_potential_mixture_ph_domain_mismatch',
  )
  expectPotentialEnsembleError(
    () => composeZatomMicrostatePotentialMixture({
      ...composition,
      components: composition.components.map((component, index) => ({
        ...component,
        potentialEnsemble: index === 0 ? component.potentialEnsemble : {
          ...component.potentialEnsemble,
          uncertaintyModel: {
            ...component.potentialEnsemble.uncertaintyModel,
            applicability: {
              ...component.potentialEnsemble.uncertaintyModel.applicability,
              assessment: 'unknown' as const,
            },
          },
        },
      })),
    }, parseOptions),
    'microstate_potential_mixture_applicability_mismatch',
  )

  const solved = solveZatomMicrostatePopulations(graphValidation.graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble',
    sampleDiagnosticsPolicy: 'allow-missing',
    equilibriumPotentialEnsemble: mixture.potentialEnsembleValidation.ensemble,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 5,
  })
  assertEqual(
    solved.solution.solver.equilibriumPotentialEnsembleFingerprint,
    mixture.potentialEnsembleValidation.fingerprint,
  )

  const tool = await callZatomMcpTool('microstate_compose_potential_mixture', {
    ...composition,
    graph: graphValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as {
    mixtureValidation: {
      potentialEnsembleValidation: { fingerprint: string }
    }
  }
  assertEqual(
    toolData.mixtureValidation.potentialEnsembleValidation.fingerprint,
    mixture.potentialEnsembleValidation.fingerprint,
  )
}

async function testPotentialSampleDiagnosticsAndMcp(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const graphValidation = parseZatomMicrostateTransitionGraph(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  const parseOptions = {
    chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: graphValidation.fingerprint,
    canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
    referenceStateId: graphValidation.graph.states[0].stateId,
  }
  const passingFixture = mcmcPotentialEnsembleFixture(graphValidation)
  const potentialValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    passingFixture.artifact,
    parseOptions,
  )
  assertApprox(potentialValidation.weightEffectiveSampleSize, 32, 1e-12)
  const draft = potentialSampleDiagnosticsDraft(potentialValidation, passingFixture.chains)
  const created = createZatomMicrostatePotentialSampleDiagnostics(draft, {
    potentialEnsembleValidation: potentialValidation,
  })
  assertEqual(created.diagnostics.overallPassed, true)
  assertEqual(created.diagnostics.design.chains.map((chain) => chain.id).join(','), 'chain-a,chain-b')
  assertEqual(
    createZatomMicrostatePotentialSampleDiagnostics({
      ...draft,
      design: { ...draft.design, chains: passingFixture.chains },
    }, { potentialEnsembleValidation: potentialValidation }).fingerprint,
    created.fingerprint,
  )
  const changedDrawOrder = draft.design.chains.map((chain, index) => ({
    ...chain,
    sampleIds: index === 0 ? [...chain.sampleIds].reverse() : [...chain.sampleIds],
  }))
  assertTrue(createZatomMicrostatePotentialSampleDiagnostics({
    ...draft,
    design: { ...draft.design, chains: changedDrawOrder },
  }, { potentialEnsembleValidation: potentialValidation }).fingerprint !== created.fingerprint)
  assertEqual(
    fingerprintMicrostatePotentialSampleDiagnostics(created.diagnostics),
    created.fingerprint,
  )
  assertTrue(created.diagnostics.stateDiagnostics.every((diagnostic) => (
    diagnostic.gates.splitRhat && diagnostic.gates.effectiveSamples
  )))
  assertTrue(created.checks.some((check) => (
    check.id === 'microstate_potential_sample_diagnostics.scope' && check.status === 'warn'
  )))

  const parsed = parseZatomMicrostatePotentialSampleDiagnostics(created.diagnostics, {
    potentialEnsembleValidation: potentialValidation,
  })
  assertEqual(parsed.fingerprint, created.fingerprint)
  assertEqual(
    parseZatomMicrostatePotentialSampleDiagnostics({
      ...created.diagnostics,
      stateDiagnostics: [...created.diagnostics.stateDiagnostics].reverse(),
    }, { potentialEnsembleValidation: potentialValidation }).fingerprint,
    created.fingerprint,
  )
  expectPotentialSampleDiagnosticsError(
    () => parseZatomMicrostatePotentialSampleDiagnostics({
      ...created.diagnostics,
      stateDiagnostics: created.diagnostics.stateDiagnostics.map((diagnostic, index) => (
        index === 0
          ? { ...diagnostic, maximumSplitRhat: diagnostic.maximumSplitRhat! + 0.01 }
          : diagnostic
      )),
    }, { potentialEnsembleValidation: potentialValidation }),
    'microstate_potential_sample_diagnostics_result_mismatch',
  )

  const duplicatedChains = draft.design.chains.map((chain) => ({
    ...chain,
    sampleIds: [...chain.sampleIds],
  }))
  duplicatedChains[1].sampleIds[0] = duplicatedChains[0].sampleIds[0]
  expectPotentialSampleDiagnosticsError(
    () => createZatomMicrostatePotentialSampleDiagnostics({
      ...draft,
      design: { ...draft.design, chains: duplicatedChains },
    }, { potentialEnsembleValidation: potentialValidation }),
    'microstate_potential_sample_diagnostics_sample_coverage_mismatch',
  )

  const unequalChains = draft.design.chains.map((chain) => ({
    ...chain,
    sampleIds: [...chain.sampleIds],
  }))
  const movedSampleId = unequalChains[0].sampleIds.shift()!
  unequalChains[1].sampleIds.push(movedSampleId)
  expectPotentialSampleDiagnosticsError(
    () => createZatomMicrostatePotentialSampleDiagnostics({
      ...draft,
      design: { ...draft.design, chains: unequalChains },
    }, { potentialEnsembleValidation: potentialValidation }),
    'microstate_potential_sample_diagnostics_chain_contract_failed',
  )

  const nonuniformArtifact = {
    ...passingFixture.artifact,
    samples: passingFixture.artifact.samples.map((sample, index) => ({
      ...sample,
      weight: index === 0 ? sample.weight + 0.001
        : index === 1 ? sample.weight - 0.001
          : sample.weight,
    })),
  }
  const nonuniformValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    nonuniformArtifact,
    parseOptions,
  )
  expectPotentialSampleDiagnosticsError(
    () => createZatomMicrostatePotentialSampleDiagnostics(
      potentialSampleDiagnosticsDraft(nonuniformValidation, passingFixture.chains),
      { potentialEnsembleValidation: nonuniformValidation },
    ),
    'microstate_potential_sample_diagnostics_nonuniform_mcmc_weights',
  )

  const solveOptions = {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble' as const,
    sampleDiagnosticsPolicy: 'require-pass' as const,
    equilibriumPotentialEnsemble: potentialValidation.ensemble,
    potentialSampleDiagnostics: created.diagnostics,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 30,
  }
  const solved = solveZatomMicrostatePopulations(graphValidation.graph, solveOptions)
  assertEqual(solved.solution.solver.potentialSampleDiagnosticsFingerprint, created.fingerprint)
  assertEqual(solved.solution.solver.sampleDiagnosticsPolicy, 'require-pass')
  assertEqual(solved.solution.uncertainty?.sampleDiagnosticsAssessment, 'passed')
  assertTrue(solved.solution.provenance.citations.includes('urn:zatom:test:mcmc-diagnostics'))
  assertTrue(solved.checks.some((check) => (
    check.id === 'microstate_population.sample_diagnostics' && check.status === 'pass'
  )))
  const { potentialSampleDiagnostics: _diagnostics, ...missingDiagnosticsOptions } = solveOptions
  expectInputError(
    () => solveZatomMicrostatePopulations(graphValidation.graph, missingDiagnosticsOptions),
    'microstate_population_sample_diagnostics_required',
  )

  const failingFixture = mcmcPotentialEnsembleFixture(graphValidation, true)
  const failingPotentialValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    failingFixture.artifact,
    parseOptions,
  )
  const failingDiagnostics = createZatomMicrostatePotentialSampleDiagnostics(
    potentialSampleDiagnosticsDraft(failingPotentialValidation, failingFixture.chains),
    { potentialEnsembleValidation: failingPotentialValidation },
  )
  assertEqual(failingDiagnostics.diagnostics.overallPassed, false)
  expectInputError(
    () => solveZatomMicrostatePopulations(graphValidation.graph, {
      ...solveOptions,
      equilibriumPotentialEnsemble: failingPotentialValidation.ensemble,
      potentialSampleDiagnostics: failingDiagnostics.diagnostics,
    }),
    'microstate_population_sample_diagnostics_failed',
  )

  const diagnosticsTool = await callZatomMcpTool('microstate_diagnose_potential_samples', {
    potentialEnsemble: potentialValidation.ensemble,
    graph: graphValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    design: draft.design,
    acceptance: draft.acceptance,
    provenance: draft.provenance,
  })
  assertTrue(diagnosticsTool.structuredContent.ok, diagnosticsTool.structuredContent.summary)
  const diagnosticsToolData = diagnosticsTool.structuredContent.data as {
    sampleDiagnosticsValidation: typeof created
  }
  assertEqual(diagnosticsToolData.sampleDiagnosticsValidation.fingerprint, created.fingerprint)

  const solveTool = await callZatomMcpTool('microstate_solve_populations', {
    ...solveOptions,
    graph: graphValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(solveTool.structuredContent.ok, solveTool.structuredContent.summary)
  const solveToolData = solveTool.structuredContent.data as { solutionFingerprint: string }
  assertEqual(solveToolData.solutionFingerprint, solved.solutionFingerprint)

  const titrationOptions = {
    structure,
    chemicalStateEnsemble: ensemble,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'equilibrium-potential-sample-ensemble' as const,
    sampleDiagnosticsPolicy: 'require-pass' as const,
    equilibriumPotentialEnsemble: potentialValidation.ensemble,
    potentialSampleDiagnostics: created.diagnostics,
    sampleIntervalProbability: 0.8,
    minimumSampleWeightEffectiveSize: 30,
  }
  const titration = scanZatomMicrostateTitration(graphValidation.graph, titrationOptions)
  assertEqual(titration.series.solver.potentialSampleDiagnosticsFingerprint, created.fingerprint)
  assertEqual(titration.series.uncertainty?.sampleDiagnosticsAssessment, 'passed')
  assertTrue(titration.checks.some((check) => (
    check.id === 'microstate_titration.sample_diagnostics' && check.status === 'pass'
  )))
  const scanTool = await callZatomMcpTool('microstate_scan_titration', {
    ...titrationOptions,
    graph: graphValidation.graph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
  })
  assertTrue(scanTool.structuredContent.ok, scanTool.structuredContent.summary)
  const scanToolData = scanTool.structuredContent.data as { seriesFingerprint: string }
  assertEqual(scanToolData.seriesFingerprint, titration.seriesFingerprint)
}

async function testCorrelatedGeneralizedLeastSquares(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const correlatedGraph = withCorrelatedEdgeErrors(graph)
  const parsed = parseZatomMicrostateTransitionGraph(correlatedGraph, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  assertTrue(parsed.checks.some((check) => (
    check.id === 'microstate_graph.edge_correlation' && check.status === 'pass'
  )))
  assertEqual(parsed.graph.edgeCorrelation?.edgeIds.join(','), parsed.graph.edges.map((edge) => edge.id).join(','))

  const reversedIds = [...correlatedGraph.edgeCorrelation!.edgeIds].reverse()
  const reordered = withCorrelatedEdgeErrors(graph, reversedIds)
  assertEqual(
    parseZatomMicrostateTransitionGraph(reordered, { structure, chemicalStateEnsemble: ensemble }).fingerprint,
    parsed.fingerprint,
  )

  const independent = solveZatomMicrostatePopulations(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'independent-gaussian-delta-method',
  })
  const correlated = solveZatomMicrostatePopulations(correlatedGraph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'correlated-gaussian-delta-method',
  })
  assertEqual(correlated.solution.solver.method, 'log-equilibrium-graph-generalized-least-squares')
  assertEqual(
    correlated.solution.uncertainty?.method,
    'generalized-least-squares-correlated-gaussian-edge-errors-delta-method',
  )
  correlated.solution.populations.forEach((entry) => {
    assertApprox(entry.fraction, populationById(independent, entry.stateId).fraction, 1e-12)
  })
  assertTrue(correlated.solution.populations.some((entry) => (
    Math.abs(entry.standardDeviation! - populationById(independent, entry.stateId).standardDeviation!) > 1e-8
  )))
  assertTrue(correlated.checks.some((check) => (
    check.id === 'microstate_population.uncertainty'
    && check.status === 'pass'
    && check.message.includes('correlation matrix')
  )))

  const inconsistentGraph = withCorrelatedEdgeErrors({
    ...graph,
    edges: graph.edges.map((edge) => edge.id === 'edge-b-deprotonation'
      ? { ...edge, pKa: 3.2 }
      : edge),
    acceptance: { maximumCycleClosureResidualLog10: 1 },
  })
  const inconsistent = solveZatomMicrostatePopulations(inconsistentGraph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'correlated-gaussian-delta-method',
  })
  const inconsistentCanonical = inconsistent.graphValidation.graph
  const stateIndexById = new Map(inconsistentCanonical.states.map((state, index) => [state.stateId, index]))
  const design = inconsistentCanonical.edges.map((edge) => {
    const row = Array.from({ length: inconsistentCanonical.states.length - 1 }, () => 0)
    const from = stateIndexById.get(edge.fromStateId)!
    const to = stateIndexById.get(edge.toStateId)!
    if (from !== 0) row[from - 1] = -1
    if (to !== 0) row[to - 1] = 1
    return row
  })
  const targets = inconsistentCanonical.edges.map((edge) => edge.kind === 'proton-transfer'
    ? 5 - edge.pKa
    : -edge.deltaGToMinusFromKcalMol / (GAS_CONSTANT_KCAL_PER_MOL_K * TEMPERATURE_K * Math.log(10)))
  const sigmas = inconsistentCanonical.edges.map((edge) => edge.kind === 'proton-transfer'
    ? edge.uncertainty!.standardDeviation
    : edge.uncertainty!.standardDeviation / (GAS_CONSTANT_KCAL_PER_MOL_K * TEMPERATURE_K * Math.log(10)))
  const edgeCovariance = inconsistentCanonical.edgeCorrelation!.correlationMatrix.map((row, rowIndex) => (
    row.map((correlation, columnIndex) => correlation * sigmas[rowIndex] * sigmas[columnIndex])
  ))
  const inverseEdgeCovariance = invertDenseForTest(edgeCovariance)
  const inverseTimesDesignColumns = design[0].map((_, column) => matrixVector(
    inverseEdgeCovariance,
    design.map((row) => row[column]),
  ))
  const inverseTimesTargets = matrixVector(inverseEdgeCovariance, targets)
  const normal = design[0].map((_, row) => design[0].map((__, column) => (
    design.reduce((sum, designRow, observation) => (
      sum + designRow[row] * inverseTimesDesignColumns[column][observation]
    ), 0)
  )))
  const rhs = design[0].map((_, row) => design.reduce((sum, designRow, observation) => (
    sum + designRow[row] * inverseTimesTargets[observation]
  ), 0))
  const expectedLogWeights = [0, ...matrixVector(invertDenseForTest(normal), rhs)]
  inconsistent.solution.populations.forEach((entry, index) => {
    assertApprox(entry.log10WeightRelativeToReference, expectedLogWeights[index], 1e-10)
  })

  const titration = scanZatomMicrostateTitration(correlatedGraph, {
    structure,
    chemicalStateEnsemble: ensemble,
    pHMinimum: 0,
    pHMaximum: 14,
    pointCount: 15,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'correlated-gaussian-delta-method',
  })
  assertEqual(
    titration.series.solver.method,
    'log-equilibrium-graph-generalized-least-squares-with-analytic-ph-shift',
  )
  assertEqual(
    titration.series.uncertainty?.method,
    'generalized-least-squares-correlated-gaussian-edge-errors-delta-method',
  )
  assertTrue((titration.series.macroscopicSteps[0].standardDeviation ?? 0) > 0)

  const tool = await callZatomMcpTool('microstate_solve_populations', {
    graph: correlatedGraph,
    chemicalStateEnsemble: ensemble,
    structure,
    useActiveStructure: false,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: false,
    uncertaintyMode: 'correlated-gaussian-delta-method',
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { solutionFingerprint: string }
  assertEqual(toolData.solutionFingerprint, correlated.solutionFingerprint)
}

function testFailureModes(): void {
  const { structure, ensemble, graph } = fixture()
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...graph,
      chemicalStateEnsembleFingerprint: 'fnv1a64:0000000000000000',
    }, { structure, chemicalStateEnsemble: ensemble }),
    'microstate_ensemble_fingerprint_mismatch',
  )
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...graph,
      states: graph.states.map((item) => item.stateId === 'a-h'
        ? { ...item, relativeProtonCount: 0 }
        : item),
    }, { structure, chemicalStateEnsemble: ensemble }),
    'microstate_proton_count_mismatch',
  )
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...graph,
      edges: graph.edges.map((edge) => edge.id === 'edge-a-deprotonation'
        ? { ...edge, fromStateId: edge.toStateId, toStateId: edge.fromStateId }
        : edge),
    }, { structure, chemicalStateEnsemble: ensemble }),
    'microstate_proton_transfer_stoichiometry_mismatch',
  )

  const noncanonicalFormulaEnsemble = parseZatomChemicalStateEnsemble({
    ...ensemble,
    states: ensemble.states.map((item) => item.id === 'a-d'
      ? { ...item, formula: 'H3C2O2-' }
      : item),
  }, { structure }).ensemble
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...graph,
      chemicalStateEnsembleFingerprint: fingerprintChemicalStateEnsemble(noncanonicalFormulaEnsemble),
    }, { structure, chemicalStateEnsemble: noncanonicalFormulaEnsemble }),
    'microstate_state_formula_mismatch',
  )

  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...graph,
      edges: graph.edges.map((edge) => edge.id === 'edge-a-deprotonation'
        ? { ...edge, uncertainty: { ...edge.uncertainty!, standardDeviation: 0 } }
        : edge),
    }, { structure, chemicalStateEnsemble: ensemble }),
    'invalid_microstate_transition_graph',
  )

  expectInputError(
    () => scanZatomMicrostateTitration(graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pHMinimum: 7,
      pHMaximum: 7,
      pointCount: 2,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
    }),
    'invalid_microstate_titration_options',
  )
  expectInputError(
    () => scanZatomMicrostateTitration(graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pHMinimum: 0,
      pHMaximum: 14,
      pointCount: 2,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
      maxPointStates: 7,
    }),
    'microstate_titration_budget_exceeded',
  )
  expectInputError(
    () => scanZatomMicrostateTitration(graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pHMinimum: 0,
      pHMaximum: 14,
      pointCount: 2,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'independent-gaussian-delta-method',
      maxPointCovarianceElements: 17,
    }),
    'microstate_titration_budget_exceeded',
  )

  expectInputError(
    () => solveZatomMicrostatePopulations(graph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'correlated-gaussian-delta-method',
    }),
    'microstate_population_correlation_model_required',
  )
  const correlatedGraph = withCorrelatedEdgeErrors(graph)
  expectInputError(
    () => solveZatomMicrostatePopulations(correlatedGraph, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'independent-gaussian-delta-method',
    }),
    'microstate_population_correlation_cannot_be_ignored',
  )
  const asymmetricMatrix = correlatedGraph.edgeCorrelation!.correlationMatrix.map((row) => [...row])
  asymmetricMatrix[0][1] += 0.05
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...correlatedGraph,
      edgeCorrelation: { ...correlatedGraph.edgeCorrelation!, correlationMatrix: asymmetricMatrix },
    }, { structure, chemicalStateEnsemble: ensemble }),
    'microstate_edge_correlation_symmetry_mismatch',
  )
  expectInputError(
    () => parseZatomMicrostateTransitionGraph({
      ...correlatedGraph,
      edgeCorrelation: {
        ...correlatedGraph.edgeCorrelation!,
        correlationMatrix: graph.edges.map(() => graph.edges.map(() => 1)),
      },
    }, { structure, chemicalStateEnsemble: ensemble }),
    'microstate_edge_correlation_not_positive_definite',
  )
  expectInputError(
    () => parseZatomMicrostateTransitionGraph(correlatedGraph, {
      structure,
      chemicalStateEnsemble: ensemble,
      maxCorrelatedEdges: 3,
    }),
    'microstate_transition_graph_budget_exceeded',
  )

  const disconnected = {
    ...graph,
    edges: graph.edges.filter((edge) => edge.kind === 'proton-transfer'),
    evidenceSources: graph.evidenceSources.filter((source) => source.id === 'source-pka'),
  }
  const disconnectedValidation = parseZatomMicrostateTransitionGraph(disconnected, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  assertTrue(disconnectedValidation.checks.some((check) => (
    check.id === 'microstate_graph.connectivity' && check.status === 'fail'
  )))
  expectInputError(
    () => solveZatomMicrostatePopulations(disconnected, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
    }),
    'microstate_population_graph_disconnected',
  )

  const inconsistent = {
    ...graph,
    edges: graph.edges.map((edge) => edge.id === 'edge-b-deprotonation'
      ? { ...edge, pKa: 4 }
      : edge),
  }
  const inconsistentValidation = parseZatomMicrostateTransitionGraph(inconsistent, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  assertTrue(inconsistentValidation.checks.some((check) => (
    check.id === 'microstate_graph.cycle_closure' && check.status === 'fail'
  )))
  expectInputError(
    () => solveZatomMicrostatePopulations(inconsistent, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-8,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
    }),
    'microstate_population_cycle_closure_failed',
  )

  const incomplete = { ...graph, completeness: { transitionsComplete: false, status: 'Fixture truncation' } }
  expectInputError(
    () => solveZatomMicrostatePopulations(incomplete, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
    }),
    'microstate_population_graph_incomplete',
  )
  assertEqual(solveZatomMicrostatePopulations(incomplete, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: false,
    allowUnknownApplicability: false,
    uncertaintyMode: 'none',
  }).solution.populations.length, 4)

  const missingUncertainty = {
    ...graph,
    edges: graph.edges.map((edge) => edge.id === 'edge-a-deprotonation'
      ? { ...edge, uncertainty: undefined }
      : edge),
  }
  expectInputError(
    () => solveZatomMicrostatePopulations(missingUncertainty, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'independent-gaussian-delta-method',
    }),
    'microstate_population_uncertainty_incomplete',
  )

  const unknownApplicability = {
    ...graph,
    evidenceSources: graph.evidenceSources.map((source) => source.id === 'source-pka'
      ? { ...source, applicability: { ...source.applicability, assessment: 'unknown' as const } }
      : source),
  }
  expectInputError(
    () => solveZatomMicrostatePopulations(unknownApplicability, {
      structure,
      chemicalStateEnsemble: ensemble,
      pH: 5,
      maximumCycleClosureResidualLog10: 1e-10,
      requireCompleteGraph: true,
      allowUnknownApplicability: false,
      uncertaintyMode: 'none',
    }),
    'microstate_population_applicability_unknown',
  )
  assertEqual(solveZatomMicrostatePopulations(unknownApplicability, {
    structure,
    chemicalStateEnsemble: ensemble,
    pH: 5,
    maximumCycleClosureResidualLog10: 1e-10,
    requireCompleteGraph: true,
    allowUnknownApplicability: true,
    uncertaintyMode: 'none',
  }).solution.populations.length, 4)
}

async function testProviderBrokerIntegration(): Promise<void> {
  const { structure, ensemble, graph } = fixture()
  const graphValidation = parseZatomMicrostateTransitionGraph(graph, {
    structure,
    chemicalStateEnsemble: ensemble,
  })
  const mcmcFixture = mcmcPotentialEnsembleFixture(graphValidation)
  const potentialValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    mcmcFixture.artifact,
    {
      chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: graphValidation.fingerprint,
      canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
      referenceStateId: graphValidation.graph.states[0].stateId,
    },
  )
  const potentialEnsemble = potentialValidation.ensemble
  const potentialSampleDiagnostics = createZatomMicrostatePotentialSampleDiagnostics(
    potentialSampleDiagnosticsDraft(potentialValidation, mcmcFixture.chains),
    { potentialEnsembleValidation: potentialValidation },
  ).diagnostics
  const invalidManifestProvider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.invalid-graph-only',
      title: 'Invalid graph-only fixture',
      description: 'A graph output without its ensemble must be rejected.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.predict.invalid-graph-only',
        title: 'Invalid graph only',
        description: 'Invalid manifest fixture.',
        fidelity: 'empirical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: [],
        outputArtifacts: ['microstate-transition-graph'],
        tags: ['test'],
      }],
    },
    execute: () => ({ structure, microstateTransitionGraph: graph, checks: [] }),
  }
  let manifestError: unknown
  try {
    registerZatomModelingProvider(invalidManifestProvider)
  } catch (error) {
    manifestError = error
  }
  assertTrue(manifestError instanceof ZatomProviderError)
  assertEqual((manifestError as ZatomProviderError).code, 'invalid_provider_manifest')

  const invalidPotentialManifestProvider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.invalid-potential-without-graph',
      title: 'Invalid potential-only fixture',
      description: 'A potential ensemble without its graph must be rejected.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.predict.invalid-potential-without-graph',
        title: 'Invalid potential without graph',
        description: 'Invalid manifest fixture.',
        fidelity: 'statistical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: [],
        outputArtifacts: ['chemical-state-ensemble', 'microstate-equilibrium-potential-ensemble'],
        tags: ['test'],
      }],
    },
    execute: () => ({
      structure,
      chemicalStateEnsemble: ensemble,
      microstateEquilibriumPotentialEnsemble: potentialEnsemble,
      checks: [],
    }),
  }
  let potentialManifestError: unknown
  try {
    registerZatomModelingProvider(invalidPotentialManifestProvider)
  } catch (error) {
    potentialManifestError = error
  }
  assertTrue(potentialManifestError instanceof ZatomProviderError)
  assertEqual((potentialManifestError as ZatomProviderError).code, 'invalid_provider_manifest')

  const invalidDiagnosticsManifestProvider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.invalid-diagnostics-without-potentials',
      title: 'Invalid diagnostics-only fixture',
      description: 'Sample diagnostics without their potential ensemble must be rejected.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.predict.invalid-diagnostics-without-potentials',
        title: 'Invalid diagnostics without potentials',
        description: 'Invalid manifest fixture.',
        fidelity: 'statistical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: [],
        outputArtifacts: [
          'chemical-state-ensemble',
          'microstate-transition-graph',
          'microstate-potential-sample-diagnostics',
        ],
        tags: ['test'],
      }],
    },
    execute: () => ({
      structure,
      chemicalStateEnsemble: ensemble,
      microstateTransitionGraph: graph,
      microstatePotentialSampleDiagnostics: potentialSampleDiagnostics,
      checks: [],
    }),
  }
  let diagnosticsManifestError: unknown
  try {
    registerZatomModelingProvider(invalidDiagnosticsManifestProvider)
  } catch (error) {
    diagnosticsManifestError = error
  }
  assertTrue(diagnosticsManifestError instanceof ZatomProviderError)
  assertEqual((diagnosticsManifestError as ZatomProviderError).code, 'invalid_provider_manifest')

  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.microstate-graph-output',
      title: 'Microstate graph fixture provider',
      description: 'Return a canonical ensemble, graph, joint potential samples, and ordered-chain diagnostics together.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-graph', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.predict.fixture-microstate-graph',
        title: 'Fixture microstate graph',
        description: 'Return a complete analytic graph fixture.',
        fidelity: 'empirical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.graph'],
        outputArtifacts: [
          'chemical-state-ensemble',
          'microstate-transition-graph',
          'microstate-equilibrium-potential-ensemble',
          'microstate-potential-sample-diagnostics',
        ],
        tags: ['microstate', 'population'],
      }],
    },
    execute: () => ({
      structure,
      chemicalStateEnsemble: ensemble,
      microstateTransitionGraph: graph,
      microstateEquilibriumPotentialEnsemble: potentialEnsemble,
      microstatePotentialSampleDiagnostics: potentialSampleDiagnostics,
      checks: [{ id: 'fixture.graph', status: 'pass', message: 'Fixture graph completed' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const result = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(result.structuredContent.ok, result.structuredContent.summary)
    const data = result.structuredContent.data as {
      result: {
        microstateTransitionGraph: ZatomMicrostateTransitionGraph
        microstateEquilibriumPotentialEnsemble: ZatomMicrostateEquilibriumPotentialEnsemble
        microstatePotentialSampleDiagnostics: typeof potentialSampleDiagnostics
        provenance: {
          microstateTransitionGraphFingerprint: string
          microstateEquilibriumPotentialEnsembleFingerprint: string
          microstatePotentialSampleDiagnosticsFingerprint: string
        }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.microstateTransitionGraph.edges.length, 4)
    assertTrue(data.result.provenance.microstateTransitionGraphFingerprint.startsWith('fnv1a64:'))
    assertEqual(data.result.microstateEquilibriumPotentialEnsemble.samples.length, 32)
    assertTrue(data.result.provenance.microstateEquilibriumPotentialEnsembleFingerprint.startsWith('fnv1a64:'))
    assertEqual(data.result.microstatePotentialSampleDiagnostics.overallPassed, true)
    assertTrue(data.result.provenance.microstatePotentialSampleDiagnosticsFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.microstate_transition_graph_contract' && check.status === 'pass'
    )))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.microstate_equilibrium_potential_ensemble_contract' && check.status === 'pass'
    )))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.microstate_potential_sample_diagnostics_contract' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }
}

async function main(): Promise<void> {
  await testCanonicalValidationAndMcp()
  await testPopulationEquationsUncertaintyAndMcp()
  await testTitrationSeriesMacroscopicPkaAndMcp()
  await testStateCoverageCensoringBoundsAndMcp()
  await testJointPotentialSampleEnsemblePropagationAndMcp()
  await testPotentialModelMixtureCompositionAndMcp()
  await testPotentialSampleDiagnosticsAndMcp()
  await testCorrelatedGeneralizedLeastSquares()
  testFailureModes()
  await testProviderBrokerIntegration()
  console.log('agent microstate transition graph, population, and titration solver tests passed')
}

void main()
