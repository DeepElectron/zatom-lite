// Build the paper-3 GaN m-plane slab using the PLATFORM's OWN modeler builder
// (buildSlabFromMiller — the exact code the modeler UI calls), NOT pymatgen.
// Emits the slab as JSON (atoms + lattice) parsed from the builder's ext-XYZ.
import { buildSlabFromMiller, type SlabAtomInput } from '../lib/analysis/builders/slab'

type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
]

// wurtzite GaN base cell (a=3.19, c=5.19 Å, u=0.377): row-vector lattice + cartesian atoms.
const a = 3.19
const c = 5.19
const lattice: Mat3 = [
  [a, 0, 0],
  [-a / 2, (a * Math.sqrt(3)) / 2, 0],
  [0, 0, c],
]
const atoms: SlabAtomInput[] = [
  { element: 'Ga', cartesian: [0, a / Math.sqrt(3), 0] },
  { element: 'Ga', cartesian: [a / 2, a / (2 * Math.sqrt(3)), c / 2] },
  { element: 'N', cartesian: [0, a / Math.sqrt(3), 0.377 * c] },
  { element: 'N', cartesian: [a / 2, a / (2 * Math.sqrt(3)), (0.5 + 0.377) * c] },
]

// m-plane (10-10) → 3-index Miller (1,0,0) on the hexagonal lattice.
const res = buildSlabFromMiller({ lattice, atoms, h: 1, k: 0, l: 0, layers: 6, vacuum: 18, center: true })

// Parse the builder's extended-XYZ → {atoms:[{element,x,y,z}], latticeMatrix:[[...]]}
function parseExtXyz(xyz: string): { atoms: { element: string; x: number; y: number; z: number }[]; latticeMatrix: number[][] } {
  const lines = xyz.split(/\r?\n/)
  const n = parseInt(lines[0].trim(), 10)
  const m = lines[1].match(/Lattice="([^"]+)"/)
  const lat = (m ? m[1].trim().split(/\s+/).map(Number) : [])
  const latticeMatrix = [lat.slice(0, 3), lat.slice(3, 6), lat.slice(6, 9)]
  const out: { element: string; x: number; y: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const p = lines[2 + i].trim().split(/\s+/)
    out.push({ element: p[0], x: +p[1], y: +p[2], z: +p[3] })
  }
  return { atoms: out, latticeMatrix }
}

const parsed = parseExtXyz(res.xyz)
console.log('PLATFORM_BUILDER=buildSlabFromMiller')
console.log('N_ATOMS=' + res.n_atoms)
console.log('COMPOSITION=' + JSON.stringify(res.composition))
console.log('CELL=' + JSON.stringify(res.cellParams))
console.log('JSON_BEGIN')
console.log(JSON.stringify(parsed))
console.log('JSON_END')
