// End-to-end "butler" loop through the real in-page tool context:
// observe → plan → annotate → look at → propose → user decides.
// Runs headless (no WebGL): the camera surface resolves the flight synchronously
// when no controller consumes the target, which is exactly the fallback path.
import assert from 'node:assert/strict'
import { BUILTIN_ZATOM_AGENT_TOOLS } from '../tools'
import { fingerprintStructure } from '../structure-math'
import {
  activeViewportToolContext,
  applyPendingProposal,
  clearActiveViewportWorkspace,
  discardPendingProposal,
  readActiveViewportStructure,
} from '../viewer-context'
import { useAgentGuidance } from '../../orchestration/agentGuidanceStore'
import { useAgentProposalStore } from '../../orchestration/agentProposalStore'
import { selectPendingReview, useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import type { ZatomStructure } from '../contracts'

const tool = (name: string) => {
  const found = BUILTIN_ZATOM_AGENT_TOOLS.find((t) => t.manifest.name === name)
  assert.ok(found, `tool ${name} registered`)
  return found
}

const water: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'water',
  atoms: [
    { id: 'O1', element: 'O', position: [0, 0, 0.117] },
    { id: 'H1', element: 'H', position: [0, 0.757, -0.469] },
    { id: 'H2', element: 'H', position: [0, -0.757, -0.469] },
  ],
}

async function keepReviewedOperation(timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (selectPendingReview(useAgentOperationReview.getState())) {
      useAgentOperationReview.getState().dismissReview()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for the Agent operation review')
}

async function run() {
  await clearActiveViewportWorkspace()
  useAgentProposalStore.setState({ current: null, history: [] })
  const ctx = activeViewportToolContext

  const domains = await tool('zatom_domains').execute({}, {
    ...ctx,
    domains: { enabledDomains: () => ['session'], enableDomains: () => undefined },
  } as unknown as typeof ctx)
  assert.ok(domains.ok, JSON.stringify(domains))
  assert.ok(Array.isArray((domains.data as { workflow: string[] }).workflow), 'zatom_domains returns the workflow')

  const set = await tool('workspace_set_active_structure').execute({ structure: water }, ctx)
  assert.ok(set.ok, JSON.stringify(set))
  const fingerprint = (set.data as { fingerprint: string }).fingerprint
  // The workspace animates the build in; wait until the readback matches the
  // committed fingerprint, then take ids from it as the workflow instructs.
  let live = readActiveViewportStructure()
  for (let i = 0; i < 100 && (!live || fingerprintStructure(live) !== fingerprint); i += 1) {
    await new Promise((r) => setTimeout(r, 50))
    live = readActiveViewportStructure()
  }
  assert.ok(live)
  await keepReviewedOperation()
  const oxygen = live.atoms.find((a) => a.element === 'O')!.id

  const plan = await tool('guide_set_plan').execute({ steps: ['Inspect', 'Swap O for S', 'Verify'], activeIndex: 1, caption: 'Swapping' }, ctx)
  assert.ok(plan.ok)
  assert.equal(useAgentGuidance.getState().plan?.steps[1].status, 'active')

  const ann = await tool('guide_annotate').execute({ annotations: [{ atomIds: [oxygen], label: 'target', kind: 'target' }] }, ctx)
  assert.ok(ann.ok, JSON.stringify(ann))
  assert.equal(useAgentGuidance.getState().annotations.length, 1)

  const look = await tool('viewer_look_at').execute({ target: { atomIds: [oxygen] }, view: 'top', durationMs: 10 }, ctx)
  assert.ok(look.ok, JSON.stringify(look))
  const flight = look.data as { direction: [number, number, number]; atomIds: string[] }
  assert.deepEqual(flight.atomIds, [oxygen])
  assert.ok(Math.abs(flight.direction[2] - 1) < 1e-6, 'top = eye on +Z, matching scene_grid')

  const propose = await tool('structure_propose_operations').execute({
    intent: 'Replace O with S',
    expectedFingerprint: fingerprint,
    operations: [{ op: 'substitute', selection: { atomIds: [oxygen] }, element: 'S' }],
    flyTo: false,
  }, ctx)
  assert.ok(propose.ok, JSON.stringify(propose))
  const proposalId = (propose.data as { proposalId: string }).proposalId
  assert.equal(useAgentProposalStore.getState().current?.status, 'pending')
  assert.equal(readActiveViewportStructure()?.atoms.find((a) => a.id === oxygen)?.element, 'O', 'workspace untouched while pending')

  const stale = await tool('structure_propose_operations').execute({
    intent: 'stale', expectedFingerprint: 'nope',
    operations: [{ op: 'substitute', selection: { atomIds: [oxygen] }, element: 'N' }],
  }, ctx)
  assert.equal(stale.ok, false, 'stale fingerprint fails closed')
  assert.equal(useAgentProposalStore.getState().current?.id, proposalId, 'failed proposal does not supersede')

  const applied = await applyPendingProposal()
  assert.ok(applied.ok, JSON.stringify(applied))
  const status = await tool('structure_proposal_status').execute({ proposalId }, ctx)
  assert.equal((status.data as { status: string }).status, 'applied')
  assert.equal(readActiveViewportStructure()?.atoms.find((a) => a.id === oxygen)?.element, 'S', 'Apply wrote the candidate')
  await keepReviewedOperation()

  const again = await tool('structure_propose_operations').execute({
    intent: 'Back to O',
    operations: [{ op: 'substitute', selection: { atomIds: [oxygen] }, element: 'O' }],
    flyTo: false,
  }, ctx)
  assert.ok(again.ok)
  discardPendingProposal()
  assert.equal(useAgentProposalStore.getState().current?.status, 'discarded')
  assert.equal(readActiveViewportStructure()?.atoms.find((a) => a.id === oxygen)?.element, 'S', 'Discard leaves workspace alone')

  const cleared = await tool('guide_clear').execute({}, ctx)
  assert.ok(cleared.ok)
  assert.equal(useAgentGuidance.getState().plan, null)
  assert.equal(useAgentGuidance.getState().annotations.length, 0)

  console.log('agent collaboration-loop tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
