import { assertEqual, assertTrue } from '../../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ViewportTargetPlacement, type ZatomStructure } from '../../../agent/contracts'
import { parseAgentModelingPlan, ZATOM_AGENT_MODELING_PLAN_SCHEMA } from '../../../agent/modeling-plan'
import { composeAgentModelingCapabilityRoute } from '../../../agent/modeling-routing'
import { listZatomAgentTools } from '../../../agent/tools'
import {
  activeViewportToolContext,
  readActiveViewportStructure,
  writeActiveViewportStructure,
} from '../../../agent/viewer-context'
import {
  collectAgentInspectionTargets,
  useAgentModelingStore,
} from '../agent-modeling-store'
import {
  composeAgentModelingTaskRunArtifact,
  parseAgentModelingTaskRunArtifact,
} from '../agent-modeling-task-artifact'
import { useAgentModelingTaskStore } from '../agent-modeling-task-store'

const origin: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: [{ id: 'origin', element: 'C', position: [0, 0, 0] }],
}

const placement: ViewportTargetPlacement = {
  centerNdc: [0, 0, 0],
  centerPx: [80, 60],
  viewportSizePx: [160, 120],
  projectedRadiusPx: 20,
  centerVisible: true,
  regionVisible: true,
}

function parseRouteBoundPlan(input: {
  title: string
  goal: string
  steps: Array<{ id: string; tool: string; input: Record<string, unknown> }>
}) {
  const manifests = listZatomAgentTools()
  const route = composeAgentModelingCapabilityRoute({
    goal: input.goal,
    maximumCandidatesPerStage: 12,
    stages: input.steps.map((step) => {
      const manifest = manifests.find((candidate) => candidate.name === step.tool)
      if (!manifest || !manifest.tags.length || manifest.tags.length > 12) {
        throw new Error(`Cannot route test step ${step.id}`)
      }
      return {
        id: step.id,
        objective: manifest.title,
        requiredTags: [...manifest.tags],
        providerPolicy: 'built-in-only',
      }
    }),
  }, manifests)
  return parseAgentModelingPlan({
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    ...input,
    routing: {
      route,
      selections: input.steps.map((step) => ({
        stageId: step.id,
        stepId: step.id,
        source: 'built-in',
      })),
    },
  }, manifests)
}

async function captureEveryCurrentTarget(): Promise<void> {
  const targets = collectAgentInspectionTargets(useAgentModelingStore.getState().current?.result)
  assertTrue(targets.length > 0)
  for (const target of targets) {
    assertTrue(await useAgentModelingStore.getState().focusCurrentTarget(target))
  }
}

async function testCandidateAndVisualReviewTask(): Promise<void> {
  await writeActiveViewportStructure(origin)
  useAgentModelingStore.setState({
    status: 'idle',
    runningTool: null,
    current: null,
    history: [],
    historyStatus: 'ready',
    focusingTargetKey: null,
    visualError: null,
  })
  useAgentModelingTaskStore.getState().clearTask()
  useAgentModelingTaskStore.setState({ persistenceStatus: 'ready', persistenceError: null })
  const originalFocus = activeViewportToolContext.focusInspectionTarget
  const originalCapture = activeViewportToolContext.captureViewport
  activeViewportToolContext.focusInspectionTarget = async () => placement
  activeViewportToolContext.captureViewport = async () => ({
    imageBase64: Buffer.from('screen-space-evidence').toString('base64'),
    mimeType: 'image/jpeg',
    width: 160,
    height: 120,
  })
  try {
    const plan = parseRouteBoundPlan({
      title: 'Create and verify water',
      goal: 'Create a topology-aware water molecule and verify its geometry in the viewport.',
      steps: [
        { id: 'create', tool: 'molecule_create_from_template', input: { template: 'water' } },
        { id: 'topology', tool: 'molecule_validate_topology', input: {} },
      ],
    })
    useAgentModelingTaskStore.getState().loadPlan(plan)
    await useAgentModelingTaskStore.getState().startTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'review')
    assertTrue(!!useAgentModelingStore.getState().current?.candidate)
    assertEqual(readActiveViewportStructure()?.atoms[0]?.id, 'origin')

    await useAgentModelingTaskStore.getState().resumeTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'review')
    assertTrue(useAgentModelingStore.getState().current?.application?.applicationVerified === true)
    assertEqual(readActiveViewportStructure()?.atoms.length, 3)
    await captureEveryCurrentTarget()
    await useAgentModelingTaskStore.getState().resumeTask()

    assertEqual(useAgentModelingTaskStore.getState().status, 'review')
    assertEqual(useAgentModelingTaskStore.getState().activeStepIndex, 1)
    await captureEveryCurrentTarget()
    await useAgentModelingTaskStore.getState().resumeTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'completed')
    assertEqual(useAgentModelingTaskStore.getState().activeStepIndex, 1)
    assertTrue(useAgentModelingTaskStore.getState().steps.every((step) => step.status === 'completed'))
    assertTrue(useAgentModelingStore.getState().history.length >= 2)
    const taskArtifact = composeAgentModelingTaskRunArtifact(
      useAgentModelingTaskStore.getState(),
      listZatomAgentTools(),
      useAgentModelingStore.getState().history,
    )
    assertEqual(taskArtifact.status, 'completed')
    assertTrue(taskArtifact.steps.every((step) => step.run?.fingerprint.startsWith('fnv1a64:')))
    assertEqual(
      parseAgentModelingTaskRunArtifact(
        taskArtifact,
        listZatomAgentTools(),
        useAgentModelingStore.getState().history,
      ).fingerprint,
      taskArtifact.fingerprint,
    )

    useAgentModelingTaskStore.getState().clearTask()
    const blockedPlan = parseRouteBoundPlan({
      title: 'Reject overlapping atoms',
      goal: 'Preserve the exact failing run that blocks this task.',
      steps: [{
        id: 'reject_overlap',
        tool: 'structure_validate',
        input: {
          structure: {
            schemaVersion: ZATOM_STRUCTURE_SCHEMA,
            atoms: [
              { id: 'overlap-a', element: 'C', position: [0, 0, 0] },
              { id: 'overlap-b', element: 'C', position: [0, 0, 0] },
            ],
          },
        },
      }],
    })
    useAgentModelingTaskStore.getState().loadPlan(blockedPlan)
    await useAgentModelingTaskStore.getState().startTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'blocked')
    assertTrue(useAgentModelingTaskStore.getState().message?.includes('Closest atom pair is 0.0000 Å') === true)
    assertEqual(
      useAgentModelingTaskStore.getState().steps[0]?.runId,
      useAgentModelingStore.getState().current?.id,
    )
    assertTrue(composeAgentModelingTaskRunArtifact(
      useAgentModelingTaskStore.getState(),
      listZatomAgentTools(),
      useAgentModelingStore.getState().history,
    ).steps[0]?.run !== null)

    useAgentModelingTaskStore.getState().clearTask()
    await writeActiveViewportStructure(origin)
    const recoveryGuardPlan = parseRouteBoundPlan({
      title: 'Guard recovered workspace identity',
      goal: 'Never apply a reviewed candidate after the active workspace changes.',
      steps: [{ id: 'create', tool: 'molecule_create_from_template', input: { template: 'water' } }],
    })
    useAgentModelingTaskStore.getState().loadPlan(recoveryGuardPlan)
    await useAgentModelingTaskStore.getState().startTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'review')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'drifted', element: 'N', position: [0, 0, 0] }],
    })
    await useAgentModelingTaskStore.getState().resumeTask()
    assertEqual(useAgentModelingTaskStore.getState().status, 'blocked')
    assertTrue(useAgentModelingTaskStore.getState().message?.includes('active workspace changed') === true)
    assertEqual(readActiveViewportStructure()?.atoms[0]?.id, 'drifted')
  } finally {
    activeViewportToolContext.focusInspectionTarget = originalFocus
    activeViewportToolContext.captureViewport = originalCapture
    useAgentModelingTaskStore.getState().clearTask()
  }
}

void testCandidateAndVisualReviewTask().then(() => {
  console.log('agent modeling task tests passed')
})
