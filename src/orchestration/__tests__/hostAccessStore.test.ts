import { describe, expect, it } from 'vitest'

import { summarizeToolArgs } from '../hostAccessStore'

describe('host activity argument summaries', () => {
  it('keeps useful scalar context without logging file, sequence, or payload contents', () => {
    const summary = summarizeToolArgs({
      domain: 'provider',
      reason: 'Prepare the selected protein for a remote estimate',
      path: '/private/project/secret.cif',
      sequence: 'MKWVTFISLLLLFSSAYSRGVFRR',
      text: 'full structure payload',
      apiKey: 'secret-token',
      count: 12,
    })

    expect(summary).toContain('domain=provider')
    expect(summary).toContain('reason=Prepare the selected pro…')
    expect(summary).toContain('path=<27 chars>')
    expect(summary).toContain('sequence=<24 chars>')
    expect(summary).toContain('text=<22 chars>')
    expect(summary).toContain('apiKey=<12 chars>')
    expect(summary).toContain('count=12')
    expect(summary).not.toContain('secret.cif')
    expect(summary).not.toContain('MKWVTF')
    expect(summary).not.toContain('secret-token')
  })
})
