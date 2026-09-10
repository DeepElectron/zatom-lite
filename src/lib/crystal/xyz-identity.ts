/** Source identity shared by ordinary and canonical XYZ importers. */
export class XyzIdentityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'XyzIdentityError'
  }
}

export function validateXyzSourceIds(ids: readonly string[], field: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || /[\u0000-\u001f\u007f]/.test(id)) {
      throw new XyzIdentityError('invalid_extxyz_atom_id', `${field} requires nonempty zatom_id values without control characters`)
    }
    if (seen.has(id)) {
      throw new XyzIdentityError('duplicate_extxyz_atom_id', `${field} has duplicate zatom_id ${JSON.stringify(id)}`)
    }
    seen.add(id)
  }
}

interface XyzFrameIdentity {
  elements: readonly string[]
  /** Absent means index correspondence is an assumption, not source identity. */
  ids?: readonly string[]
}

/** Return current-frame row indices in reference order, never a geometric guess. */
export function xyzFramePermutation(reference: XyzFrameIdentity, frame: XyzFrameIdentity, field: string): number[] {
  const drift = (reason: string): never => {
    throw new XyzIdentityError('extxyz_identity_drift', `${field} ${reason}`)
  }
  if (reference.elements.length !== frame.elements.length) drift('changes atom count')
  if (Boolean(reference.ids) !== Boolean(frame.ids)) drift('changes whether zatom_id is present')
  if (!reference.ids || !frame.ids) {
    if (frame.elements.some((element, i) => element !== reference.elements[i])) drift('changes element order without source IDs')
    return frame.elements.map((_, i) => i)
  }
  if (reference.ids.length !== reference.elements.length || frame.ids.length !== frame.elements.length) {
    drift('requires zatom_id on every atom')
  }
  validateXyzSourceIds(reference.ids, 'Reference frame')
  validateXyzSourceIds(frame.ids, field)
  const rows = new Map(frame.ids.map((id, i) => [id, i]))
  return reference.ids.map((id, i) => {
    const row = rows.get(id)
    if (row === undefined) return drift(`changes the zatom_id set (missing ${JSON.stringify(id)})`)
    if (frame.elements[row] !== reference.elements[i]) drift(`changes the element of zatom_id ${JSON.stringify(id)}`)
    return row
  })
}
