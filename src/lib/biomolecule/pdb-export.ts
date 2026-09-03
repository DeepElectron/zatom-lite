import type {
  BioAtom,
  BioResidue,
  BioStructure,
  BioVector3,
} from './types'

export interface ExportLegacyPdbOptions {
  /** Current viewport coordinates, keyed by stable biomolecular atom id. */
  currentAtomPositions?: ReadonlyMap<string, BioVector3>
  /** Zero-based MODEL frame represented by currentAtomPositions. */
  activeFrameIndex?: number
  /**
  * Atom ids to omit from the export (document-level deletion).
  * Serials are renumbered contiguously; CONECT and SSBOND records
  * referencing an excluded atom are dropped.
  */
  excludeAtomIds?: ReadonlySet<string>
}

function writeField(
  line: string[],
  start: number,
  end: number,
  value: string | number,
  alignment: 'left' | 'right' = 'right',
): void {
  const width = end - start
  const text = String(value)
  if (text.length > width) throw new Error(`PDB field "${text}" exceeds its ${width}-column limit`)
  const padded = alignment === 'left' ? text.padEnd(width) : text.padStart(width)
  for (let index = 0; index < width; index += 1) line[start + index] = padded[index]
}

function recordLine(record: string, fields: (line: string[]) => void): string {
  const line = Array<string>(80).fill(' ')
  writeField(line, 0, 6, record, 'left')
  fields(line)
  return line.join('').trimEnd()
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} ${value} cannot be represented in legacy PDB format`)
  }
  return value
}

function fixedNumber(value: number, width: number, precision: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite for PDB export`)
  const formatted = value.toFixed(precision)
  if (formatted.length > width) throw new Error(`${label} ${formatted} cannot fit in a PDB ${width}-column field`)
  return formatted
}

function pdbAtomName(atom: BioAtom): string {
  const name = atom.name.trim()
  if (!name || name.length > 4) throw new Error(`Atom name "${atom.name}" cannot be represented in legacy PDB format`)
  if (name.length === 4) return name
  return atom.element.trim().length === 1 ? ` ${name.padEnd(3)}` : name.padEnd(4)
}

function pdbCharge(charge: number | null): string {
  if (charge == null || charge === 0) return ''
  const magnitude = Math.abs(charge)
  if (!Number.isInteger(magnitude) || magnitude > 9) {
    throw new Error(`Formal charge ${charge} cannot be represented in legacy PDB format`)
  }
  return `${magnitude}${charge > 0 ? '+' : '-'}`
}

function atomRecord(
  atom: BioAtom,
  residue: BioResidue,
  serial: number,
  position: BioVector3,
): string {
  const identity = residue.identity
  const chain = identity.chainId.trim()
  const insertionCode = identity.insertionCode.trim()
  const alternateLocation = atom.alternateLocation.trim()
  if (residue.name.trim().length > 3) throw new Error(`Residue name "${residue.name}" exceeds the PDB limit`)
  if (chain.length > 1) throw new Error(`Chain identifier "${identity.chainId}" exceeds the legacy PDB limit`)
  if (insertionCode.length > 1) throw new Error(`Insertion code "${identity.insertionCode}" exceeds the PDB limit`)
  if (alternateLocation.length > 1) throw new Error(`Alternate location "${atom.alternateLocation}" exceeds the PDB limit`)
  boundedInteger(identity.sequenceNumber, -999, 9999, 'Residue sequence number')

  return recordLine(atom.recordType, (line) => {
    writeField(line, 6, 11, serial)
    writeField(line, 12, 16, pdbAtomName(atom), 'left')
    writeField(line, 16, 17, alternateLocation, 'left')
    writeField(line, 17, 20, residue.name.trim().toUpperCase(), 'right')
    writeField(line, 21, 22, chain, 'left')
    writeField(line, 22, 26, identity.sequenceNumber)
    writeField(line, 26, 27, insertionCode, 'left')
    writeField(line, 30, 38, fixedNumber(position[0], 8, 3, 'x coordinate'))
    writeField(line, 38, 46, fixedNumber(position[1], 8, 3, 'y coordinate'))
    writeField(line, 46, 54, fixedNumber(position[2], 8, 3, 'z coordinate'))
    writeField(line, 54, 60, fixedNumber(atom.occupancy, 6, 2, 'occupancy'))
    writeField(line, 60, 66, fixedNumber(atom.bFactor, 6, 2, 'B-factor'))
    writeField(line, 76, 78, atom.element.trim().slice(0, 2))
    writeField(line, 78, 80, pdbCharge(atom.formalCharge))
  })
}

function secondaryStructureRecords(structure: BioStructure): string[] {
  const records: string[] = []
  let helixSerial = 0
  let sheetSerial = 0
  for (const chain of structure.chains) {
    let cursor = 0
    while (cursor < chain.residueIndices.length) {
      const first = structure.residues[chain.residueIndices[cursor]]
      if (first.secondaryStructureSource !== 'pdb-record' || first.secondaryStructure === 'coil') {
        cursor += 1
        continue
      }
      let endCursor = cursor
      while (endCursor + 1 < chain.residueIndices.length) {
        const next = structure.residues[chain.residueIndices[endCursor + 1]]
        if (
          next.secondaryStructureSource !== 'pdb-record'
          || next.secondaryStructure !== first.secondaryStructure
        ) break
        endCursor += 1
      }
      const last = structure.residues[chain.residueIndices[endCursor]]
      if (first.secondaryStructure === 'helix') {
        helixSerial += 1
        records.push(recordLine('HELIX', (line) => {
          writeField(line, 7, 10, helixSerial)
          writeField(line, 11, 14, `H${helixSerial}`, 'left')
          writeField(line, 15, 18, first.name.slice(0, 3))
          writeField(line, 19, 20, first.identity.chainId, 'left')
          writeField(line, 21, 25, first.identity.sequenceNumber)
          writeField(line, 25, 26, first.identity.insertionCode, 'left')
          writeField(line, 27, 30, last.name.slice(0, 3))
          writeField(line, 31, 32, last.identity.chainId, 'left')
          writeField(line, 33, 37, last.identity.sequenceNumber)
          writeField(line, 37, 38, last.identity.insertionCode, 'left')
          writeField(line, 38, 40, 1)
        }))
      } else {
        sheetSerial += 1
        records.push(recordLine('SHEET', (line) => {
          writeField(line, 7, 10, sheetSerial)
          writeField(line, 11, 14, `S${sheetSerial}`, 'left')
          writeField(line, 14, 16, 1)
          writeField(line, 17, 20, first.name.slice(0, 3))
          writeField(line, 21, 22, first.identity.chainId, 'left')
          writeField(line, 22, 26, first.identity.sequenceNumber)
          writeField(line, 26, 27, first.identity.insertionCode, 'left')
          writeField(line, 28, 31, last.name.slice(0, 3))
          writeField(line, 32, 33, last.identity.chainId, 'left')
          writeField(line, 33, 37, last.identity.sequenceNumber)
          writeField(line, 37, 38, last.identity.insertionCode, 'left')
        }))
      }
      cursor = endCursor + 1
    }
  }
  return records
}

function disulfideRecords(structure: BioStructure): string[] {
  let serial = 0
  return structure.bonds.flatMap((bond) => {
    if (bond.kind !== 'disulfide') return []
    const left = structure.residues[structure.atoms[bond.atomIndex1]?.residueIndex]
    const right = structure.residues[structure.atoms[bond.atomIndex2]?.residueIndex]
    if (!left || !right) return []
    serial += 1
    return [recordLine('SSBOND', (line) => {
      writeField(line, 7, 10, serial)
      writeField(line, 11, 14, 'CYS')
      writeField(line, 15, 16, left.identity.chainId, 'left')
      writeField(line, 17, 21, left.identity.sequenceNumber)
      writeField(line, 21, 22, left.identity.insertionCode, 'left')
      writeField(line, 25, 28, 'CYS')
      writeField(line, 29, 30, right.identity.chainId, 'left')
      writeField(line, 31, 35, right.identity.sequenceNumber)
      writeField(line, 35, 36, right.identity.insertionCode, 'left')
    })]
  })
}

function titleRecords(title: string): string[] {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const chunks = normalized.match(/.{1,69}(?:\s|$)|.{1,69}/g) ?? [normalized]
  return chunks.map((chunk, index) => recordLine('TITLE', (line) => {
    if (chunks.length > 1) writeField(line, 8, 10, index + 1)
    writeField(line, 10, 79, chunk.trim(), 'left')
  }))
}

/** Serialize the canonical biomolecular document as legacy fixed-column PDB. */
export function exportLegacyPdb(
  structure: BioStructure,
  options: ExportLegacyPdbOptions = {},
): string {
  if (structure.atoms.length === 0) throw new Error('Cannot export an empty biomolecular structure')
  if (structure.atoms.length > 99_999) {
    throw new Error('Legacy PDB supports at most 99,999 atoms; this structure requires mmCIF')
  }
  // Exclude atoms in the set from writing records: serial is null, and continuously renumber the remaining atoms.
  const excluded = options.excludeAtomIds
  let nextSerial = 0
  const serials = structure.atoms.map((atom) =>
    excluded?.has(atom.id) ? null : ++nextSerial)
  if (nextSerial === 0) throw new Error('Cannot export a structure with every atom excluded')
  const lines = [
    ...titleRecords(structure.title),
    ...secondaryStructureRecords(structure),
    ...disulfideRecords(structure),
  ]
  const sourceFrames = structure.frames.length > 0
    ? structure.frames
    : [{ modelNumber: 1, positions: new Float32Array(structure.atoms.flatMap((atom) => atom.position)) }]
  const multipleModels = sourceFrames.length > 1

  sourceFrames.forEach((frame, frameIndex) => {
    if (frame.positions.length !== structure.atoms.length * 3) {
      throw new Error(`MODEL ${frame.modelNumber} coordinate count does not match the biomolecular topology`)
    }
    if (multipleModels) lines.push(recordLine('MODEL', (line) => {
      const modelNumber = Number.isInteger(frame.modelNumber) && frame.modelNumber >= 0 && frame.modelNumber <= 9999
        ? frame.modelNumber
        : frameIndex + 1
      writeField(line, 10, 14, modelNumber)
    }))
    structure.atoms.forEach((atom, atomIndex) => {
      const serial = serials[atomIndex]
      if (serial == null) return
      const offset = atomIndex * 3
      const framePosition: BioVector3 = [
        frame.positions[offset],
        frame.positions[offset + 1],
        frame.positions[offset + 2],
      ]
      const position = frameIndex === (options.activeFrameIndex ?? 0)
        ? options.currentAtomPositions?.get(atom.id) ?? framePosition
        : framePosition
      const residue = structure.residues[atom.residueIndex]
      if (!residue) throw new Error(`Atom ${atom.id} references missing residue ${atom.residueIndex}`)
      lines.push(atomRecord(atom, residue, serial, position))
    })
    if (multipleModels) lines.push('ENDMDL')
  })

  for (const bond of structure.bonds) {
    if (bond.source !== 'conect') continue
    const left = serials[bond.atomIndex1]
    const right = serials[bond.atomIndex2]
    if (!left || !right) continue
    const order = Math.max(1, Math.min(3, Math.round(bond.order)))
    lines.push(recordLine('CONECT', (line) => {
      writeField(line, 6, 11, left)
      for (let index = 0; index < order; index += 1) writeField(line, 11 + index * 5, 16 + index * 5, right)
    }))
  }
  lines.push('END')
  return `${lines.join('\n')}\n`
}
