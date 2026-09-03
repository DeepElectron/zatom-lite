import { describe, expect, it } from 'vitest'

import {
  ZATOM_LEGAL_NOTICE_STORAGE_KEY,
  acknowledgeLegalNotice,
  clearLegalNoticeAcknowledgement,
  readLegalNoticeAcknowledgement,
  requiresLegalNoticeAcknowledgement,
  type LegalNoticeStorage,
} from '../legal-notice-state'

function memoryStorage(initial?: string): LegalNoticeStorage {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(ZATOM_LEGAL_NOTICE_STORAGE_KEY, initial)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('legal notice acknowledgement', () => {
  it('requires acknowledgement for a new or changed notice version', () => {
    const storage = memoryStorage()
    expect(requiresLegalNoticeAcknowledgement(storage, 'v1')).toBe(true)
    expect(acknowledgeLegalNotice(storage, 'v1', new Date('2026-09-03T00:00:00.000Z'))).toBe(true)
    expect(requiresLegalNoticeAcknowledgement(storage, 'v1')).toBe(false)
    expect(requiresLegalNoticeAcknowledgement(storage, 'v2')).toBe(true)
  })

  it('rejects corrupt or incomplete persisted records without throwing', () => {
    expect(readLegalNoticeAcknowledgement(memoryStorage('{not json'))).toBeNull()
    expect(readLegalNoticeAcknowledgement(memoryStorage('{"schemaVersion":1}'))).toBeNull()
  })

  it('stores an auditable timestamp and can be reset', () => {
    const storage = memoryStorage()
    acknowledgeLegalNotice(storage, 'v1', new Date('2026-09-03T12:34:56.000Z'))
    expect(readLegalNoticeAcknowledgement(storage)).toEqual({
      schemaVersion: 1,
      noticeVersion: 'v1',
      acknowledgedAt: '2026-09-03T12:34:56.000Z',
    })
    clearLegalNoticeAcknowledgement(storage)
    expect(readLegalNoticeAcknowledgement(storage)).toBeNull()
  })

  it('fails closed when storage is unavailable', () => {
    const broken: LegalNoticeStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(requiresLegalNoticeAcknowledgement(broken, 'v1')).toBe(true)
    expect(acknowledgeLegalNotice(broken, 'v1')).toBe(false)
    expect(() => clearLegalNoticeAcknowledgement(broken)).not.toThrow()
  })
})
