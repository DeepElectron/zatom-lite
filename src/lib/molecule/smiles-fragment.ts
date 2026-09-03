import { addHydrogensToMolecule, convert2Dto3D, parseSimpleSMILES } from './smiles-parser'

export interface GeneratedSmilesFragment {
  atoms: Array<{ element: string; position: [number, number, number] }>
  bonds: Array<{ from: number; to: number; type: string }>
  attachmentIndex: number
}

function hasBalancedSmilesDelimiters(source: string): boolean {
  const stack: string[] = []
  const closeFor: Record<string, string> = { '(': ')', '[': ']' }
  for (const character of source) {
    if (character === '(' || character === '[') stack.push(character)
    else if (character === ')' || character === ']') {
      const opening = stack.pop()
      if (!opening || closeFor[opening] !== character) return false
    }
  }
  return stack.length === 0
}

export function generateFragmentFromSmiles(smiles: string):
  | { success: true; data: GeneratedSmilesFragment }
  | { success: false; error: string } {
  const source = smiles.trim()
  if (!source) return { success: false, error: 'Enter a SMILES string' }
  if (!hasBalancedSmilesDelimiters(source) || /[-=#$\\/.]$/.test(source)) {
    return { success: false, error: 'Could not parse this SMILES (check the syntax)' }
  }
  const attachmentMarkerCount = source.match(/\[\*\]|\*/g)?.length ?? 0
  if (attachmentMarkerCount > 1) {
    return { success: false, error: "Use exactly one '*' attachment marker" }
  }

  const substituted = source.replace(/\[\*\]|\*/g, '[Xe]')
  const molecule = parseSimpleSMILES(substituted)
  if (!molecule?.atoms.length) {
    return { success: false, error: 'Could not parse this SMILES (check the syntax)' }
  }
  const converted = convert2Dto3D(addHydrogensToMolecule(molecule))
  if (!converted.atoms.length) return { success: false, error: 'Parse result is empty' }

  const markerIds = new Set(converted.atoms.filter((atom) => atom.element === 'Xe').map((atom) => atom.id))
  let connectionId: string | null = null
  if (markerIds.size > 0) {
    const firstMarker = [...markerIds][0]
    const connectionBond = converted.bonds.find((bond) => bond.atom1Id === firstMarker || bond.atom2Id === firstMarker)
    connectionId = connectionBond
      ? (connectionBond.atom1Id === firstMarker ? connectionBond.atom2Id : connectionBond.atom1Id)
      : null
    if (!connectionId) return { success: false, error: "'*' must bond to exactly one atom, e.g. *CCO" }
  }

  const bondsWithoutMarkers = converted.bonds.filter(
    (bond) => !markerIds.has(bond.atom1Id) && !markerIds.has(bond.atom2Id),
  )
  const bondedIds = new Set<string>()
  for (const bond of bondsWithoutMarkers) {
    bondedIds.add(bond.atom1Id)
    bondedIds.add(bond.atom2Id)
  }
  const keptAtoms = converted.atoms.filter(
    (atom) => !markerIds.has(atom.id) && (atom.element !== 'H' || bondedIds.has(atom.id)),
  )
  if (!keptAtoms.length) {
    return { success: false, error: 'Fragment is empty after removing the attachment marker' }
  }

  const idToIndex = new Map(keptAtoms.map((atom, index) => [atom.id, index]))
  const atoms = keptAtoms.map((atom) => ({
    element: atom.element,
    position: atom.position as [number, number, number],
  }))
  const bonds = bondsWithoutMarkers
    .filter((bond) => idToIndex.has(bond.atom1Id) && idToIndex.has(bond.atom2Id))
    .map((bond) => ({
      from: idToIndex.get(bond.atom1Id)!,
      to: idToIndex.get(bond.atom2Id)!,
      type: bond.type,
    }))

  let bondLengthSum = 0
  for (const bond of bonds) {
    const from = atoms[bond.from].position
    const to = atoms[bond.to].position
    bondLengthSum += Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2])
  }
  const averageBondLength = bonds.length ? bondLengthSum / bonds.length : 0
  const scale = averageBondLength > 1e-6 ? 1.5 / averageBondLength : 1
  const scaledAtoms = atoms.map((atom) => ({
    element: atom.element,
    position: atom.position.map((value) => value * scale) as [number, number, number],
  }))

  let attachmentIndex = connectionId ? (idToIndex.get(connectionId) ?? -1) : -1
  if (attachmentIndex < 0) {
    const degree = new Array(scaledAtoms.length).fill(0)
    for (const bond of bonds) {
      degree[bond.from]++
      degree[bond.to]++
    }
    attachmentIndex = scaledAtoms.findIndex((atom, index) => atom.element !== 'H' && degree[index] === 1)
    if (attachmentIndex < 0) attachmentIndex = 0
  }

  return { success: true, data: { atoms: scaledAtoms, bonds, attachmentIndex } }
}
