import {
  BIO_AMINO_ACIDS,
  BIO_HYDROPHOBICITY,
  BIO_NUCLEIC_BACKBONE_ATOMS,
  BIO_NUCLEOTIDES,
  BIO_PROTEIN_BACKBONE_ATOMS,
  BIO_WATER_RESIDUES,
} from "./constants"
import type { BioSelectionResult, BioStructure } from "./types"

type Token =
  | { kind: "word"; value: string; offset: number }
  | { kind: "string"; value: string; offset: number }
  | { kind: "number"; value: number; offset: number }
  | { kind: "operator"; value: "(" | ")" | ">" | "<" | ">=" | "<=" | "="; offset: number }

type Mask = boolean[]

interface BioSelectionIndex {
  residueOfAtom: number[]
  atomRanges: readonly (readonly number[])[]
  chain: string[]
  residueNumber: number[]
  insertionCode: string[]
  residueName: string[]
  atomName: string[]
  element: string[]
  bFactor: number[]
  occupancy: number[]
  polymer: boolean[]
  protein: boolean[]
  nucleic: boolean[]
  ligand: boolean[]
  ion: boolean[]
  water: boolean[]
  hetero: boolean[]
  backbone: boolean[]
  hydrophobic: boolean[]
  secondary: ("helix" | "sheet" | "coil")[]
}

const indexCache = new WeakMap<BioStructure, BioSelectionIndex>()

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  while (offset < source.length) {
    const char = source[offset]
    if (/\s/.test(char)) {
      offset += 1
      continue
    }
    if (char === "(" || char === ")" || char === "=" || char === ">" || char === "<") {
      const pair = source.slice(offset, offset + 2)
      if (pair === ">=" || pair === "<=") {
        tokens.push({ kind: "operator", value: pair, offset })
        offset += 2
      } else {
        tokens.push({ kind: "operator", value: char, offset })
        offset += 1
      }
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      const start = offset
      offset += 1
      let value = ""
      let closed = false
      while (offset < source.length) {
        const next = source[offset]
        if (next === "\\") {
          const escaped = source[offset + 1]
          if (escaped === undefined) break
          value += escaped
          offset += 2
          continue
        }
        if (next === quote) {
          closed = true
          offset += 1
          break
        }
        value += next
        offset += 1
      }
      if (!closed) throw new Error(`Unterminated quoted value at offset ${start}`)
      tokens.push({ kind: "string", value, offset: start })
      continue
    }
    const numeric = /^-?\d+(?:\.\d+)?/.exec(source.slice(offset))
    if (numeric && !/[A-Za-z_+\-]/.test(source[offset + numeric[0].length] ?? "")) {
      tokens.push({ kind: "number", value: Number(numeric[0]), offset })
      offset += numeric[0].length
      continue
    }
    const word = /^[A-Za-z0-9_*'.+\-]+/.exec(source.slice(offset))
    if (word) {
      tokens.push({ kind: "word", value: word[0], offset })
      offset += word[0].length
      continue
    }
    throw new Error(`Unexpected character ${JSON.stringify(char)} at offset ${offset}`)
  }
  return tokens
}

function buildIndex(structure: BioStructure): BioSelectionIndex {
  const cached = indexCache.get(structure)
  if (cached) return cached
  const count = structure.atoms.length
  const index: BioSelectionIndex = {
    residueOfAtom: new Array(count),
    atomRanges: structure.residues.map((residue) => residue.atomIndices),
    chain: new Array(count),
    residueNumber: new Array(count),
    insertionCode: new Array(count),
    residueName: new Array(count),
    atomName: new Array(count),
    element: new Array(count),
    bFactor: new Array(count),
    occupancy: new Array(count),
    polymer: new Array(count).fill(false),
    protein: new Array(count).fill(false),
    nucleic: new Array(count).fill(false),
    ligand: new Array(count).fill(false),
    ion: new Array(count).fill(false),
    water: new Array(count).fill(false),
    hetero: new Array(count).fill(false),
    backbone: new Array(count).fill(false),
    hydrophobic: new Array(count).fill(false),
    secondary: new Array(count).fill("coil"),
  }
  for (const atom of structure.atoms) {
    const residue = structure.residues[atom.residueIndex]
    const name = residue.name.toUpperCase()
    const protein = BIO_AMINO_ACIDS.has(name)
    const nucleic = BIO_NUCLEOTIDES.has(name)
    const water = BIO_WATER_RESIDUES.has(name)
    const ligand = !residue.isStandard && !water && residue.atomIndices.length > 1
    const ion = !residue.isStandard && !water && residue.atomIndices.length === 1
    index.residueOfAtom[atom.index] = residue.index
    index.chain[atom.index] = residue.identity.chainId
    index.residueNumber[atom.index] = residue.identity.sequenceNumber
    index.insertionCode[atom.index] = residue.identity.insertionCode
    index.residueName[atom.index] = name
    index.atomName[atom.index] = atom.name.toUpperCase()
    index.element[atom.index] = atom.element.toUpperCase()
    index.bFactor[atom.index] = atom.bFactor
    index.occupancy[atom.index] = atom.occupancy
    index.polymer[atom.index] = residue.isStandard
    index.protein[atom.index] = protein
    index.nucleic[atom.index] = nucleic
    index.ligand[atom.index] = ligand
    index.ion[atom.index] = ion
    index.water[atom.index] = water
    index.hetero[atom.index] = atom.recordType === "HETATM"
    index.backbone[atom.index] =
      (protein && BIO_PROTEIN_BACKBONE_ATOMS.has(atom.name.toUpperCase())) ||
      (nucleic && BIO_NUCLEIC_BACKBONE_ATOMS.has(atom.name.toUpperCase()))
    index.hydrophobic[atom.index] = protein && (BIO_HYDROPHOBICITY[name] ?? 0) > 0
    index.secondary[atom.index] = residue.secondaryStructure
  }
  indexCache.set(structure, index)
  return index
}

function combine(left: Mask, right: Mask, operation: (a: boolean, b: boolean) => boolean): Mask {
  return left.map((value, index) => operation(value, right[index]))
}

function listValues(raw: string): Set<string> {
  return new Set(raw.split("+").map((value) => value.toUpperCase()))
}

function parseIntegerRanges(raw: string, keyword: string): [number, number][] {
  return raw.split("+").map((part) => {
    const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(part)
    if (!match) throw new Error(`Invalid ${keyword} range ${JSON.stringify(part)}`)
    const left = Number(match[1])
    const right = match[2] === undefined ? left : Number(match[2])
    return [Math.min(left, right), Math.max(left, right)]
  })
}

class Parser {
  private cursor = 0

  private readonly tokens: readonly Token[]

  private readonly structure: BioStructure

  private readonly index: BioSelectionIndex

  constructor(
    tokens: readonly Token[],
    structure: BioStructure,
    index: BioSelectionIndex,
  ) {
    this.tokens = tokens
    this.structure = structure
    this.index = index
  }

  parse(): Mask {
    const mask = this.parsePostfix(this.parseOr())
    const trailing = this.peek()
    if (trailing) throw new Error(`Unexpected token ${this.describe(trailing)} at offset ${trailing.offset}`)
    return mask
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor]
  }

  private take(): Token | undefined {
    return this.tokens[this.cursor++]
  }

  private wordIs(token: Token | undefined, value: string): boolean {
    return token?.kind === "word" && token.value.toLowerCase() === value
  }

  private describe(token: Token): string {
    return JSON.stringify(token.value)
  }

  private parseOr(): Mask {
    let result = this.parseAnd()
    while (this.wordIs(this.peek(), "or")) {
      this.take()
      result = combine(result, this.parseAnd(), (left, right) => left || right)
    }
    return result
  }

  private parseAnd(): Mask {
    let result = this.parseUnary()
    while (this.wordIs(this.peek(), "and")) {
      this.take()
      result = combine(result, this.parseUnary(), (left, right) => left && right)
    }
    return result
  }

  private parseUnary(): Mask {
    if (this.wordIs(this.peek(), "not")) {
      this.take()
      return this.parseUnary().map((value) => !value)
    }
    if (this.wordIs(this.peek(), "byres")) {
      this.take()
      return this.expandToResidues(this.parseUnary())
    }
    if (this.wordIs(this.peek(), "within")) {
      this.take()
      const distance = this.numberArgument("within")
      if (!this.wordIs(this.peek(), "of")) throw new Error("within requires the keyword 'of'")
      this.take()
      return this.withinDistance(this.parseUnary(), distance)
    }
    return this.parsePrimary()
  }

  private parsePostfix(initial: Mask): Mask {
    let result = initial
    for (;;) {
      const token = this.peek()
      if (!this.wordIs(token, "around") && !this.wordIs(token, "expand")) return result
      const operation = (this.take() as Extract<Token, { kind: "word" }>).value.toLowerCase()
      const distance = this.numberArgument(operation)
      const near = this.withinDistance(result, distance)
      result = operation === "around" ? near.map((value, index) => value && !result[index]) : near
    }
  }

  private parsePrimary(): Mask {
    const token = this.take()
    if (!token) throw new Error("Unexpected end of selection expression")
    if (token.kind === "operator" && token.value === "(") {
      const result = this.parsePostfix(this.parseOr())
      const close = this.take()
      if (close?.kind !== "operator" || close.value !== ")") throw new Error("Missing closing parenthesis")
      return result
    }
    if (token.kind !== "word") throw new Error(`Unexpected token ${this.describe(token)} at offset ${token.offset}`)
    const keyword = token.value.toLowerCase()
    const all = () => new Array(this.structure.atoms.length).fill(true)
    const none = () => new Array(this.structure.atoms.length).fill(false)
    switch (keyword) {
      case "all":
        return all()
      case "none":
        return none()
      case "polymer":
        return [...this.index.polymer]
      case "protein":
        return [...this.index.protein]
      case "nucleic":
        return [...this.index.nucleic]
      case "ligand":
        return [...this.index.ligand]
      case "ion":
        return [...this.index.ion]
      case "water":
        return [...this.index.water]
      case "het":
        return [...this.index.hetero]
      case "backbone":
        return [...this.index.backbone]
      case "sidechain":
        return this.index.polymer.map((polymer, index) => polymer && !this.index.backbone[index])
      case "helix":
      case "sheet":
      case "coil":
      case "loop": {
        const desired = keyword === "loop" ? "coil" : keyword
        return this.index.secondary.map((secondary, index) => this.index.polymer[index] && secondary === desired)
      }
      case "hydrophobic":
        return [...this.index.hydrophobic]
      case "polar":
        return this.index.protein.map((protein, index) => protein && !this.index.hydrophobic[index])
      case "interface":
        return this.computeInterface(5)
      case "chain": {
        const value = this.valueArgument("chain")
        if (value === "blank") return this.index.chain.map((chain) => chain === "")
        const values = listValues(value)
        return this.index.chain.map((chain) => values.has(chain.toUpperCase()))
      }
      case "resi": {
        const ranges = parseIntegerRanges(this.valueArgument("resi"), "resi")
        return this.index.residueNumber.map((value) => ranges.some(([low, high]) => value >= low && value <= high))
      }
      case "icode": {
        const value = this.valueArgument("icode")
        if (value === "blank") return this.index.insertionCode.map((code) => code === "")
        const values = listValues(value)
        return this.index.insertionCode.map((code) => values.has(code.toUpperCase()))
      }
      case "resn": {
        const values = listValues(this.valueArgument("resn"))
        return this.index.residueName.map((value) => values.has(value))
      }
      case "name": {
        const values = listValues(this.valueArgument("name"))
        return this.index.atomName.map((value) => values.has(value))
      }
      case "element":
      case "elem": {
        const values = listValues(this.valueArgument(keyword))
        return this.index.element.map((value) => values.has(value))
      }
      case "index": {
        const ranges = parseIntegerRanges(this.valueArgument("index"), "index")
        return this.structure.atoms.map((atom) => ranges.some(([low, high]) => atom.index >= low && atom.index <= high))
      }
      case "bfactor":
      case "b":
        return this.numericComparison(this.index.bFactor, "bfactor")
      case "occupancy":
      case "q":
        return this.numericComparison(this.index.occupancy, "occupancy")
      default:
        throw new Error(`Unknown selection keyword ${JSON.stringify(token.value)}`)
    }
  }

  private valueArgument(keyword: string): string {
    const token = this.take()
    if (!token || (token.kind !== "word" && token.kind !== "string" && token.kind !== "number")) {
      throw new Error(`${keyword} requires a value`)
    }
    return String(token.value)
  }

  private numberArgument(keyword: string): number {
    const token = this.take()
    if (token?.kind !== "number" || token.value < 0) throw new Error(`${keyword} requires a non-negative distance`)
    return token.value
  }

  private numericComparison(values: readonly number[], keyword: string): Mask {
    const operator = this.take()
    const number = this.take()
    if (
      operator?.kind !== "operator" ||
      ![">", "<", ">=", "<=", "="].includes(operator.value) ||
      number?.kind !== "number"
    ) {
      throw new Error(`${keyword} requires a comparison such as '${keyword} >= 42'`)
    }
    switch (operator.value) {
      case ">":
        return values.map((value) => value > number.value)
      case "<":
        return values.map((value) => value < number.value)
      case ">=":
        return values.map((value) => value >= number.value)
      case "<=":
        return values.map((value) => value <= number.value)
      case "=":
        return values.map((value) => value === number.value)
    }
    throw new Error(`Unsupported comparison operator ${operator.value}`)
  }

  private withinDistance(seed: Mask, distance: number): Mask {
    const output = new Array(this.structure.atoms.length).fill(false)
    if (!seed.some(Boolean)) return output
    const cellSize = Math.max(distance, 1)
    const grid = new Map<string, number[]>()
    const key = (position: readonly number[]) =>
      `${Math.floor(position[0] / cellSize)},${Math.floor(position[1] / cellSize)},${Math.floor(position[2] / cellSize)}`
    this.structure.atoms.forEach((atom) => {
      if (!seed[atom.index]) return
      const cell = key(atom.position)
      const bucket = grid.get(cell)
      if (bucket) bucket.push(atom.index)
      else grid.set(cell, [atom.index])
    })
    const squaredLimit = distance ** 2
    for (const atom of this.structure.atoms) {
      const gx = Math.floor(atom.position[0] / cellSize)
      const gy = Math.floor(atom.position[1] / cellSize)
      const gz = Math.floor(atom.position[2] / cellSize)
      search: for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const seedIndex of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
              const other = this.structure.atoms[seedIndex]
              const squared =
                (atom.position[0] - other.position[0]) ** 2 +
                (atom.position[1] - other.position[1]) ** 2 +
                (atom.position[2] - other.position[2]) ** 2
              if (squared <= squaredLimit) {
                output[atom.index] = true
                break search
              }
            }
          }
        }
      }
    }
    return output
  }

  private expandToResidues(seed: Mask): Mask {
    const output = new Array(this.structure.atoms.length).fill(false)
    const residues = new Set<number>()
    seed.forEach((selected, atomIndex) => {
      if (selected) residues.add(this.index.residueOfAtom[atomIndex])
    })
    for (const residueIndex of residues) {
      for (const atomIndex of this.index.atomRanges[residueIndex] ?? []) output[atomIndex] = true
    }
    return output
  }

  private computeInterface(distance: number): Mask {
    const output = new Array(this.structure.atoms.length).fill(false)
    const chains = [...new Set(this.index.chain.filter((_, index) => this.index.polymer[index]))]
    if (chains.length < 2) return output
    for (const chain of chains) {
      const otherChains = this.index.chain.map(
        (candidate, index) => candidate !== chain && this.index.polymer[index],
      )
      const nearOther = this.withinDistance(otherChains, distance)
      for (let index = 0; index < output.length; index += 1) {
        if (this.index.chain[index] === chain && this.index.polymer[index] && nearOther[index]) output[index] = true
      }
    }
    return output
  }
}

export function evaluateBioSelection(structure: BioStructure, expression: string): BioSelectionResult {
  if (expression.trim() === "") return { atomIndices: new Set(), residueIndices: new Set(), error: null }
  try {
    const index = buildIndex(structure)
    const tokens = tokenize(expression)
    const mask = new Parser(tokens, structure, index).parse()
    const atomIndices = new Set<number>()
    const residueIndices = new Set<number>()
    mask.forEach((selected, atomIndex) => {
      if (!selected) return
      atomIndices.add(atomIndex)
      residueIndices.add(index.residueOfAtom[atomIndex])
    })
    return { atomIndices, residueIndices, error: null }
  } catch (error) {
    return {
      atomIndices: new Set(),
      residueIndices: new Set(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
