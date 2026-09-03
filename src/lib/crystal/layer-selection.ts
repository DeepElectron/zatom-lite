import type { Atom, SupercellParams } from './types'

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: '(' | ')' | '>' | '<' | '>=' | '<=' }

type Mask = boolean[]

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const input = source.trim()
  let offset = 0
  while (offset < input.length) {
    const character = input[offset]
    if (/\s/.test(character)) { offset += 1; continue }
    if (character === '(' || character === ')') {
      tokens.push({ kind: 'op', value: character })
      offset += 1
      continue
    }
    if (character === '>' || character === '<') {
      const pair = input.slice(offset, offset + 2)
      if (pair === '>=' || pair === '<=') { tokens.push({ kind: 'op', value: pair }); offset += 2 }
      else { tokens.push({ kind: 'op', value: character }); offset += 1 }
      continue
    }
    const numeric = /^-?\d+(?:\.\d+)?/.exec(input.slice(offset))
    if (numeric && !/[a-z+\-]/i.test(input[offset + numeric[0].length] ?? '')) {
      tokens.push({ kind: 'number', value: Number.parseFloat(numeric[0]) })
      offset += numeric[0].length
      continue
    }
    const word = /^[A-Za-z0-9+\-_.]+/.exec(input.slice(offset))
    if (word) { tokens.push({ kind: 'word', value: word[0] }); offset += word[0].length; continue }
    throw new Error(`Unrecognized selection character: ${character}`)
  }
  return tokens
}

function integerRanges(argument: string, keyword: string): readonly [number, number][] {
  return argument.split('+').map((part) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!match) throw new Error(`${keyword} expects a range/list such as 0-40+100`)
    const left = Number.parseInt(match[1], 10)
    const right = match[2] === undefined ? left : Number.parseInt(match[2], 10)
    return [Math.min(left, right), Math.max(left, right)]
  })
}

function compressIntegerIndices(indices: readonly number[]): string {
  if (indices.length === 0) return ''
  const ranges: string[] = []
  let start = indices[0]
  let end = start
  for (let offset = 1; offset < indices.length; offset += 1) {
    const value = indices[offset]
    if (value === end + 1) {
      end = value
      continue
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`)
    start = value
    end = value
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`)
  return ranges.join('+')
}

/** Serialize an exact screen atom selection into the canonical crystal DSL. */
export function crystalAtomIdsToSelectionExpression(
  atoms: readonly Atom[],
  selectedAtomIds: ReadonlySet<string>,
): string {
  const indices: number[] = []
  const matchedIds = new Set<string>()
  atoms.forEach((atom, index) => {
    if (!selectedAtomIds.has(atom.id)) return
    indices.push(index)
    matchedIds.add(atom.id)
  })
  if (matchedIds.size !== selectedAtomIds.size) {
    throw new Error('The 3D selection no longer belongs to the active structure')
  }
  return indices.length === 0 ? 'none' : `index ${compressIntegerIndices(indices)}`
}

/** Source crystal-layer DSL over the currently materialized supercell atoms. */
class Parser {
  private position = 0
  private readonly tokens: readonly Token[]
  private readonly atoms: readonly Atom[]
  private readonly supercell: SupercellParams

  constructor(
    tokens: readonly Token[],
    atoms: readonly Atom[],
    supercell: SupercellParams,
  ) {
    this.tokens = tokens
    this.atoms = atoms
    this.supercell = supercell
  }

  parse(): Mask {
    const result = this.parseOr()
    if (this.peek()) throw new Error(`Unexpected token: ${this.describe(this.peek()!)}`)
    return result
  }

  private peek(): Token | undefined { return this.tokens[this.position] }
  private next(): Token | undefined { return this.tokens[this.position++] }
  private isWord(token: Token | undefined, value: string): boolean { return token?.kind === 'word' && token.value.toLowerCase() === value }
  private describe(token: Token): string { return token.kind === 'number' ? String(token.value) : token.value }

  private parseOr(): Mask {
    let left = this.parseAnd()
    while (this.isWord(this.peek(), 'or')) { this.next(); const right = this.parseAnd(); left = left.map((value, index) => value || right[index]) }
    return this.postfix(left)
  }

  private parseAnd(): Mask {
    let left = this.parseUnary()
    while (this.isWord(this.peek(), 'and')) { this.next(); const right = this.parseUnary(); left = left.map((value, index) => value && right[index]) }
    return left
  }

  private parseUnary(): Mask {
    if (this.isWord(this.peek(), 'not')) { this.next(); return this.parseUnary().map((value) => !value) }
    return this.postfix(this.parsePrimary())
  }

  private postfix(seed: Mask): Mask {
    let result = seed
    while (this.isWord(this.peek(), 'around') || this.isWord(this.peek(), 'expand')) {
      const operation = (this.next() as { kind: 'word'; value: string }).value.toLowerCase()
      const distance = this.next()
      if (distance?.kind !== 'number' || distance.value < 0) throw new Error(`${operation} expects a non-negative distance in Å`)
      const nearby = this.withinDistance(result, distance.value)
      result = operation === 'around' ? nearby.map((value, index) => value && !result[index]) : nearby.map((value, index) => value || result[index])
    }
    return result
  }

  private parsePrimary(): Mask {
    const token = this.next()
    if (!token) throw new Error('Selection expression ended unexpectedly')
    if (token.kind === 'op' && token.value === '(') {
      const result = this.parseOr()
      const close = this.next()
      if (close?.kind !== 'op' || close.value !== ')') throw new Error('Missing closing parenthesis')
      return result
    }
    if (token.kind !== 'word') throw new Error(`Unexpected token: ${this.describe(token)}`)
    const keyword = token.value.toLowerCase()
    if (keyword === 'all') return new Array(this.atoms.length).fill(true)
    if (keyword === 'none') return new Array(this.atoms.length).fill(false)
    if (keyword === 'elem') {
      const elements = new Set(this.wordArgument().toUpperCase().split('+'))
      return this.atoms.map((atom) => elements.has(atom.element.toUpperCase()))
    }
    if (keyword === 'site' || keyword === 'index') {
      const ranges = integerRanges(this.wordArgument(), keyword)
      return this.atoms.map((atom, index) => {
        const value = keyword === 'site' ? (atom.siteIndex ?? index) : index
        return ranges.some(([minimum, maximum]) => value >= minimum && value <= maximum)
      })
    }
    if (['fx', 'fy', 'fz', 'x', 'y', 'z'].includes(keyword)) {
      const values = this.atoms.map((atom) => {
        if (keyword[0] === 'f') {
          const axis = { fx: 0, fy: 1, fz: 2 }[keyword]!
          const multiplier = [this.supercell.nx, this.supercell.ny, this.supercell.nz][axis]
          return atom.position[axis] * multiplier
        }
        const axis = { x: 0, y: 1, z: 2 }[keyword]!
        return (atom.cartesian ?? atom.position)[axis]
      })
      return this.numericComparison(values)
    }
    throw new Error(`Unknown crystal selection keyword: ${keyword}`)
  }

  private wordArgument(): string {
    const token = this.next()
    if (!token) throw new Error('Missing selection argument')
    return token.kind === 'word' ? token.value : String(token.value)
  }

  private numericComparison(values: readonly number[]): Mask {
    const operation = this.next()
    const value = this.next()
    if (operation?.kind !== 'op' || operation.value === '(' || operation.value === ')') throw new Error('Coordinate keyword expects >, <, >=, or <=')
    if (value?.kind !== 'number') throw new Error('Coordinate comparison expects a number')
    if (operation.value === '>') return values.map((entry) => entry > value.value)
    if (operation.value === '<') return values.map((entry) => entry < value.value)
    if (operation.value === '>=') return values.map((entry) => entry >= value.value)
    return values.map((entry) => entry <= value.value)
  }

  private withinDistance(seed: readonly boolean[], distance: number): Mask {
    const output = new Array(this.atoms.length).fill(false)
    if (!seed.some(Boolean)) return output
    const cellSize = Math.max(distance, 2)
    const grid = new Map<string, number[]>()
    const point = (atom: Atom) => atom.cartesian ?? atom.position
    const key = (position: readonly number[]) => `${Math.floor(position[0] / cellSize)},${Math.floor(position[1] / cellSize)},${Math.floor(position[2] / cellSize)}`
    this.atoms.forEach((atom, index) => {
      if (!seed[index]) return
      const bucketKey = key(point(atom)); const bucket = grid.get(bucketKey)
      if (bucket) bucket.push(index); else grid.set(bucketKey, [index])
    })
    const limit = distance * distance
    this.atoms.forEach((atom, index) => {
      const position = point(atom); const gx = Math.floor(position[0] / cellSize); const gy = Math.floor(position[1] / cellSize); const gz = Math.floor(position[2] / cellSize)
      search: for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        for (const otherIndex of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
          const other = point(this.atoms[otherIndex])
          if ((position[0] - other[0]) ** 2 + (position[1] - other[1]) ** 2 + (position[2] - other[2]) ** 2 <= limit) { output[index] = true; break search }
        }
      }
    })
    return output
  }
}

export interface CrystalLayerSelectionResult {
  atomIds: ReadonlySet<string>
  error: string | null
}

export interface CrystalLayerSelectionPreset {
  name: string
  expression: string
  description: string
  recommendedRepresentation?: 'polyhedra'
}

export interface CrystalLayerSelectionPresetGroup {
  name: string
  items: CrystalLayerSelectionPreset[]
}

const ALKALI = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr'])
const ALKALINE_EARTH = new Set(['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra'])
const TRANSITION_METALS = new Set([
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
  'La', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Th', 'U',
])
const POST_TRANSITION_METALS = new Set(['Al', 'Ga', 'In', 'Sn', 'Tl', 'Pb', 'Bi'])
const METALLOIDS = new Set(['B', 'Si', 'Ge', 'As', 'Sb', 'Te'])
const HALOGENS = new Set(['F', 'Cl', 'Br', 'I', 'At'])
const CHALCOGENS = new Set(['O', 'S', 'Se'])
const ALL_METALS = new Set([
  ...ALKALI,
  ...ALKALINE_EARTH,
  ...TRANSITION_METALS,
  ...POST_TRANSITION_METALS,
])

/** Source-compatible, structure-aware one-click presets for crystal layers. */
export function buildCrystalLayerSelectionPresetGroups(
  atoms: readonly Atom[],
): CrystalLayerSelectionPresetGroup[] {
  const counts = new Map<string, number>()
  for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
  const elements = [...counts.keys()]
  const present = (category: ReadonlySet<string>) => elements.filter((element) => category.has(element))
  const expression = (selected: readonly string[]) => `elem ${selected.join('+')}`
  const groups: CrystalLayerSelectionPresetGroup[] = []

  const categories: readonly [string, ReadonlySet<string>, string][] = [
    ['Transition metals', TRANSITION_METALS, 'd/f-block metals'],
    ['Alkali metals', ALKALI, 'group 1'],
    ['Alkaline earths', ALKALINE_EARTH, 'group 2'],
    ['Post-transition metals', POST_TRANSITION_METALS, 'p-block metals'],
    ['Metalloids', METALLOIDS, 'semimetals'],
    ['Halogens', HALOGENS, 'group 17'],
    ['Chalcogens', CHALCOGENS, 'group 16'],
  ]
  const categoryItems: CrystalLayerSelectionPreset[] = []
  for (const [name, category, description] of categories) {
    const hit = present(category)
    if (hit.length === 0) continue
    const count = hit.reduce((sum, element) => sum + (counts.get(element) ?? 0), 0)
    categoryItems.push({
      name,
      expression: expression(hit),
      description: `${description}: ${hit.join(', ')} (${count} atoms)`,
    })
  }
  const metals = present(ALL_METALS)
  const nonmetals = elements.filter((element) => !ALL_METALS.has(element))
  if (metals.length > 0 && nonmetals.length > 0) {
    categoryItems.push(
      { name: 'All metals', expression: expression(metals), description: `Metal sublattice: ${metals.join(', ')}` },
      { name: 'All nonmetals', expression: expression(nonmetals), description: `Anion/covalent sublattice: ${nonmetals.join(', ')}` },
    )
  }
  if (categoryItems.length > 0) groups.push({ name: 'Element classes', items: categoryItems })

  const coordinationCenters = elements
    .filter((element) => ALL_METALS.has(element) || METALLOIDS.has(element))
    .sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0))
    .slice(0, 6)
  if (coordinationCenters.length > 0) {
    groups.push({
      name: 'Coordination environments',
      items: coordinationCenters.map((element) => ({
        name: `${element} shell`,
        expression: `elem ${element} expand 2.6`,
        description: `${element} centres and neighbours within 2.6 Å (${counts.get(element)} centres)`,
        recommendedRepresentation: 'polyhedra',
      })),
    })
  }

  const hasCarbon = counts.has('C')
  const hasHydrogen = counts.has('H')
  if (hasCarbon && (hasHydrogen || counts.has('N'))) {
    const heteroatoms = elements.filter((element) => element !== 'C' && element !== 'H')
    const items: CrystalLayerSelectionPreset[] = [{
      name: 'Carbon skeleton', expression: 'elem C', description: `All carbon atoms (${counts.get('C')})`,
    }]
    if (heteroatoms.length > 0) items.push({
      name: 'Heteroatoms', expression: expression(heteroatoms), description: `Non-C/H atoms: ${heteroatoms.join(', ')}`,
    })
    if (hasHydrogen) items.push({ name: 'Heavy atoms', expression: 'not elem H', description: 'Hydrogen-free skeleton' })
    groups.push({ name: 'Molecular crystal', items })
  }

  groups.push({
    name: 'Spatial slices',
    items: [
      { name: 'Upper half-cell', expression: 'fz > 0.5', description: 'Fractional z > 0.5' },
      { name: 'Lower half-cell', expression: 'fz <= 0.5', description: 'Fractional z ≤ 0.5' },
    ],
  })
  return groups
}

export function evaluateCrystalLayerSelectionDsl(atoms: readonly Atom[], expression: string, supercell: SupercellParams): CrystalLayerSelectionResult {
  if (!expression.trim()) return { atomIds: new Set(), error: null }
  try {
    const mask = new Parser(tokenize(expression), atoms, supercell).parse()
    return { atomIds: new Set(atoms.flatMap((atom, index) => mask[index] ? [atom.id] : [])), error: null }
  } catch (error) {
    return { atomIds: new Set(), error: error instanceof Error ? error.message : 'Invalid crystal selection' }
  }
}
