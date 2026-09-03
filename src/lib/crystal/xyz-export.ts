export interface XYZExportAtom {
  element: string
  cartesian?: [number, number, number]
  position?: [number, number, number]
}

export function exportAtomsToXYZ(
  atoms: ReadonlyArray<XYZExportAtom>,
  comment = 'Exported from zatom',
): string {
  const lines = [String(atoms.length), comment]
  for (const atom of atoms) {
    const [x, y, z] = atom.cartesian ?? atom.position ?? [0, 0, 0]
    lines.push(`${atom.element.padEnd(3)} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`)
  }
  return `${lines.join('\n')}\n`
}
