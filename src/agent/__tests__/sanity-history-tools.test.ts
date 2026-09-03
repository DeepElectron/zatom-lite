/**
 * structure_check_sanity + workspace_history/undo/redo.
 *
 * - Sanity: a CO placed correctly on Cu(111) passes; the same CO pushed 1 Å
 *   into the surface is flagged as an overlap with an inspection target on
 *   the offending pair; a CO floated 6 Å up is flagged as no host contact.
 * - History: an agent write through the live store is undoable and redoable
 *   via the tool surface, and the fingerprint round-trips exactly.
 */

import assert from 'node:assert/strict'
import { cu111SlabWithCO } from './fixtures/cu111-co'
import { STRUCTURE_VALIDATE_ZATOM_AGENT_TOOLS, WORKSPACE_ZATOM_AGENT_TOOLS } from '../workspace-structure-tools'
import { activeViewportToolContext, readActiveViewportStructure, writeActiveViewportStructure } from '../viewer-context'
import { fingerprintStructure } from '../structure-math'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure, type ZatomToolContext, type Vec3 } from '../contracts'
import type { SanityReport } from '../../lib/scene-grid/sanity'
import { resolveSurfaceNormal } from '../../lib/scene-grid/system-semantics'

const tool = (name: string) =>
  [...STRUCTURE_VALIDATE_ZATOM_AGENT_TOOLS, ...WORKSPACE_ZATOM_AGENT_TOOLS].find((t) => t.manifest.name === name)!

const headless: ZatomToolContext = {}

const shiftAdsorbate = (structure: ZatomStructure, delta: Vec3): ZatomStructure => ({
  ...structure,
  atoms: structure.atoms.map((atom) => (atom.element === 'Cu'
    ? atom
    : { ...atom, position: [atom.position[0] + delta[0], atom.position[1] + delta[1], atom.position[2] + delta[2]] as Vec3 })),
})

async function main() {
  const { structure } = cu111SlabWithCO()
  const normal = resolveSurfaceNormal(structure)!.normal

  // 1. Correct placement passes.
  {
    const r = await tool('structure_check_sanity').execute({ structure }, headless)
    assert.ok(r.ok, r.summary)
    const report = r.data as SanityReport
    assert.equal(report.status, 'pass', `expected pass, got ${report.status}: ${r.summary}`)
    assert.equal(report.complete, true)
    assert.equal(report.budgetExhausted, false)
    assert.equal(report.adsorbateContacts.length, 1, 'one adsorbate fragment (CO)')
    assert.ok(report.adsorbateContacts[0].nearest, 'CO touches the host')
    console.log('sanity/pass ok:', r.summary)
  }

  // 2. CO pushed 1 Å into the surface → overlap, fail, inspection target.
  {
    const buried = shiftAdsorbate(structure, normal.map((x) => -1.0 * x) as Vec3)
    const r = await tool('structure_check_sanity').execute({ structure: buried }, headless)
    assert.ok(r.ok, r.summary)
    const report = r.data as SanityReport
    assert.equal(report.status, 'fail', `expected fail, got ${report.status}: ${r.summary}`)
    const overlap = report.checks.find((c) => c.id === 'sanity.overlap' && c.status === 'fail')
    assert.ok(overlap, `overlap check missing: ${report.checks.map((c) => c.id).join(',')}`)
    assert.ok(report.inspectionTargets.length >= 1, 'inspection target for the bad pair')
    console.log('sanity/overlap ok:', r.summary)
  }

  // 3. CO lifted 3 Å → no host contact (a larger lift would reach the periodic
  //    image of the slab through the ~11 Å vacuum, which is a real contact).
  {
    const floating = shiftAdsorbate(structure, normal.map((x) => 3 * x) as Vec3)
    const r = await tool('structure_check_sanity').execute({ structure: floating }, headless)
    assert.ok(r.ok, r.summary)
    const report = r.data as SanityReport
    assert.notEqual(report.status, 'pass')
    const contact = report.checks.find((c) => c.id === 'sanity.adsorbate_contact' && c.status !== 'pass')
    assert.ok(contact, `contact check missing: ${report.checks.map((c) => `${c.id}:${c.status}`).join(',')}`)
    console.log('sanity/floating ok:', r.summary)
  }

  // 4. A pair budget that stops immediately before a hidden overlap is
  //    explicitly incomplete. It must never claim that the scanned subset
  //    proves the whole structure has no problems.
  {
    const hiddenOverlap: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        { id: 'focus', element: 'C', position: [0, 0, 0] },
        { id: 'safe-first', element: 'C', position: [10, 0, 0] },
        { id: 'overlap-after-budget', element: 'C', position: [0.1, 0, 0] },
      ],
    }
    const r = await tool('structure_check_sanity').execute({
      structure: hiddenOverlap,
      focusAtomIds: ['focus'],
      maxPairs: 1,
    }, headless)
    assert.ok(r.ok, r.summary)
    const report = r.data as SanityReport
    assert.equal(report.status, 'fail', 'the complete shared health audit still finds the hidden overlap')
    assert.equal(report.complete, false)
    assert.equal(report.scannedPairs, 1, 'only evaluated pairs count as scanned')
    assert.equal(report.maxPairs, 1)
    assert.equal(report.budgetExhausted, true)
    assert.match(r.summary, /incomplete/i)
    assert.doesNotMatch(r.summary, /no problems/i)
    const coverage = report.checks.find((check) => check.id === 'sanity.pair_scan_coverage')
    assert.equal(coverage?.status, 'warn')
    assert.equal(coverage?.metrics?.complete, false)
    assert.equal(coverage?.metrics?.budgetExhausted, true)
    assert.ok(report.checks.some((check) => check.id === 'structure.minimum_distance' && check.status === 'fail'))
    assert.ok(
      report.checks
        .filter((check) => check.id === 'sanity.overlap' || check.id === 'sanity.too_close')
        .every((check) => check.status !== 'pass' && !/^No .+ pairs?$/.test(check.message)),
      'partial negative findings must not be presented as complete passes',
    )

    const exactBoundary = await tool('structure_check_sanity').execute({
      structure: hiddenOverlap,
      focusAtomIds: ['focus'],
      maxPairs: 2,
    }, headless)
    assert.ok(exactBoundary.ok, exactBoundary.summary)
    const exactReport = exactBoundary.data as SanityReport
    assert.equal(exactReport.complete, true, 'using exactly the full pair count is complete')
    assert.equal(exactReport.scannedPairs, 2)
    assert.equal(exactReport.budgetExhausted, false)
    assert.equal(exactReport.status, 'fail', 'the pair at the exact budget boundary is inspected')
    assert.ok(exactReport.checks.some((check) => check.id === 'sanity.overlap' && check.status === 'fail'))
    console.log('sanity/budget boundary ok:', r.summary)
  }

  // 5. Even when the caller deliberately gives the chemistry focus scan a
  //    one-pair budget, the shared automatic health audit still catches a late
  //    overlap in a structure above the old 2,000-atom skip threshold.
  {
    const atoms = Array.from({ length: 2_100 }, (_, index) => ({
      id: `safe-${index}`,
      element: 'C',
      position: [index * 2, 0, 0] as Vec3,
    }))
    atoms.push({ id: 'late-overlap', element: 'C', position: [0.1, 0, 0] })
    const r = await tool('structure_check_sanity').execute({
      structure: { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms },
      focusAtomIds: ['safe-0'],
      maxPairs: 1,
    }, headless)
    assert.ok(r.ok, r.summary)
    const report = r.data as SanityReport & {
      health: { verdict: string }
    }
    assert.equal(report.complete, false, 'the caller-bounded chemistry scan remains explicitly partial')
    assert.equal(report.status, 'fail', `automatic structural health must dominate the partial scan: ${r.summary}`)
    assert.equal(report.health.verdict, 'fail')
    const minimum = report.checks.find((check) => check.id === 'structure.minimum_distance')
    assert.equal(minimum?.status, 'fail')
    assert.equal(minimum?.metrics?.coverageComplete, true)
    assert.deepEqual(minimum?.atomIds, ['safe-0', 'late-overlap'])
    assert.match(r.summary, /0\.1000/)
    console.log('sanity/large late overlap ok:', r.summary)
  }

  // 6. Headless host has no history.
  {
    const r = await tool('workspace_undo').execute({}, headless)
    assert.equal(r.ok, false)
    assert.equal(r.error?.code, 'history_unavailable')
  }

  // 7. Live store: write A, write B, undo → A, redo → B.
  {
    const ctx = activeViewportToolContext
    const a = structure
    const b = shiftAdsorbate(structure, normal.map((x) => 0.3 * x) as Vec3)
    await writeActiveViewportStructure(a)
    await writeActiveViewportStructure(b)
    const fpA = fingerprintStructure(a)
    const fpB = fingerprintStructure(b)
    assert.equal(fingerprintStructure(readActiveViewportStructure()!), fpB)

    const h0 = await tool('workspace_history').execute({}, ctx)
    assert.ok(h0.ok, h0.summary)
    assert.ok((h0.data as { canUndo: boolean }).canUndo, 'can undo after two writes')

    const u = await tool('workspace_undo').execute({}, ctx)
    assert.ok(u.ok, u.summary)
    assert.equal(fingerprintStructure(readActiveViewportStructure()!), fpA, 'undo restores A')
    assert.equal((u.data as { structureFingerprint: string }).structureFingerprint, fpA)

    const rd = await tool('workspace_redo').execute({}, ctx)
    assert.ok(rd.ok, rd.summary)
    assert.equal(fingerprintStructure(readActiveViewportStructure()!), fpB, 'redo restores B')

    const nothing = await tool('workspace_redo').execute({}, ctx)
    assert.equal(nothing.ok, false)
    assert.equal(nothing.error?.code, 'nothing_to_redo')
    console.log('history ok:', u.summary, '|', rd.summary)
  }

  console.log('sanity-history-tools: all assertions passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
