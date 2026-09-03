export const ZATOM_LEGAL_NOTICE_VERSION = '2026-09-03'
export const ZATOM_LEGAL_NOTICE_STORAGE_KEY = 'zatom:legal-notice-acknowledgement'

export interface ZatomLegalNoticeAcknowledgement {
  schemaVersion: 1
  noticeVersion: string
  acknowledgedAt: string
}

export type LegalNoticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): LegalNoticeStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function validAcknowledgement(value: unknown): value is ZatomLegalNoticeAcknowledgement {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.noticeVersion === 'string'
    && typeof record.acknowledgedAt === 'string'
    && Number.isFinite(Date.parse(record.acknowledgedAt))
}

export function readLegalNoticeAcknowledgement(
  storage: LegalNoticeStorage | null = browserStorage(),
): ZatomLegalNoticeAcknowledgement | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ZATOM_LEGAL_NOTICE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return validAcknowledgement(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function requiresLegalNoticeAcknowledgement(
  storage: LegalNoticeStorage | null = browserStorage(),
  noticeVersion = ZATOM_LEGAL_NOTICE_VERSION,
): boolean {
  return readLegalNoticeAcknowledgement(storage)?.noticeVersion !== noticeVersion
}

/**
 * Persists that the user has seen the notice. This is an acknowledgement of
 * where the terms are available, not a separate EULA or a prerequisite for
 * running an unmodified copy under AGPL section 9.
 */
export function acknowledgeLegalNotice(
  storage: LegalNoticeStorage | null = browserStorage(),
  noticeVersion = ZATOM_LEGAL_NOTICE_VERSION,
  acknowledgedAt = new Date(),
): boolean {
  if (!storage) return false
  const acknowledgement: ZatomLegalNoticeAcknowledgement = {
    schemaVersion: 1,
    noticeVersion,
    acknowledgedAt: acknowledgedAt.toISOString(),
  }
  try {
    storage.setItem(ZATOM_LEGAL_NOTICE_STORAGE_KEY, JSON.stringify(acknowledgement))
    return true
  } catch {
    return false
  }
}

export function clearLegalNoticeAcknowledgement(
  storage: LegalNoticeStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(ZATOM_LEGAL_NOTICE_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private browsing or a hardened webview.
  }
}
