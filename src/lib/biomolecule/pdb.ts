import {
  BIO_AMINO_ACIDS,
  BIO_NUCLEOTIDES,
  BIO_WATER_RESIDUES,
  isStandardBioResidue,
} from "./constants"
import { estimateSecondaryStructureFromAlphaCarbonGeometry } from "./secondary-structure"
import type {
  BioAtom,
  BioBond,
  BioBondSource,
  BioChain,
  BioFrame,
  BioLigand,
  BioPolymerType,
  BioResidue,
  BioSecondaryStructure,
  BioStructure,
  BioVector3,
} from "./types"

export interface ParseLegacyPdbOptions {
  id?: string
  title?: string
  inferBonds?: boolean
  /** Explicit provenance wins over conservative ID/title detection. */
  bFactorSemantics?: BioStructure["bFactorSemantics"]
}

interface ParsedAtomLine {
  recordType: BioAtom["recordType"]
  serial: number
  name: string
  alternateLocation: string
  residueName: string
  chainId: string
  sequenceNumber: number
  insertionCode: string
  position: [number, number, number]
  occupancy: number
  bFactor: number
  element: string
  formalCharge: number | null
}

interface SecondaryStructureRange {
  chainId: string
  start: number
  startInsertionCode: string
  end: number
  endInsertionCode: string
  kind: Extract<BioSecondaryStructure, "helix" | "sheet">
}

interface DisulfideRecord {
  left: { chainId: string; sequenceNumber: number; insertionCode: string }
  right: { chainId: string; sequenceNumber: number; insertionCode: string }
}

interface ModelRecord {
  number: number
  atoms: ParsedAtomLine[]
}

const COVALENT_RADII: Readonly<Record<string, number>> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  S: 1.05,
  P: 1.07,
  Se: 1.2,
  F: 0.57,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
  Fe: 1.32,
  Zn: 1.22,
  Mg: 1.41,
  Mn: 1.39,
  Ca: 1.71,
  Na: 1.66,
  K: 2.03,
  Cu: 1.32,
  Ni: 1.24,
  Co: 1.26,
}

function field(line: string, start: number, end: number): string {
  return line.slice(start, end)
}

function parseFiniteFloat(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

function parseFiniteInteger(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : fallback
}

function normalizeElement(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ""
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1).toLowerCase()}`
}

function inferElementFromAtomName(
  rawName: string,
  residueName: string,
  recordType: BioAtom["recordType"],
): string {
  const stripped = rawName.trim().replace(/^\d+/, "")
  const upper = stripped.replace(/[^A-Za-z]/g, "").toUpperCase()
  const residueUpper = residueName.toUpperCase()
  const twoLetter = new Set(["FE", "ZN", "MG", "MN", "CA", "NA", "CL", "BR", "CU", "NI", "CO", "SE"])

  // A leading blank in the four-column atom-name field denotes a one-letter
  // element (for example the protein alpha carbon ` CA `).  Monatomic HETATM
  // residues are the important exception: `CA`/`CA` is calcium, not carbon.
  if (recordType === "HETATM" && residueUpper === upper && twoLetter.has(upper)) {
    return normalizeElement(upper)
  }
  if (rawName[0] !== " " && upper.length >= 2 && twoLetter.has(upper.slice(0, 2))) {
    return normalizeElement(upper.slice(0, 2))
  }
  return normalizeElement(upper.slice(0, 1)) || "X"
}

function parseFormalCharge(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const match = /^(\d)([+-])$/.exec(trimmed) ?? /^([+-])(\d)$/.exec(trimmed)
  if (!match) return null
  if (/^\d/.test(trimmed)) return Number(match[1]) * (match[2] === "+" ? 1 : -1)
  return Number(match[2]) * (match[1] === "+" ? 1 : -1)
}

function parseAtomLine(line: string): ParsedAtomLine | null {
  const record = field(line, 0, 6).trim()
  if (record !== "ATOM" && record !== "HETATM") return null
  const alternateLocation = field(line, 16, 17).trim()
  const sequenceNumber = Number.parseInt(field(line, 22, 26), 10)
  const x = Number.parseFloat(field(line, 30, 38))
  const y = Number.parseFloat(field(line, 38, 46))
  const z = Number.parseFloat(field(line, 46, 54))
  if (![sequenceNumber, x, y, z].every(Number.isFinite)) return null
  const residueName = field(line, 17, 20).trim().toUpperCase()
  const rawName = field(line, 12, 16)
  const name = rawName.trim()
  const elementFromColumn = normalizeElement(field(line, 76, 78))
  return {
    recordType: record,
    serial: parseFiniteInteger(field(line, 6, 11), 0),
    name,
    alternateLocation,
    residueName,
    chainId: field(line, 21, 22).trim(),
    sequenceNumber,
    insertionCode: field(line, 26, 27).trim(),
    position: [x, y, z],
    // Occupancy zero is valid and must not be replaced with one.
    occupancy: parseFiniteFloat(field(line, 54, 60), 1),
    bFactor: parseFiniteFloat(field(line, 60, 66), 0),
    element: elementFromColumn || inferElementFromAtomName(rawName, residueName, record),
    formalCharge: parseFormalCharge(field(line, 78, 80)),
  }
}

function alternateLocationGroup(atom: ParsedAtomLine): string {
  return [
    atom.recordType,
    atom.name,
    atom.residueName,
    atom.chainId,
    atom.sequenceNumber,
    atom.insertionCode,
  ].join("\u001f")
}

function preferredAlternateLocation(candidates: readonly ParsedAtomLine[]): ParsedAtomLine {
  return [...candidates].sort((left, right) => {
    const leftBlank = left.alternateLocation === ""
    const rightBlank = right.alternateLocation === ""
    if (leftBlank !== rightBlank) return leftBlank ? -1 : 1
    if (left.occupancy !== right.occupancy) return right.occupancy - left.occupancy
    const alternateOrder = left.alternateLocation.localeCompare(right.alternateLocation)
    return alternateOrder || left.serial - right.serial
  })[0]
}

function resolveAlternateLocations(
  atoms: readonly ParsedAtomLine[],
  topologyChoices?: ReadonlyMap<string, string>,
): { atoms: ParsedAtomLine[]; choices: Map<string, string> } {
  const groups = new Map<string, ParsedAtomLine[]>()
  const groupOrder: string[] = []
  for (const atom of atoms) {
    const key = alternateLocationGroup(atom)
    const group = groups.get(key)
    if (group) group.push(atom)
    else {
      groups.set(key, [atom])
      groupOrder.push(key)
    }
  }

  const choices = new Map<string, string>()
  const selected: ParsedAtomLine[] = []
  for (const key of groupOrder) {
    const candidates = groups.get(key)!
    const required = topologyChoices?.get(key)
    const chosen = required === undefined
      ? preferredAlternateLocation(candidates)
      : candidates.find((candidate) => candidate.alternateLocation === required)
    if (!chosen) continue
    choices.set(key, chosen.alternateLocation)
    selected.push(chosen)
  }
  return { atoms: selected, choices }
}

function atomIdentity(atom: ParsedAtomLine): string {
  return [
    atom.recordType,
    atom.serial,
    atom.name,
    atom.alternateLocation,
    atom.residueName,
    atom.chainId,
    atom.sequenceNumber,
    atom.insertionCode,
    atom.element,
  ].join("\u001f")
}

function residueIdentityKey(
  chainId: string,
  sequenceNumber: number,
  insertionCode: string,
): string {
  return `${chainId}\u001f${sequenceNumber}\u001f${insertionCode}`
}

function residuesAreSequential(left: BioResidue, right: BioResidue): boolean {
  if (left.chainIndex !== right.chainIndex) return false
  const leftIdentity = left.identity
  const rightIdentity = right.identity
  if (leftIdentity.sequenceNumber === rightIdentity.sequenceNumber) {
    const leftCode = leftIdentity.insertionCode
    const rightCode = rightIdentity.insertionCode
    if (leftCode === rightCode) return false
    if (leftCode === '' && rightCode === 'A') return true
    return leftCode.length === 1
      && rightCode.length === 1
      && rightCode.charCodeAt(0) === leftCode.charCodeAt(0) + 1
  }
  return rightIdentity.sequenceNumber === leftIdentity.sequenceNumber + 1
    && rightIdentity.insertionCode === ''
}

function atomsFormSequentialPolymerBond(
  leftAtom: BioAtom,
  leftResidue: BioResidue,
  rightAtom: BioAtom,
  rightResidue: BioResidue,
): boolean {
  const forward = residuesAreSequential(leftResidue, rightResidue)
  const reverse = !forward && residuesAreSequential(rightResidue, leftResidue)
  if (!forward && !reverse) return false
  const earlierAtom = forward ? leftAtom : rightAtom
  const earlierResidue = forward ? leftResidue : rightResidue
  const laterAtom = forward ? rightAtom : leftAtom
  const laterResidue = forward ? rightResidue : leftResidue
  if (BIO_AMINO_ACIDS.has(earlierResidue.name) && BIO_AMINO_ACIDS.has(laterResidue.name)) {
    return earlierAtom.name === "C" && laterAtom.name === "N"
  }
  if (BIO_NUCLEOTIDES.has(earlierResidue.name) && BIO_NUCLEOTIDES.has(laterResidue.name)) {
    return earlierAtom.name === "O3'" && laterAtom.name === "P"
  }
  return false
}

function parseSecondaryStructureRecord(line: string): SecondaryStructureRange | null {
  const record = field(line, 0, 6).trim()
  if (record === "HELIX") {
    const start = Number.parseInt(field(line, 21, 25), 10)
    const end = Number.parseInt(field(line, 33, 37), 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return {
      chainId: field(line, 19, 20).trim(),
      start,
      startInsertionCode: field(line, 25, 26).trim(),
      end,
      endInsertionCode: field(line, 37, 38).trim(),
      kind: "helix",
    }
  }
  if (record === "SHEET") {
    const start = Number.parseInt(field(line, 22, 26), 10)
    const end = Number.parseInt(field(line, 33, 37), 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return {
      chainId: field(line, 21, 22).trim(),
      start,
      startInsertionCode: field(line, 26, 27).trim(),
      end,
      endInsertionCode: field(line, 37, 38).trim(),
      kind: "sheet",
    }
  }
  return null
}

function parseDisulfideRecord(line: string): DisulfideRecord | null {
  if (field(line, 0, 6).trim() !== "SSBOND") return null
  const leftSequence = Number.parseInt(field(line, 17, 21), 10)
  const rightSequence = Number.parseInt(field(line, 31, 35), 10)
  if (!Number.isFinite(leftSequence) || !Number.isFinite(rightSequence)) return null
  return {
    left: {
      chainId: field(line, 15, 16).trim(),
      sequenceNumber: leftSequence,
      insertionCode: field(line, 21, 22).trim(),
    },
    right: {
      chainId: field(line, 29, 30).trim(),
      sequenceNumber: rightSequence,
      insertionCode: field(line, 35, 36).trim(),
    },
  }
}

function compareResiduePosition(sequenceNumber: number, insertionCode: string, boundaryNumber: number, boundaryCode: string): number {
  if (sequenceNumber !== boundaryNumber) return sequenceNumber - boundaryNumber
  return insertionCode.localeCompare(boundaryCode)
}

function pointInSecondaryStructureRange(residue: BioResidue, range: SecondaryStructureRange): boolean {
  const identity = residue.identity
  if (identity.chainId !== range.chainId) return false
  return (
    compareResiduePosition(identity.sequenceNumber, identity.insertionCode, range.start, range.startInsertionCode) >= 0 &&
    compareResiduePosition(identity.sequenceNumber, identity.insertionCode, range.end, range.endInsertionCode) <= 0
  )
}

function chainPolymerType(residueIndices: readonly number[], residues: readonly BioResidue[]): BioPolymerType {
  let protein = 0
  let nucleic = 0
  for (const residueIndex of residueIndices) {
    const name = residues[residueIndex].name
    if (BIO_AMINO_ACIDS.has(name)) protein += 1
    else if (BIO_NUCLEOTIDES.has(name)) nucleic += 1
  }
  if (protein >= 2 || protein > nucleic) return "protein"
  if (nucleic >= 2 || nucleic > protein) return "nucleic"
  return "other"
}

function chooseRepresentativeAtom(atomLines: readonly ParsedAtomLine[], atomIndices: readonly number[]): number | null {
  const ca = atomIndices.find((index) => atomLines[index].name === "CA" && atomLines[index].element === "C")
  if (ca !== undefined) return ca
  const phosphorus = atomIndices.find((index) => atomLines[index].name === "P")
  if (phosphorus !== undefined) return phosphorus
  const c4 = atomIndices.find((index) => atomLines[index].name === "C4'")
  return c4 ?? atomIndices[0] ?? null
}

function centerPositions(atomLines: readonly ParsedAtomLine[]): { center: BioVector3; positions: [number, number, number][] } {
  if (atomLines.length === 0) return { center: [0, 0, 0], positions: [] }
  let x = 0
  let y = 0
  let z = 0
  for (const atom of atomLines) {
    x += atom.position[0]
    y += atom.position[1]
    z += atom.position[2]
  }
  const center: BioVector3 = [x / atomLines.length, y / atomLines.length, z / atomLines.length]
  return {
    center,
    positions: atomLines.map((atom) => [
      atom.position[0] - center[0],
      atom.position[1] - center[1],
      atom.position[2] - center[2],
    ]),
  }
}

function makeLigands(residues: readonly BioResidue[], atoms: readonly BioAtom[]): BioLigand[] {
  const ligands: BioLigand[] = []
  for (const residue of residues) {
    if (residue.isStandard || BIO_WATER_RESIDUES.has(residue.name) || residue.atomIndices.length === 0) continue
    let x = 0
    let y = 0
    let z = 0
    for (const atomIndex of residue.atomIndices) {
      const position = atoms[atomIndex].position
      x += position[0]
      y += position[1]
      z += position[2]
    }
    const count = residue.atomIndices.length
    ligands.push({
      id: `ligand:${residue.id}`,
      residueIndex: residue.index,
      name: residue.name,
      atomIndices: [...residue.atomIndices],
      centroid: [x / count, y / count, z / count],
    })
  }
  return ligands
}

function covalentRadius(element: string): number {
  return COVALENT_RADII[element] ?? 0.77
}

function inferDistanceBonds(atoms: readonly BioAtom[], residues: readonly BioResidue[]): [number, number][] {
  const result: [number, number][] = []
  const cellSize = 2.5
  const grid = new Map<string, number[]>()
  const key = (position: BioVector3): string =>
    `${Math.floor(position[0] / cellSize)},${Math.floor(position[1] / cellSize)},${Math.floor(position[2] / cellSize)}`
  atoms.forEach((atom) => {
    const cell = key(atom.position)
    const bucket = grid.get(cell)
    if (bucket) bucket.push(atom.index)
    else grid.set(cell, [atom.index])
  })
  for (const atom of atoms) {
    const [x, y, z] = atom.position
    const gx = Math.floor(x / cellSize)
    const gy = Math.floor(y / cellSize)
    const gz = Math.floor(z / cellSize)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const otherIndex of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
            if (otherIndex <= atom.index) continue
            const other = atoms[otherIndex]
            const leftResidue = residues[atom.residueIndex]
            const rightResidue = residues[other.residueIndex]
            if (atom.residueIndex !== other.residueIndex) {
              const adjacent = atomsFormSequentialPolymerBond(atom, leftResidue, other, rightResidue)
              const bothHet = atom.recordType === "HETATM" && other.recordType === "HETATM"
              if (!adjacent && !bothHet) continue
            }
            const distance = Math.hypot(x - other.position[0], y - other.position[1], z - other.position[2])
            const maximum = covalentRadius(atom.element) + covalentRadius(other.element) + 0.45
            if (distance >= 0.4 && distance <= maximum) result.push([atom.index, otherIndex])
          }
        }
      }
    }
  }
  return result
}

function addBond(
  bonds: BioBond[],
  seen: Set<string>,
  atoms: readonly BioAtom[],
  left: number,
  right: number,
  source: BioBondSource,
  kind: BioBond["kind"] = "covalent",
  order = 1,
): void {
  if (left === right || !atoms[left] || !atoms[right]) return
  const atomIndex1 = Math.min(left, right)
  const atomIndex2 = Math.max(left, right)
  const key = `${atomIndex1}:${atomIndex2}`
  if (seen.has(key)) return
  seen.add(key)
  bonds.push({
    id: `bond:${atoms[atomIndex1].id}:${atoms[atomIndex2].id}`,
    index: bonds.length,
    atomIndex1,
    atomIndex2,
    atomId1: atoms[atomIndex1].id,
    atomId2: atoms[atomIndex2].id,
    order,
    kind,
    source,
  })
}

function detectBFactorSemantics(id: string, title: string): BioStructure["bFactorSemantics"] {
  return /^AF[-_]/i.test(id) || /alphafold/i.test(title) ? "plddt" : "temperature-factor"
}

export function parseLegacyPdb(content: string, options: ParseLegacyPdbOptions = {}): BioStructure {
  const id = options.id?.trim() || "PDB"
  const warnings: string[] = []
  const titleParts: string[] = []
  const secondaryRanges: SecondaryStructureRange[] = []
  const disulfides: DisulfideRecord[] = []
  const conectRecords: number[][] = []
  const models: ModelRecord[] = []
  let current: ModelRecord | null = null
  let sawExplicitModel = false
  let nextImplicitModel = 1

  const ensureModel = (): ModelRecord => {
    if (!current) current = { number: nextImplicitModel, atoms: [] }
    return current
  }
  const finishModel = (): void => {
    if (!current) return
    if (current.atoms.length > 0) models.push(current)
    current = null
    nextImplicitModel += 1
  }

  for (const line of content.split(/\r?\n/)) {
    const record = field(line, 0, 6).trim()
    if (record === "MODEL") {
      if (current?.atoms.length) finishModel()
      sawExplicitModel = true
      current = { number: parseFiniteInteger(field(line, 10, 14), models.length + 1), atoms: [] }
      continue
    }
    if (record === "ENDMDL") {
      finishModel()
      continue
    }
    if (record === "TITLE") {
      titleParts.push(field(line, 10, line.length).trim())
      continue
    }
    const secondary = parseSecondaryStructureRecord(line)
    if (secondary) {
      secondaryRanges.push(secondary)
      continue
    }
    const disulfide = parseDisulfideRecord(line)
    if (disulfide) {
      disulfides.push(disulfide)
      continue
    }
    if (record === "CONECT") {
      const serials = line
        .slice(6)
        .match(/.{1,5}/g)
        ?.map((part) => Number.parseInt(part, 10))
        .filter(Number.isFinite) as number[] | undefined
      if (serials && serials.length >= 2) conectRecords.push(serials)
      continue
    }
    const atom = parseAtomLine(line)
    if (atom) ensureModel().atoms.push(atom)
  }
  finishModel()
  if (models.length === 0) {
    throw new Error("Legacy PDB input contains no supported ATOM or HETATM records")
  }
  if (!sawExplicitModel && models.length > 1) {
    warnings.push("Multiple implicit topology segments were encountered; only valid MODEL records form trajectory frames")
  }

  const topologyResolution = resolveAlternateLocations(models[0].atoms)
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    models[modelIndex] = {
      ...models[modelIndex],
      atoms: resolveAlternateLocations(models[modelIndex].atoms, topologyResolution.choices).atoms,
    }
  }
  const residueNamesByIdentity = new Map<string, Set<string>>()
  for (const atom of models[0].atoms) {
    const key = residueIdentityKey(atom.chainId, atom.sequenceNumber, atom.insertionCode)
    const names = residueNamesByIdentity.get(key) ?? new Set<string>()
    names.add(atom.residueName)
    residueNamesByIdentity.set(key, names)
  }
  const ambiguousResidueIdentities = new Set(
    [...residueNamesByIdentity].filter(([, names]) => names.size > 1).map(([key]) => key),
  )
  for (const key of ambiguousResidueIdentities) {
    const [chainId, sequenceNumber, insertionCode] = key.split("\u001f")
    const names = [...(residueNamesByIdentity.get(key) ?? [])].sort().join("/")
    warnings.push(
      `Residue identity ${chainId || "<blank>"}:${sequenceNumber}${insertionCode} has conflicting names ${names}; the ambiguous site was skipped`,
    )
  }
  if (ambiguousResidueIdentities.size > 0) {
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      models[modelIndex] = {
        ...models[modelIndex],
        atoms: models[modelIndex].atoms.filter((atom) => !ambiguousResidueIdentities.has(
          residueIdentityKey(atom.chainId, atom.sequenceNumber, atom.insertionCode),
        )),
      }
    }
  }
  const topology = models[0]
  if (topology.atoms.length === 0) {
    throw new Error("Legacy PDB input contains no unambiguous ATOM or HETATM records")
  }
  const topologyIdentities = topology.atoms.map(atomIdentity)
  const { center, positions: centeredPositions } = centerPositions(topology.atoms)
  const chainIndexByIdentifier = new Map<string, number>()
  const residueIndexByIdentity = new Map<string, number>()
  const chainResidues: number[][] = []
  const residues: BioResidue[] = []

  for (let atomIndex = 0; atomIndex < topology.atoms.length; atomIndex += 1) {
    const parsed = topology.atoms[atomIndex]
    let chainIndex = chainIndexByIdentifier.get(parsed.chainId)
    if (chainIndex === undefined) {
      chainIndex = chainIndexByIdentifier.size
      chainIndexByIdentifier.set(parsed.chainId, chainIndex)
      chainResidues[chainIndex] = []
    }
    const identityKey = residueIdentityKey(parsed.chainId, parsed.sequenceNumber, parsed.insertionCode)
    let residueIndex = residueIndexByIdentity.get(identityKey)
    if (residueIndex === undefined) {
      residueIndex = residues.length
      residueIndexByIdentity.set(identityKey, residueIndex)
      chainResidues[chainIndex].push(residueIndex)
      residues.push({
        id: `residue:${parsed.chainId || "_"}:${parsed.sequenceNumber}:${parsed.insertionCode || "_"}`,
        index: residueIndex,
        name: parsed.residueName,
        identity: {
          chainId: parsed.chainId,
          sequenceNumber: parsed.sequenceNumber,
          insertionCode: parsed.insertionCode,
        },
        chainIndex,
        atomStart: atomIndex,
        atomEnd: atomIndex,
        atomIndices: [],
        representativeAtomIndex: null,
        backboneOxygenIndex: null,
        isStandard: isStandardBioResidue(parsed.residueName),
        secondaryStructure: "coil",
        secondaryStructureSource: "none",
      })
    }
    ;(residues[residueIndex].atomIndices as number[]).push(atomIndex)
    residues[residueIndex].atomEnd = atomIndex + 1
  }

  const atoms: BioAtom[] = topology.atoms.map((parsed, index) => {
    const residueIndex = residueIndexByIdentity.get(
      residueIdentityKey(parsed.chainId, parsed.sequenceNumber, parsed.insertionCode),
    )!
    const identitySuffix = `${parsed.chainId || "_"}:${parsed.sequenceNumber}:${parsed.insertionCode || "_"}:${parsed.name}:${parsed.alternateLocation || "_"}`
    return {
      id: `atom:${parsed.serial}:${identitySuffix}`,
      index,
      serial: parsed.serial,
      recordType: parsed.recordType,
      name: parsed.name,
      element: parsed.element,
      position: centeredPositions[index],
      occupancy: parsed.occupancy,
      bFactor: parsed.bFactor,
      formalCharge: parsed.formalCharge,
      alternateLocation: parsed.alternateLocation,
      residueIndex,
    }
  })

  for (const residue of residues) {
    residue.representativeAtomIndex = chooseRepresentativeAtom(topology.atoms, residue.atomIndices)
    residue.backboneOxygenIndex = residue.atomIndices.find((index) => topology.atoms[index].name === "O") ?? null
    if (!BIO_AMINO_ACIDS.has(residue.name)) continue
    for (const range of secondaryRanges) {
      if (!pointInSecondaryStructureRange(residue, range)) continue
      residue.secondaryStructure = range.kind
      residue.secondaryStructureSource = "pdb-record"
      break
    }
  }

  const chains: BioChain[] = [...chainIndexByIdentifier.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([identifier, index]) => ({
      id: `chain:${index}:${identifier || "_"}`,
      index,
      identifier,
      polymerType: chainPolymerType(chainResidues[index], residues),
      residueIndices: chainResidues[index],
    }))

  // Match PDB semantics at the structure level: geometry is a fallback only
  // when no HELIX/SHEET range produced any valid residue assignment. Once a
  // record applies, uncovered residues remain explicitly unassigned coil; a
  // structure must never mix authoritative records with geometric estimates.
  const hasRecordedSecondaryStructure = residues.some(
    (residue) => residue.secondaryStructureSource === "pdb-record",
  )
  if (!hasRecordedSecondaryStructure) {
    estimateSecondaryStructureFromAlphaCarbonGeometry(atoms, residues, chains)
  }

  const frames: BioFrame[] = []
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex]
    const identities = model.atoms.map(atomIdentity)
    const compatible =
      identities.length === topologyIdentities.length &&
      identities.every((identity, atomIndex) => identity === topologyIdentities[atomIndex])
    if (!compatible) {
      warnings.push(`MODEL ${model.number} was omitted because atom identity or order differs from the topology model`)
      continue
    }
    const positions = new Float32Array(model.atoms.length * 3)
    model.atoms.forEach((atom, atomIndex) => {
      positions[atomIndex * 3] = atom.position[0] - center[0]
      positions[atomIndex * 3 + 1] = atom.position[1] - center[1]
      positions[atomIndex * 3 + 2] = atom.position[2] - center[2]
    })
    frames.push({ modelNumber: model.number, positions })
  }

  const serialToAtomIndex = new Map<number, number>()
  atoms.forEach((atom) => serialToAtomIndex.set(atom.serial, atom.index))
  const bonds: BioBond[] = []
  const seenBonds = new Set<string>()
  const conectCounts = new Map<string, { left: number; right: number; forward: number; reverse: number }>()
  for (const serials of conectRecords) {
    const left = serialToAtomIndex.get(serials[0])
    if (left === undefined) continue
    for (const serial of serials.slice(1)) {
      const right = serialToAtomIndex.get(serial)
      if (right === undefined || right === left) continue
      const atomIndex1 = Math.min(left, right)
      const atomIndex2 = Math.max(left, right)
      const key = `${atomIndex1}:${atomIndex2}`
      const count = conectCounts.get(key) ?? { left: atomIndex1, right: atomIndex2, forward: 0, reverse: 0 }
      if (left === atomIndex1) count.forward += 1
      else count.reverse += 1
      conectCounts.set(key, count)
    }
  }
  for (const count of conectCounts.values()) {
    // Reciprocal CONECT records describe the same bond; repeated targets in one
    // direction encode multiplicity. Legacy PDB represents at most triple bonds.
    const order = Math.min(3, Math.max(1, count.forward, count.reverse))
    addBond(bonds, seenBonds, atoms, count.left, count.right, "conect", "covalent", order)
  }

  const residueByIdentity = new Map<string, BioResidue>()
  residues.forEach((residue) => {
    const key = residueIdentityKey(
      residue.identity.chainId,
      residue.identity.sequenceNumber,
      residue.identity.insertionCode,
    )
    residueByIdentity.set(key, residue)
  })
  for (const record of disulfides) {
    const leftResidue = residueByIdentity.get(
      residueIdentityKey(record.left.chainId, record.left.sequenceNumber, record.left.insertionCode),
    )
    const rightResidue = residueByIdentity.get(
      residueIdentityKey(record.right.chainId, record.right.sequenceNumber, record.right.insertionCode),
    )
    const left = leftResidue?.atomIndices.find((index) => atoms[index].name === "SG")
    const right = rightResidue?.atomIndices.find((index) => atoms[index].name === "SG")
    if (left === undefined || right === undefined) {
      warnings.push("An SSBOND record could not be resolved to both CYS SG atoms")
      continue
    }
    addBond(bonds, seenBonds, atoms, left, right, "ssbond", "disulfide")
  }
  if (options.inferBonds !== false) {
    for (const [left, right] of inferDistanceBonds(atoms, residues)) {
      addBond(bonds, seenBonds, atoms, left, right, "distance-inference")
    }
  }

  let radiusSquared = 0
  for (const frame of frames) {
    for (let offset = 0; offset < frame.positions.length; offset += 3) {
      const squared =
        frame.positions[offset] ** 2 + frame.positions[offset + 1] ** 2 + frame.positions[offset + 2] ** 2
      radiusSquared = Math.max(radiusSquared, squared)
    }
  }
  const title = options.title?.trim() || titleParts.filter(Boolean).join(" ").trim() || id
  return {
    id,
    title,
    format: "pdb",
    atoms,
    residues,
    chains,
    bonds,
    frames,
    ligands: makeLigands(residues, atoms),
    center,
    radius: Math.sqrt(radiusSquared),
    bFactorSemantics: options.bFactorSemantics ?? detectBFactorSemantics(id, title),
    warnings,
  }
}
