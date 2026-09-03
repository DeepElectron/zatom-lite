/**
 * Parse biomolecular mmCIF Cartesian `_atom_site` data. This differs from the
 * crystallographic CIF path, which expects a cell and fractional coordinates.
 * PDB conversion reuses the established residue, chain, secondary-structure,
 * and cartoon pipeline.
 */

export interface MmcifAtom {
  /** Normalized element symbol, for example `Fe`. */
  element: string
  /** Atom name from `label_atom_id`. */
  atomName: string
  residueName: string
  chainId: string
  residueSeq: number
  position: [number, number, number]
  /** Whether this is a nonpolymer HETATM record. */
  isHetatm: boolean
  bFactor: number
}

export interface MmcifParseResult {
  atoms: MmcifAtom[]
  /** Chain ids in first-appearance order. */
  chainIds: string[]
}

/** Both `.` and `?` represent missing mmCIF values. */
function isBlank(token: string): boolean {
  return token === '.' || token === '?' || token === ''
}

/** Split an mmCIF row while preserving whitespace inside quoted fields. */
function splitCifLine(line: string): string[] {
  const tokens: string[] = []
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === ' ' || char === '\t') {
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const end = line.indexOf(char, index + 1)
      if (end === -1) {
        tokens.push(line.slice(index + 1))
        break
      }
      tokens.push(line.slice(index + 1, end))
      index = end + 1
      continue
    }
    let end = index
    while (end < line.length && line[end] !== ' ' && line[end] !== '\t') end += 1
    tokens.push(line.slice(index, end))
    index = end
  }
  return tokens
}

export function looksLikeMmcif(content: string): boolean {
  // Cartesian atom-site columns distinguish biomolecular mmCIF from this app's
  // crystallographic fractional-coordinate input path.
  return /_atom_site\.Cartn_x/i.test(content)
}

/** Parse the first model's atom-site fields needed for biomolecular rendering. */
export function parseMmcifAtoms(content: string): MmcifParseResult {
  const lines = content.split(/\r?\n/)
  const columns: string[] = []
  let inLoopHeader = false
  let dataStart = -1

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line.startsWith('_atom_site.')) {
      if (!inLoopHeader) inLoopHeader = true
      columns.push(line.split(/\s+/)[0].slice('_atom_site.'.length))
      continue
    }
    if (inLoopHeader) {
      // The first non-column row starts loop data.
      dataStart = i
      break
    }
  }

  if (dataStart === -1 || columns.length === 0) {
    throw new Error('mmCIF has no _atom_site loop.')
  }

  const columnIndex = (name: string) => columns.findIndex((c) => c.toLowerCase() === name.toLowerCase())
  const xIndex = columnIndex('Cartn_x')
  const yIndex = columnIndex('Cartn_y')
  const zIndex = columnIndex('Cartn_z')
  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('mmCIF _atom_site loop has no Cartesian coordinates.')
  }
  const groupIndex = columnIndex('group_PDB')
  const elementIndex = columnIndex('type_symbol')
  const atomNameIndex = columnIndex('label_atom_id')
  const residueNameIndex = columnIndex('label_comp_id')
  // Prefer author identifiers over internal label numbering when available.
  const authChainIndex = columnIndex('auth_asym_id')
  const labelChainIndex = columnIndex('label_asym_id')
  const authSeqIndex = columnIndex('auth_seq_id')
  const labelSeqIndex = columnIndex('label_seq_id')
  const modelIndex = columnIndex('pdbx_PDB_model_num')
  const bFactorIndex = columnIndex('B_iso_or_equiv')

  const atoms: MmcifAtom[] = []
  const chainIds: string[] = []
  let firstModel: string | null = null

  for (let i = dataStart; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.trim()
    if (line === '' || line === '#') continue
    // A new loop, tag group, or data block ends `_atom_site`.
    if (line.startsWith('loop_') || line.startsWith('_') || line.startsWith('data_')) break

    const tokens = splitCifLine(line)
    if (tokens.length < columns.length) continue

    if (modelIndex !== -1) {
      const model = tokens[modelIndex]
      if (firstModel === null) firstModel = model
      else if (model !== firstModel) break
    }

    const x = Number.parseFloat(tokens[xIndex])
    const y = Number.parseFloat(tokens[yIndex])
    const z = Number.parseFloat(tokens[zIndex])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

    const rawElement = elementIndex === -1 ? '' : tokens[elementIndex]
    const element = isBlank(rawElement)
      ? 'C'
      : rawElement.charAt(0).toUpperCase() + rawElement.slice(1).toLowerCase()

    const chainToken = authChainIndex !== -1 && !isBlank(tokens[authChainIndex])
      ? tokens[authChainIndex]
      : labelChainIndex !== -1 ? tokens[labelChainIndex] : 'A'
    // PDB chain ids are one character; truncate longer mmCIF identifiers.
    const chainId = (isBlank(chainToken) ? 'A' : chainToken).charAt(0)
    if (!chainIds.includes(chainId)) chainIds.push(chainId)

    const seqToken = authSeqIndex !== -1 && !isBlank(tokens[authSeqIndex])
      ? tokens[authSeqIndex]
      : labelSeqIndex !== -1 ? tokens[labelSeqIndex] : ''
    const parsedSeq = Number.parseInt(seqToken, 10)

    const residueNameToken = residueNameIndex === -1 ? '' : tokens[residueNameIndex]
    const atomNameToken = atomNameIndex === -1 ? '' : tokens[atomNameIndex]
    const bFactorToken = bFactorIndex === -1 ? '' : tokens[bFactorIndex]
    const bFactor = Number.parseFloat(bFactorToken)

    atoms.push({
      element,
      atomName: isBlank(atomNameToken) ? element : atomNameToken,
      residueName: isBlank(residueNameToken) ? 'UNK' : residueNameToken.toUpperCase().slice(0, 3),
      chainId,
      residueSeq: Number.isFinite(parsedSeq) ? parsedSeq : 1,
      position: [x, y, z],
      isHetatm: groupIndex !== -1 && tokens[groupIndex].toUpperCase() === 'HETATM',
      bFactor: Number.isFinite(bFactor) ? bFactor : 0,
    })
  }

  if (atoms.length === 0) throw new Error('mmCIF contains no usable atoms.')
  return { atoms, chainIds }
}

/** Format a fixed-column PDB ATOM/HETATM record. */
function formatPdbAtomLine(atom: MmcifAtom, serial: number): string {
  const line = Array<string>(80).fill(' ')
  const put = (start: number, end: number, text: string, align: 'left' | 'right') => {
    const width = end - start
    const padded = align === 'left' ? text.padEnd(width) : text.padStart(width)
    for (let i = 0; i < width; i += 1) line[start + i] = padded[i] ?? ' '
  }

  // PDB atom-name alignment distinguishes calcium `CA` from alpha-carbon ` CA `.
  const name = atom.atomName.slice(0, 4)
  const atomName = atom.element.length === 1 && name.length < 4 ? ` ${name}` : name

  put(0, 6, atom.isHetatm ? 'HETATM' : 'ATOM', 'left')
  put(6, 11, String(Math.min(serial, 99_999)), 'right')
  put(12, 16, atomName, 'left')
  put(17, 20, atom.residueName, 'right')
  put(21, 22, atom.chainId, 'left')
  put(22, 26, String(atom.residueSeq), 'right')
  put(30, 38, atom.position[0].toFixed(3), 'right')
  put(38, 46, atom.position[1].toFixed(3), 'right')
  put(46, 54, atom.position[2].toFixed(3), 'right')
  put(54, 60, '1.00', 'right')
  put(60, 66, atom.bFactor.toFixed(2), 'right')
  put(76, 78, atom.element.toUpperCase(), 'right')
  return line.join('').trimEnd()
}

/** Convert mmCIF to PDB text while preserving B-factor/pLDDT values. */
export function mmcifToPdbText(content: string, options?: { title?: string }): string {
  const { atoms } = parseMmcifAtoms(content)
  const lines: string[] = []
  if (options?.title) lines.push(`TITLE     ${options.title.slice(0, 60)}`)
  atoms.forEach((atom, index) => lines.push(formatPdbAtomLine(atom, index + 1)))
  lines.push('END')
  return `${lines.join('\n')}\n`
}

/** Extract ligand atoms for an independent candidate layer. */
export function mmcifLigandAtoms(content: string): { element: string; position: [number, number, number] }[] {
  const { atoms } = parseMmcifAtoms(content)
  const het = atoms.filter((a) => a.isHetatm && a.element !== 'H')
  // Pure-ligand files may omit HETATM; fall back to all heavy atoms.
  const source = het.length > 0 ? het : atoms.filter((a) => a.element !== 'H')
  return source.map((a) => ({ element: a.element, position: a.position }))
}
