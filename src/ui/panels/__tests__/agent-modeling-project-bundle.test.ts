import { assertEqual, assertTrue } from '../../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../../../agent/contracts'
import { parseAgentModelingPlan, ZATOM_AGENT_MODELING_PLAN_SCHEMA } from '../../../agent/modeling-plan'
import { composeAgentModelingCapabilityRoute } from '../../../agent/modeling-routing'
import { fingerprintCanonicalJson, fingerprintStructure } from '../../../agent/structure-math'
import { fingerprintTrajectory } from '../../../agent/trajectory'
import { listZatomAgentTools } from '../../../agent/tools'
import {
  readActiveViewportStructure,
  readActiveViewportTrajectory,
  writeActiveViewportStructure,
  writeActiveViewportTrajectory,
} from '../../../agent/viewer-context'
import {
  AgentModelingProjectBundleError,
  composeAgentModelingProjectBundle,
  parseAgentModelingProjectBundle,
} from '../agent-modeling-project-bundle'
import {
  captureAgentModelingProjectBundle,
  replaceAgentModelingProjectBundle,
} from '../agent-modeling-project-runtime'
import {
  replaceAgentModelingRunHistory,
  useAgentModelingStore,
} from '../agent-modeling-store'
import { useAgentModelingTaskStore } from '../agent-modeling-task-store'

const structure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'portable periodic pair',
  atoms: [
    { id: 'c', element: 'C', position: [0, 0, 0] },
    { id: 'h', element: 'H', position: [2, 0, 0] },
  ],
  bonds: [{ id: 'c-h', atomIds: ['c', 'h'], order: 1 }],
  lattice: {
    vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
    periodic: [true, true, true],
  },
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['c', 'h'],
  coordinateMode: 'cartesian',
  lattice: structure.lattice,
  frames: [
    { step: 0, timePs: 0, positions: [[0.1, 0, 0], [2.1, 0, 0]] },
    { step: 1, timePs: 0.001, positions: [[0, 0, 0], [2, 0, 0]] },
  ],
}

function validationPlan() {
  const manifests = listZatomAgentTools()
  const goal = 'Validate and preserve the exact portable workspace.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'validate',
      objective: 'Validate the active periodic structure.',
      requiredTags: ['validation', 'position'],
      providerPolicy: 'built-in-only',
    }],
  }, manifests)
  return parseAgentModelingPlan({
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Portable validation task',
    goal,
    routing: {
      route,
      selections: [{ stageId: 'validate', stepId: 'validate', source: 'built-in' }],
    },
    steps: [{ id: 'validate', tool: 'structure_validate', input: {} }],
  }, manifests)
}

function expectProjectError(value: unknown, code: string): void {
  let received: unknown = null
  try {
    parseAgentModelingProjectBundle(value, listZatomAgentTools())
  } catch (error) {
    received = error
  }
  assertTrue(received instanceof AgentModelingProjectBundleError)
  assertEqual((received as AgentModelingProjectBundleError).code, code)
}

async function main(): Promise<void> {
  useAgentModelingStore.setState({
    status: 'idle',
    runningTool: null,
    current: null,
    history: [],
    historyStatus: 'ready',
    historyPersistenceError: null,
    focusingTargetKey: null,
    visualError: null,
  })
  useAgentModelingTaskStore.getState().clearTask()
  useAgentModelingTaskStore.setState({ persistenceStatus: 'ready', persistenceError: null })
  await writeActiveViewportStructure(structure)
  await writeActiveViewportTrajectory(trajectory)

  const plan = validationPlan()
  useAgentModelingTaskStore.getState().loadPlan(plan)
  await useAgentModelingTaskStore.getState().startTask()
  assertEqual(useAgentModelingTaskStore.getState().status, 'completed')
  assertEqual(useAgentModelingStore.getState().history.length, 1)

  const project = captureAgentModelingProjectBundle()
  assertEqual(project.history?.runs.length, 1)
  assertEqual(project.task?.status, 'completed')
  assertEqual(project.workspace.structureFingerprint, fingerprintStructure(structure))
  assertEqual(project.workspace.trajectoryFingerprint, fingerprintTrajectory(trajectory))
  assertEqual(parseAgentModelingProjectBundle(project, listZatomAgentTools()).fingerprint, project.fingerprint)

  await writeActiveViewportStructure({
    ...structure,
    atoms: structure.atoms.map((atom, index) => index === 0
      ? { ...atom, position: [0.25, 0, 0] }
      : atom),
  })
  let completedTaskDriftRejected = false
  try {
    captureAgentModelingProjectBundle()
  } catch (error) {
    completedTaskDriftRejected = error instanceof AgentModelingProjectBundleError
      && error.code === 'agent_modeling_project_task_workspace_mismatch'
  }
  assertTrue(completedTaskDriftRejected)
  await writeActiveViewportStructure(structure)
  await writeActiveViewportTrajectory(trajectory)

  expectProjectError(
    { ...project, fingerprint: 'fnv1a64:0000000000000000' },
    'agent_modeling_project_bundle_fingerprint_mismatch',
  )
  const driftedWorkspacePayload = {
    schemaVersion: project.schemaVersion,
    workspace: {
      ...project.workspace,
      structureFingerprint: 'fnv1a64:0000000000000000',
    },
    history: project.history,
    task: project.task,
  }
  expectProjectError({
    ...driftedWorkspacePayload,
    fingerprint: fingerprintCanonicalJson(driftedWorkspacePayload),
  }, 'agent_modeling_project_workspace_fingerprint_mismatch')

  const other: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'replacement fixture',
    atoms: [{ id: 'n', element: 'N', position: [1, 2, 3] }],
  }
  useAgentModelingTaskStore.getState().clearTask()
  replaceAgentModelingRunHistory([])
  await writeActiveViewportStructure(other)
  await replaceAgentModelingProjectBundle(project)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), project.workspace.structureFingerprint)
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), project.workspace.trajectoryFingerprint)
  assertEqual(useAgentModelingStore.getState().history.length, 1)
  assertEqual(useAgentModelingTaskStore.getState().status, 'completed')

  const structureOnly = composeAgentModelingProjectBundle({
    structure: other,
    trajectory: null,
    history: [],
    task: null,
  }, listZatomAgentTools())
  await replaceAgentModelingProjectBundle(structureOnly)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(other))
  assertEqual(readActiveViewportTrajectory(), null)
  assertEqual(useAgentModelingStore.getState().history.length, 0)
  assertEqual(useAgentModelingStore.getState().current, null)
  assertEqual(useAgentModelingTaskStore.getState().status, 'idle')

  useAgentModelingTaskStore.getState().loadPlan(plan)
  useAgentModelingTaskStore.setState({
    status: 'running',
    activeStepIndex: 0,
    steps: [{
      id: 'validate',
      tool: 'structure_validate',
      title: 'Validate atomic structure',
      status: 'running',
      limitationsAcknowledged: false,
    }],
  })
  let unstableRejected = false
  try {
    captureAgentModelingProjectBundle()
  } catch (error) {
    unstableRejected = error instanceof AgentModelingProjectBundleError
      && error.code === 'agent_modeling_project_task_unstable'
  }
  assertTrue(unstableRejected)
  useAgentModelingTaskStore.setState({ status: 'cancelled' })
  useAgentModelingTaskStore.getState().clearTask()
  console.log('agent modeling project bundle tests passed')
}

void main()
