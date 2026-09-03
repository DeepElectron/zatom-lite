/** Shared candidate-first workspace application gate for structure-producing tools. */

import {
  ZATOM_STRUCTURE_SCHEMA,
} from './contracts'
import type {
  CapturedImage,
  ProposalSnapshot,
  StructureChangeSet,
  ValidationCheck,
  ZatomStructure,
  ZatomTrajectory,
  ZatomToolContext,
  ZatomToolResult,
} from './contracts'
import { fingerprintStructure } from './structure-math'
import { buildStructureChangeSet } from './operations'
import { fingerprintTrajectory } from './trajectory'
import { ZatomStructureInputError } from './structure-validation'

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Tool execution was cancelled')
}

function sameWorkspaceIdentity(
  left: NonNullable<ZatomToolContext['expectedWorkspace']>,
  right: NonNullable<ZatomToolContext['expectedWorkspace']>,
): boolean {
  return left.viewportId === right.viewportId
    && left.revision === right.revision
    && left.structureFingerprint === right.structureFingerprint
    && left.trajectoryFingerprint === right.trajectoryFingerprint
}

function assertExpectedWorkspace(
  actual: NonNullable<ZatomToolContext['expectedWorkspace']>,
  expected: NonNullable<ZatomToolContext['expectedWorkspace']>,
): void {
  if (sameWorkspaceIdentity(actual, expected)) return
  throw new Error(
    `The workspace changed from ${expected.viewportId}@r${expected.revision} while computing the candidate; `
    + `the active target is now ${actual.viewportId}@r${actual.revision}. Re-observe and recompute it.`,
  )
}

function cancellationError(signal: AbortSignal | undefined, error: unknown): Error | null {
  if (!signal?.aborted) return null
  return signal.reason instanceof Error
    ? signal.reason
    : error instanceof Error
      ? error
      : new Error('Tool execution was cancelled')
}

export interface StructureCandidate {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  checks: ValidationCheck[]
}

export interface TrajectoryCandidate {
  trajectory: ZatomTrajectory
  checks: ValidationCheck[]
}

export interface CandidateEnvelope<T> {
  result: T
  appliedToWorkspace: boolean
  applicationBlocked: boolean
  /** null when the host cannot re-read; false means write/readback diverged. */
  applicationVerified: boolean | null
  visualEvidence: CapturedImage | null
  /** Pending viewport ghost when a propose-only host asked to apply. */
  proposal: ProposalSnapshot | null
}

/** Apply an already-computed candidate through the same numeric gate used by every tool. */
export async function applyStructureCandidate<T extends StructureCandidate>(options: {
  result: T
  requestedApply: boolean
  captureAfter: boolean
  context: ZatomToolContext
  /** Human-readable action shown on a ghost proposal card. */
  proposalIntent?: string
}): Promise<CandidateEnvelope<T>> {
  throwIfCancelled(options.context.signal)
  const hasFailures = options.result.checks.some((check) => check.status === 'fail')
  // A host without a writer (propose-only / read-only) still gets the candidate:
  // the structure was computed, the caller can hand it to
  // structure_propose_operations or ask the user to raise access. Discarding
  // the work would only make the agent recompute it.
  const hasTrajectory = options.result.trajectory !== undefined
  // A structure + trajectory result is one document replacement. Refuse to
  // start it unless the host exposes the atomic boundary; sequential writers
  // can leave a new structure behind when the second write is cancelled.
  const directWriterAvailable = hasTrajectory
    ? !!options.context.writeWorkspace
    : !!options.context.writeStructure
  const writeDenied = options.requestedApply && !directWriterAvailable
  let proposal: ProposalSnapshot | null = null
  let proposalError: string | null = null
  if (writeDenied && !hasFailures && !hasTrajectory && options.context.proposal
    && options.context.readStructure && options.context.workspaceIdentity) {
    try {
      throwIfCancelled(options.context.signal)
      // Validate both sides of every awaited read. A proposal is a promise
      // about one exact viewport generation, not merely a diff that happened
      // to start from the same atom coordinates.
      const identityBeforeRead = await options.context.workspaceIdentity()
      throwIfCancelled(options.context.signal)
      // WebMCP supplies expectedWorkspace and is therefore pinned to the
      // caller's earlier observation. Direct/internal callers may omit it; in
      // that case this first identity becomes the CAS source for the remainder
      // of the proposal publication sequence.
      const expected = options.context.expectedWorkspace ?? identityBeforeRead
      assertExpectedWorkspace(identityBeforeRead, expected)
      const source = await options.context.readStructure()
      throwIfCancelled(options.context.signal)
      const identity = await options.context.workspaceIdentity()
      throwIfCancelled(options.context.signal)
      assertExpectedWorkspace(identity, expected)
      const sourceFingerprint = source ? fingerprintStructure(source) : null
      if (sourceFingerprint !== identity.structureFingerprint) {
        throw new Error('The active workspace changed while preparing its proposal preview.')
      }
      const sourceForDiff: ZatomStructure = source ?? { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
      const resultWithChangeSet = options.result as T & { changeSet?: StructureChangeSet }
      proposal = await options.context.proposal.propose({
        intent: options.proposalIntent ?? options.result.structure.label ?? 'Review generated structure',
        baseFingerprint: sourceFingerprint,
        viewportId: identity.viewportId,
        workspaceRevision: identity.revision,
        candidate: options.result.structure,
        changeSet: resultWithChangeSet.changeSet
          ?? buildStructureChangeSet(sourceForDiff, options.result.structure),
        checks: options.result.checks,
        inspectionTargets: (options.result as T & { inspectionTargets?: import('./contracts').InspectionTarget[] }).inspectionTargets ?? [],
        signal: options.context.signal,
      })
      throwIfCancelled(options.context.signal)
      const identityAfterProposal = await options.context.workspaceIdentity()
      throwIfCancelled(options.context.signal)
      assertExpectedWorkspace(identityAfterProposal, expected)
      if (proposal.viewportId !== expected.viewportId
        || proposal.workspaceRevision !== expected.revision
        || proposal.baseFingerprint !== expected.structureFingerprint
        || proposal.previewRevision !== 1
        || proposal.candidateFingerprint !== fingerprintStructure(options.result.structure)) {
        throw new Error('The published proposal is not bound to the expected workspace revision.')
      }
    } catch (error) {
      // Once publication returns, every later mismatch/cancellation withdraws
      // the ghost. Leaving a stale decision card visible would let the user
      // approve a candidate that this call has already rejected.
      if (proposal) {
        // Cleanup must not reuse the already-aborted request signal; that
        // signal is why the just-published ghost has to be withdrawn.
        await Promise.resolve(options.context.proposal?.withdraw(proposal.id)).catch(() => null)
        proposal = null
      }
      const cancelled = cancellationError(options.context.signal, error)
      if (cancelled) throw cancelled
      proposalError = error instanceof Error ? error.message : String(error)
    }
  }
  let applicationBlocked = options.requestedApply && (hasFailures || (writeDenied && !proposal))
  let appliedToWorkspace = false
  let applicationVerified: boolean | null = null
  let visualEvidence: CapturedImage | null = null
  const extraChecks: ValidationCheck[] = []
  if (writeDenied) {
    if (proposal) {
      extraChecks.push({
        id: 'candidate.application_gate',
        status: 'pass',
        message: `The host cannot write directly, so candidate ${proposal.id} is ghosted in ${proposal.viewportId}; the user decides Apply or Discard.`,
      })
    } else {
      extraChecks.push({
        id: 'candidate.application_gate',
        status: 'fail',
        message: hasTrajectory
          ? 'Not applied: this result contains a structure and trajectory, but the host does not expose an atomic workspace writer. Nothing was written.'
          : options.context.access
          ? `Not applied: this host is not in read-write mode and no safe viewport proposal could be published${proposalError ? ` (${proposalError})` : ''}. The candidate is returned; ask the user to finish the current decision or raise access in Agent Access.`
          : 'Not applied: this host cannot write structures. The candidate is returned for the caller to use.',
      })
    }
  } else if (applicationBlocked) {
    extraChecks.push({ id: 'candidate.application_gate', status: 'fail', message: 'Workspace application was blocked because the candidate has failing numeric checks' })
  } else if (options.requestedApply) {
    try {
      // Candidate computation can be long and a write may then wait behind an
      // earlier visual review. Re-check the request-owned signal immediately
      // before handing authority to the host, and pass it through so a queued
      // renderer commit cannot outlive its cancelled WebMCP call.
      throwIfCancelled(options.context.signal)
      if (options.result.trajectory) {
        await options.context.writeWorkspace!(
          options.result.structure,
          options.result.trajectory,
          options.context.expectedWorkspace,
          options.context.signal,
        )
        extraChecks.push({
          id: 'candidate.trajectory_handoff',
          status: 'pass',
          message: `Atomically applied ${options.result.trajectory.frames.length} trajectory frames with their structure`,
          metrics: { frameCount: options.result.trajectory.frames.length },
        })
      } else {
        await options.context.writeStructure!(
          options.result.structure,
          options.context.expectedWorkspace,
          options.context.signal,
        )
      }
      appliedToWorkspace = true
      extraChecks.push({ id: 'candidate.application_gate', status: 'pass', message: 'Validated candidate was applied to the active workspace' })
    } catch (error) {
      const cancelled = cancellationError(options.context.signal, error)
      if (cancelled) throw cancelled
      applicationBlocked = true
      extraChecks.push({
        id: 'candidate.workspace_write',
        status: 'fail',
        message: `Host rejected the validated candidate: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  if (appliedToWorkspace) {
    if (options.context.readStructure) {
      try {
        const readback = await options.context.readStructure()
        const expectedFingerprint = fingerprintStructure(options.result.structure)
        const actualFingerprint = readback ? fingerprintStructure(readback) : null
        applicationVerified = actualFingerprint === expectedFingerprint
        extraChecks.push({
          id: 'candidate.readback_identity',
          status: applicationVerified ? 'pass' : 'fail',
          message: applicationVerified
            ? `Re-read workspace fingerprint ${expectedFingerprint} matches the candidate`
            : `Workspace readback fingerprint ${actualFingerprint ?? 'null'} does not match candidate ${expectedFingerprint}`,
          metrics: {
            expectedFingerprint,
            actualFingerprint: actualFingerprint ?? 'null',
            expectedAtomCount: options.result.structure.atoms.length,
            actualAtomCount: readback?.atoms.length ?? 0,
          },
        })
      } catch (error) {
        applicationVerified = false
        extraChecks.push({
          id: 'candidate.readback_identity',
          status: 'fail',
          message: `Candidate was written but workspace readback failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    } else {
      extraChecks.push({
        id: 'candidate.readback_identity',
        status: 'warn',
        message: 'Candidate was written, but the host did not provide structure readback for identity verification',
      })
    }
    if (options.result.trajectory) {
      if (options.context.readTrajectory && options.context.writeTrajectory) {
        try {
          const readback = await options.context.readTrajectory()
          const expectedFingerprint = fingerprintTrajectory(options.result.trajectory)
          const actualFingerprint = readback ? fingerprintTrajectory(readback) : null
          const matches = actualFingerprint === expectedFingerprint
          if (!matches) applicationVerified = false
          extraChecks.push({
            id: 'candidate.trajectory_readback_identity',
            status: matches ? 'pass' : 'fail',
            message: matches
              ? `Re-read trajectory fingerprint ${expectedFingerprint} matches the candidate`
              : `Trajectory readback fingerprint ${actualFingerprint ?? 'null'} does not match candidate ${expectedFingerprint}`,
            metrics: { expectedFingerprint, actualFingerprint: actualFingerprint ?? 'null' },
          })
        } catch (error) {
          applicationVerified = false
          extraChecks.push({
            id: 'candidate.trajectory_readback_identity',
            status: 'fail',
            message: `Trajectory was written but readback failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      } else if (options.context.writeTrajectory) {
        extraChecks.push({
          id: 'candidate.trajectory_readback_identity',
          status: 'warn',
          message: 'Trajectory was written, but the host did not provide trajectory readback for fingerprint verification',
        })
      }
    }
  }
  if (options.captureAfter) {
    if (appliedToWorkspace && applicationVerified === true && options.context.captureViewport) {
      visualEvidence = await options.context.captureViewport({ maxDim: 768, format: 'jpeg' })
      if (visualEvidence) {
        const structureReadback = await options.context.readStructure?.()
        const structureMatches = !!structureReadback
          && fingerprintStructure(structureReadback) === fingerprintStructure(options.result.structure)
        const trajectoryReadback = options.result.trajectory ? await options.context.readTrajectory?.() : null
        const trajectoryMatches = !options.result.trajectory || (!!trajectoryReadback
          && fingerprintTrajectory(trajectoryReadback) === fingerprintTrajectory(options.result.trajectory))
        if (!structureMatches || !trajectoryMatches) {
          visualEvidence = null
          applicationVerified = false
          extraChecks.push({
            id: 'visual.capture_identity',
            status: 'fail',
            message: 'Workspace identity changed while capturing visual evidence; discarded the image',
          })
        }
      }
      extraChecks.push({
        id: 'visual.viewport_capture',
        status: visualEvidence ? 'pass' : 'warn',
        message: visualEvidence
          ? `Captured ${visualEvidence.width}×${visualEvidence.height} visual evidence`
          : 'Candidate was applied, but the viewport did not produce image evidence',
      })
    } else if (!appliedToWorkspace) {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'skipped', message: 'Visual capture requires applying the candidate to the active workspace' })
    } else if (applicationVerified !== true) {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'skipped', message: 'Visual capture requires fingerprint-verified workspace readback' })
    } else {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'warn', message: 'Host did not provide viewport capture' })
    }
  }
  const checks = [...options.result.checks, ...extraChecks]
  const result = { ...options.result, checks }
  return { result, appliedToWorkspace, applicationBlocked, applicationVerified, visualEvidence, proposal }
}

/** Apply a trajectory-only candidate through numeric gates and fingerprint readback. */
export async function applyTrajectoryCandidate<T extends TrajectoryCandidate>(options: {
  result: T
  requestedApply: boolean
  captureAfter: boolean
  context: ZatomToolContext
}): Promise<CandidateEnvelope<T>> {
  throwIfCancelled(options.context.signal)
  if (options.requestedApply && !options.context.writeTrajectory) {
    throw new ZatomStructureInputError('write_unavailable', 'Applying this candidate requires trajectory writing')
  }
  const hasFailures = options.result.checks.some((check) => check.status === 'fail')
  let applicationBlocked = options.requestedApply && hasFailures
  let appliedToWorkspace = false
  let applicationVerified: boolean | null = null
  let visualEvidence: CapturedImage | null = null
  const extraChecks: ValidationCheck[] = []
  if (applicationBlocked) {
    extraChecks.push({
      id: 'trajectory_stitch.application_gate',
      status: 'fail',
      message: 'Workspace application was blocked because the trajectory candidate has failing numeric checks',
    })
  } else if (options.requestedApply) {
    try {
      throwIfCancelled(options.context.signal)
      await options.context.writeTrajectory!(
        options.result.trajectory,
        options.context.expectedWorkspace,
        options.context.signal,
      )
      appliedToWorkspace = true
      extraChecks.push({
        id: 'trajectory_stitch.application_gate',
        status: 'pass',
        message: `Applied ${options.result.trajectory.frames.length} trajectory frames to the active workspace`,
        metrics: { frameCount: options.result.trajectory.frames.length },
      })
    } catch (error) {
      const cancelled = cancellationError(options.context.signal, error)
      if (cancelled) throw cancelled
      applicationBlocked = true
      extraChecks.push({
        id: 'trajectory_stitch.workspace_write',
        status: 'fail',
        message: `Host rejected the validated trajectory: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  if (appliedToWorkspace) {
    if (options.context.readTrajectory) {
      try {
        const readback = await options.context.readTrajectory()
        const expectedFingerprint = fingerprintTrajectory(options.result.trajectory)
        const actualFingerprint = readback ? fingerprintTrajectory(readback) : null
        applicationVerified = actualFingerprint === expectedFingerprint
        extraChecks.push({
          id: 'trajectory_stitch.readback_identity',
          status: applicationVerified ? 'pass' : 'fail',
          message: applicationVerified
            ? `Re-read trajectory fingerprint ${expectedFingerprint} matches the candidate`
            : `Trajectory readback fingerprint ${actualFingerprint ?? 'null'} does not match candidate ${expectedFingerprint}`,
          metrics: { expectedFingerprint, actualFingerprint: actualFingerprint ?? 'null' },
        })
      } catch (error) {
        applicationVerified = false
        extraChecks.push({
          id: 'trajectory_stitch.readback_identity',
          status: 'fail',
          message: `Trajectory was written but readback failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    } else {
      extraChecks.push({
        id: 'trajectory_stitch.readback_identity',
        status: 'warn',
        message: 'Trajectory was written, but the host did not provide trajectory readback for identity verification',
      })
    }
  }
  if (options.captureAfter) {
    if (appliedToWorkspace && applicationVerified === true && options.context.captureViewport) {
      visualEvidence = await options.context.captureViewport({ maxDim: 768, format: 'jpeg' })
      if (visualEvidence) {
        const readback = await options.context.readTrajectory?.()
        if (!readback || fingerprintTrajectory(readback) !== fingerprintTrajectory(options.result.trajectory)) {
          visualEvidence = null
          applicationVerified = false
          extraChecks.push({
            id: 'visual.capture_identity',
            status: 'fail',
            message: 'Trajectory identity changed while capturing visual evidence; discarded the image',
          })
        }
      }
      extraChecks.push({
        id: 'visual.viewport_capture',
        status: visualEvidence ? 'pass' : 'warn',
        message: visualEvidence
          ? `Captured ${visualEvidence.width}×${visualEvidence.height} visual evidence`
          : 'Trajectory was applied, but the viewport did not produce image evidence',
      })
    } else if (!appliedToWorkspace) {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'skipped', message: 'Visual capture requires applying the trajectory candidate' })
    } else if (applicationVerified !== true) {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'skipped', message: 'Visual capture requires fingerprint-verified trajectory readback' })
    } else {
      extraChecks.push({ id: 'visual.viewport_capture', status: 'warn', message: 'Host did not provide viewport capture' })
    }
  }
  const result = { ...options.result, checks: [...options.result.checks, ...extraChecks] }
  return { result, appliedToWorkspace, applicationBlocked, applicationVerified, visualEvidence, proposal: null }
}

export async function finalizeStructureCandidate<T extends StructureCandidate>(options: {
  tool: string
  result: T
  requestedApply: boolean
  captureAfter: boolean
  context: ZatomToolContext
  /** Human-readable action shown on a ghost proposal card. */
  proposalIntent?: string
  summary: (applied: boolean, blocked: boolean, verified: boolean | null) => string
}): Promise<ZatomToolResult<CandidateEnvelope<T>>> {
  const envelope = await applyStructureCandidate(options)
  // A failed check is the one thing the caller must not miss, whether or not
  // it asked to apply: surface it in the summary, not only in the check list.
  const failed = envelope.result.checks.filter((check) => check.status === 'fail')
  const failNote = failed.length
    ? `; validation FAILED: ${failed.map((check) => check.message).join(' | ')}`
    : ''
  const proposalNote = envelope.proposal
    ? `; preview ${envelope.proposal.id} is waiting for the user in ${envelope.proposal.viewportId}`
    : ''
  return {
    ok: true,
    tool: options.tool,
    summary: options.summary(envelope.appliedToWorkspace, envelope.applicationBlocked, envelope.applicationVerified) + proposalNote + failNote,
    data: envelope,
    checks: envelope.result.checks,
  }
}
