/**
 * Regressions reproduced while acceptance-testing the agent against an unseen
 * Cu(111) slab carrying an adsorbed CO and a surface vacancy. Each test pins a
 * capability the spec relies on and that was previously broken.
 */

import { describe, expect, it } from 'vitest'

import type { ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { fingerprintStructure } from '../structure-math'
import { detectAdsorptionSites } from '../surface'

/** 2x2 Cu(100)-like slab, 2 layers, with a CO standing on one top atom. */
function slabWithCO(): ZatomStructure {
  const atoms: ZatomStructure['atoms'] = []
  const a = 2.55
  for (let layer = 0; layer < 2; layer += 1) {
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) {
      atoms.push({ id: `cu-${layer}-${i}${j}`, element: 'Cu', position: [i * a + (layer % 2) * a / 2, j * a + (layer % 2) * a / 2, layer * 1.8] })
    }
  }
  atoms.push({ id: 'c', element: 'C', position: [0, 0, 1.8 + 1.85] })
  atoms.push({ id: 'o', element: 'O', position: [0, 0, 1.8 + 1.85 + 1.15] })
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'slab+CO',
    lattice: { vectors: [[2 * a, 0, 0], [0, 2 * a, 0], [0, 0, 20]], periodic: [true, true, false] },
    atoms,
  }
}

describe('unknown-system acceptance regressions', () => {
  it('detects the metal surface layer under an adsorbate instead of treating the adsorbate as the surface', () => {
    const detected = detectAdsorptionSites({ structure: slabWithCO(), surfaceUp: [0, 0, 1] })
    // Before: surfaceAtomIds = ['o'] and a single "top" site above the oxygen.
    expect(detected.surfaceAtomIds.sort()).toEqual(['cu-1-00', 'cu-1-01', 'cu-1-10', 'cu-1-11'])
    expect(detected.sites.filter((s) => s.kind === 'top')).toHaveLength(4)
    expect(detected.sites.some((s) => s.kind === 'bridge')).toBe(true)
  })

  it('resolves "the atoms around the vacancy" from a point anchor', async () => {
    const structure = slabWithCO()
    // Remove one surface atom; its former position is the vacancy.
    const vacancy = structure.atoms.find((a) => a.id === 'cu-1-11')!.position
    structure.atoms = structure.atoms.filter((a) => a.id !== 'cu-1-11')

    const result = await callZatomMcpTool('scene_resolve_reference', {
      structure,
      relation: 'nearest',
      anchorPoint: vacancy,
      elements: ['Cu'],
      limit: 4,
    })
    expect(result.structuredContent.ok).toBe(true)
    const data = result.structuredContent.data as { candidates: { atomId: string }[]; anchorPoint?: number[]; ambiguity: number }
    expect(data.anchorPoint).toEqual(vacancy)
    expect(data.candidates.length).toBeGreaterThan(0)
    expect(data.candidates.every((m) => m.atomId.startsWith('cu-'))).toBe(true)
    // A vacancy is surrounded symmetrically: the tool must say so, not pick one.
    expect(data.ambiguity).toBeGreaterThan(0.5)

    const bonded = await callZatomMcpTool('scene_resolve_reference', { structure, relation: 'bonded_to', anchorPoint: vacancy })
    const bondedData = bonded.structuredContent.data as { candidates: unknown[]; note: string | null }
    expect(bondedData.candidates).toHaveLength(0)
    expect(bondedData.note).toMatch(/point anchor/)
  })

  it('refuses structure_apply_operations against a stale active-structure fingerprint', async () => {
    let active = slabWithCO()
    let writes = 0
    const context: ZatomToolContext = {
      readStructure: () => structuredClone(active),
      writeStructure: (s) => { writes += 1; active = structuredClone(s) },
    }
    const seen = fingerprintStructure(active)
    // The user (or another tool) edits the structure behind the agent's back.
    active = { ...active, atoms: active.atoms.filter((a) => a.id !== 'o') }

    const stale = await callZatomMcpTool('structure_apply_operations', {
      operations: [{ op: 'vacancy', selection: { atomIds: ['cu-1-00'] } }],
      applyToWorkspace: true,
      expectedFingerprint: seen,
    }, context)
    expect(stale.structuredContent.error?.code).toBe('stale_fingerprint')
    expect(writes).toBe(0)

    const fresh = await callZatomMcpTool('structure_apply_operations', {
      operations: [{ op: 'vacancy', selection: { atomIds: ['cu-1-00'] } }],
      applyToWorkspace: true,
      expectedFingerprint: fingerprintStructure(active),
    }, context)
    expect(fresh.structuredContent.ok).toBe(true)
    expect(writes).toBe(1)
  })

  it('cuts an fcc(111) slab with c along the surface normal and the requested vacuum', async () => {
    // Previously c followed the oblique stacking translation, so the (111) cell
    // had β=135°, only 7.9 Å of normal vacuum for a requested 10 Å, and was
    // flagged fully periodic; site detection on it then found nothing useful.
    const a = 3.615
    const fcc: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'Cu fcc',
      lattice: { vectors: [[a, 0, 0], [0, a, 0], [0, 0, a]], periodic: [true, true, true] },
      atoms: [[0, 0, 0], [0, a / 2, a / 2], [a / 2, 0, a / 2], [a / 2, a / 2, 0]]
        .map((p, i) => ({ id: `cu${i}`, element: 'Cu', position: p as [number, number, number] })),
    }
    const built = await callZatomMcpTool('structure_build_miller_slab', { structure: fcc, miller: [1, 1, 1], layers: 4, vacuumA: 10 })
    const data = built.structuredContent.data as { result: { structure: ZatomStructure; checks: { id: string; status: string }[]; metrics: { measuredVacuumA: number } } }
    expect(built.structuredContent.ok).toBe(true)
    expect(data.result.checks.find((c) => c.id === 'slab.vacuum')?.status).toBe('pass')
    expect(data.result.metrics.measuredVacuumA).toBeCloseTo(10, 3)

    const slab = data.result.structure
    expect(slab.lattice?.periodic).toEqual([true, true, false])
    const [av, bv, cv] = slab.lattice!.vectors
    const dotv = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    expect(Math.abs(dotv(av, cv))).toBeLessThan(1e-6)
    expect(Math.abs(dotv(bv, cv))).toBeLessThan(1e-6)
    // |c| = 3 interplanar spacings (4 layers) + vacuum, d111 = a/√3.
    expect(Math.hypot(...cv)).toBeCloseTo(3 * a / Math.sqrt(3) + 10, 3)
    // Primitive (111) surface cell: |a| = |b| = a/√2 at 60°, one atom per layer.
    expect(Math.hypot(...av)).toBeCloseTo(a / Math.SQRT2, 3)
    expect(Math.hypot(...bv)).toBeCloseTo(a / Math.SQRT2, 3)
    expect(Math.abs(dotv(av, bv)) / (a * a / 2)).toBeCloseTo(0.5, 3)
    expect(slab.atoms).toHaveLength(4)

    const sites = await callZatomMcpTool('surface_detect_adsorption_sites', { structure: slab })
    const siteData = sites.structuredContent.data as { sites: { kind: string }[]; surfaceAtomIds: string[] }
    expect(siteData.surfaceAtomIds).toHaveLength(1)
    expect(new Set(siteData.sites.map((s) => s.kind))).toEqual(new Set(['top', 'bridge', 'hollow']))

    // fcc(100): "layers" counts atomic planes (a/2 apart), not conventional cells.
    const built100 = await callZatomMcpTool('structure_build_miller_slab', { structure: fcc, miller: [1, 0, 0], layers: 4, vacuumA: 10 })
    const slab100 = (built100.structuredContent.data as { result: { structure: ZatomStructure } }).result.structure
    expect(slab100.atoms).toHaveLength(4)
    expect(Math.hypot(...slab100.lattice!.vectors[2])).toBeCloseTo(3 * a / 2 + 10, 3)
  })
})
