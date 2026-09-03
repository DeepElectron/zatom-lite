import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure, ZatomTrajectory } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  ZATOM_PROVIDER_SCHEMA,
  type ZatomModelingProvider,
  type ZatomProviderContinuationState,
} from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintTrajectory } from '../trajectory'

const source: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'continuation H2 final state',
  atoms: [
    { id: 'h-left', element: 'H', position: [0.01, 0, 0] },
    { id: 'h-right', element: 'H', position: [0.77, 0, 0] },
  ],
  bonds: [{ id: 'h-h', atomIds: ['h-left', 'h-right'], order: 1 }],
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['h-left', 'h-right'],
  coordinateMode: 'cartesian',
  label: 'two-frame continuation fixture',
  frames: [
    {
      step: 0,
      timePs: 0,
      positions: [[0, 0, 0], [0.76, 0, 0]],
      velocitiesAperPs: [[0.1, 0, 0], [-0.1, 0, 0]],
    },
    {
      step: 10,
      timePs: 0.002,
      positions: source.atoms.map((atom) => [...atom.position]),
      velocitiesAperPs: [[0.2, 0.01, 0], [-0.2, -0.01, 0]],
      forcesEvPerA: [[0.3, 0, 0], [-0.3, 0, 0]],
      scalars: { totalEnergyEv: -1.25 },
    },
  ],
}

interface RunData {
  result: {
    checks: Array<{ id: string; status: string }>
    provenance: {
      sourceTrajectoryFingerprint?: string
      sourceTrajectoryFrameIndex?: number
    }
  }
}

async function testExplicitAndActiveContinuationAreFingerprintBound() {
  const received: Array<ZatomProviderContinuationState | null> = []
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.continuation-provider',
      title: 'Continuation contract fixture',
      description: 'Captures compact continuation state for broker contract regression.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1' },
      execution: 'browser',
      capabilities: [{
        id: 'test.continue-final-frame',
        title: 'Continue from final frame',
        description: 'Test-only continuation capability.',
        fidelity: 'empirical',
        source: 'required',
        continuation: { mode: 'optional', frame: 'final', requiredFrameFields: ['velocitiesAperPs'] },
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.continuation'],
        tags: ['test', 'continuation'],
      }],
    },
    execute: (request) => {
      received.push(request.continuation)
      return {
        structure: request.source!,
        checks: [{
          id: 'fixture.continuation',
          status: request.continuation ? 'pass' : 'skipped',
          message: request.continuation ? 'Consumed compact continuation state' : 'Fresh structure-only execution',
        }],
      }
    },
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const explicit = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.continue-final-frame',
      structure: source,
      sourceTrajectory: trajectory,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(explicit.structuredContent.ok, explicit.structuredContent.summary)
    assertEqual(received.length, 1)
    const state = received[0]!
    assertEqual(state.schemaVersion, 'zatom.provider-continuation/v1')
    assertEqual(state.sourceTrajectoryFingerprint, fingerprintTrajectory(trajectory))
    assertEqual(state.sourceFrameCount, 2)
    assertEqual(state.frameIndex, 1)
    assertEqual(state.frame.step, 10)
    assertEqual(state.frame.timePs, 0.002)
    assertDeepEqual(state.frame.velocitiesAperPs, trajectory.frames[1].velocitiesAperPs)
    const explicitData = explicit.structuredContent.data as RunData
    assertEqual(explicitData.result.provenance.sourceTrajectoryFingerprint, fingerprintTrajectory(trajectory))
    assertEqual(explicitData.result.provenance.sourceTrajectoryFrameIndex, 1)
    assertTrue(explicitData.result.checks.some((check) => (
      check.id === 'provider.continuation_contract' && check.status === 'pass'
    )))

    const active = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.continue-final-frame',
      parameters: {},
      useActiveTrajectory: true,
      applyToWorkspace: false,
    }, {
      readStructure: () => source,
      readTrajectory: () => trajectory,
    })
    assertTrue(active.structuredContent.ok, active.structuredContent.summary)
    assertEqual(received.length, 2)
    assertEqual(received[1]?.sourceTrajectoryFingerprint, fingerprintTrajectory(trajectory))

    const fresh = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.continue-final-frame',
      structure: source,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(fresh.structuredContent.ok, fresh.structuredContent.summary)
    assertEqual(received[2], null)
    const freshData = fresh.structuredContent.data as RunData
    assertTrue(freshData.result.checks.some((check) => (
      check.id === 'provider.continuation_contract' && check.status === 'skipped'
    )))

    const missingVelocity: ZatomTrajectory = {
      ...trajectory,
      frames: trajectory.frames.map((frame, index) => index === 1
        ? { step: frame.step, timePs: frame.timePs, positions: frame.positions }
        : frame),
    }
    const missing = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.continue-final-frame',
      structure: source,
      sourceTrajectory: missingVelocity,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(missing.structuredContent.ok, false)
    assertEqual(missing.structuredContent.error?.code, 'continuation_frame_field_required')
  } finally {
    unregister()
  }
}

async function testUnsupportedAndMismatchedContinuationFailBeforeExecution() {
  let executions = 0
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.no-continuation-provider',
      title: 'No continuation fixture',
      description: 'Rejects continuation at the broker boundary.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1' },
      execution: 'browser',
      capabilities: [{
        id: 'test.structure-only',
        title: 'Structure only',
        description: 'Test-only structure capability.',
        fidelity: 'geometric',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: [],
        tags: ['test'],
      }],
    },
    execute: (request) => {
      executions++
      return { structure: request.source!, checks: [] }
    },
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const unsupported = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.structure-only',
      structure: source,
      sourceTrajectory: trajectory,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(unsupported.structuredContent.ok, false)
    assertEqual(unsupported.structuredContent.error?.code, 'continuation_not_allowed')
    assertEqual(executions, 0)
  } finally {
    unregister()
  }

  const mismatchProvider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.mismatch-continuation-provider',
      title: 'Mismatch continuation fixture',
      description: 'Requires final-frame/source identity.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1' },
      execution: 'browser',
      capabilities: [{
        id: 'test.continue-mismatch',
        title: 'Continue mismatch',
        description: 'Test-only continuation capability.',
        fidelity: 'empirical',
        source: 'required',
        continuation: { mode: 'required', frame: 'final', requiredFrameFields: ['velocitiesAperPs'] },
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: [],
        tags: ['test'],
      }],
    },
    execute: (request) => ({ structure: request.source!, checks: [] }),
  }
  const unregisterMismatch = registerZatomModelingProvider(mismatchProvider)
  try {
    const movedSource: ZatomStructure = {
      ...source,
      atoms: source.atoms.map((atom, index) => index === 0
        ? { ...atom, position: [0.02, 0, 0] as [number, number, number] }
        : atom),
    }
    const mismatch = await callZatomMcpTool('modeling_run_provider', {
      providerId: mismatchProvider.manifest.id,
      capability: 'test.continue-mismatch',
      structure: movedSource,
      sourceTrajectory: trajectory,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(mismatch.structuredContent.ok, false)
    assertEqual(mismatch.structuredContent.error?.code, 'invalid_trajectory')

    const absent = await callZatomMcpTool('modeling_run_provider', {
      providerId: mismatchProvider.manifest.id,
      capability: 'test.continue-mismatch',
      structure: source,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(absent.structuredContent.ok, false)
    assertEqual(absent.structuredContent.error?.code, 'continuation_required')
  } finally {
    unregisterMismatch()
  }
}

async function main() {
  await testExplicitAndActiveContinuationAreFingerprintBound()
  await testUnsupportedAndMismatchedContinuationFailBeforeExecution()
}

void main()
