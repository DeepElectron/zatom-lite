// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'

import { readBoltzApiKey, writeBoltzApiKey } from '../services/boltz-client'

describe('Boltz API key storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps a key only for the current browser tab', () => {
    writeBoltzApiKey('  sk_bc_private  ')

    expect(readBoltzApiKey()).toBe('sk_bc_private')
    expect(window.sessionStorage.getItem('zatom.boltz.apiKey')).toBe('sk_bc_private')
    expect(window.localStorage.getItem('zatom.boltz.apiKey')).toBeNull()
  })

  it('removes the session key when the field is cleared', () => {
    window.sessionStorage.setItem('zatom.boltz.apiKey', 'sk_bc_private')

    writeBoltzApiKey('   ')

    expect(window.sessionStorage.getItem('zatom.boltz.apiKey')).toBeNull()
  })
})
