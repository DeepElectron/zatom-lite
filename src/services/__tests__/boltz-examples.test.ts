/**
 * Guard tests for built-in example definitions.
 *
 * Protect properties that can silently turn examples into misleading demonstrations: pipeline
 * coverage, real negative controls, and residue positions aligned with sequences.
 */

import { describe, expect, it } from 'vitest'
import { BOLTZ_EXAMPLES } from '../boltz-examples'
import { PIPELINES } from '../boltz-pipelines'

describe('示例案例定义', () => {
  it('七条管线各有且只有一个案例', () => {
    const covered = BOLTZ_EXAMPLES.map((example) => example.pipelineId).sort()
    const all = PIPELINES.map((pipeline) => pipeline.id).sort()
    expect(covered).toEqual(all)
  })

  it('每个案例都有可证伪的预期，而不是"看起来合理"', () => {
    for (const example of BOLTZ_EXAMPLES) {
      // Expectations must define failure so users can judge the result.
      expect(example.expectation.length).toBeGreaterThan(40)
      expect(example.question.length).toBeGreaterThan(10)
      expect(example.provenance.length).toBeGreaterThan(10)
    }
  })

  it('ABL1 筛选库里既有已知抑制剂也有阴性对照', () => {
    const screen = BOLTZ_EXAMPLES.find((example) => example.id === 'abl1-tki-screen')
    expect(screen).toBeDefined()
    const rows = (screen!.form.library ?? '').split('\n').filter((row) => row.trim().length > 0)
    // Six real TKIs plus four unrelated drugs make the case falsifiable.
    expect(rows).toHaveLength(10)
    // Duplicate SMILES would contaminate ranking evidence with ties for the same molecule.
    expect(new Set(rows.map((row) => row.trim())).size).toBe(10)
  })

  it('表位/口袋残基号都落在对应序列长度内', () => {
    for (const example of BOLTZ_EXAMPLES) {
      const sequence = example.form.sequence
      const residueText = example.form.epitope ?? example.form.redesignResidues
      if (sequence === undefined || residueText === undefined) continue
      const positions = residueText
        .split(/[,\s]+/)
        .flatMap((part) => {
          const range = part.match(/^(\d+)-(\d+)$/)
          if (range) {
            const from = Number(range[1])
            const to = Number(range[2])
            return Array.from({ length: to - from + 1 }, (_, index) => from + index)
          }
          return part.trim() === '' ? [] : [Number(part)]
        })
        .filter((value) => Number.isFinite(value))
      for (const position of positions) {
        // One-based positions must remain within the submitted sequence.
        expect(position).toBeGreaterThanOrEqual(1)
        expect(position).toBeLessThanOrEqual(sequence.replace(/\s/g, '').length)
      }
    }
  })

  it('蛋白筛选库的候选都是合法氨基酸序列', () => {
    const screen = BOLTZ_EXAMPLES.find((example) => example.id === 'pdl1-candidate-screen')
    expect(screen).toBeDefined()
    const rows = (screen!.form.library ?? '').split('\n').filter((row) => row.trim().length > 0)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const row of rows) {
      // Mixing SMILES or DNA into the library will silently produce meaningless results in protein screening.
      expect(row.trim()).toMatch(/^[ACDEFGHIKLMNPQRSTVWY]+$/)
    }
  })
})
