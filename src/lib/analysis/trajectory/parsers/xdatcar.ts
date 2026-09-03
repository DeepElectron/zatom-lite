/**
 * VASP XDATCAR parser.
 *
 * Format:
 *   line 1: title
 *   line 2: scale factor
 *   line 3-5: lattice vectors (Å)
 *   line 6: element symbols (e.g. "Si O")
 *   line 7: element counts (e.g. "8 16")
 *   line 8: blank or "Direct configuration=    1"
 *   subsequent: N rows of fractional coords per frame, prefixed by config header
 *
 * NPT runs (variable cell) repeat the header (lines 1-7) before each frame —
 * we detect this by looking for a non-numeric line after consuming coords.
 */

import type { XYZAtom, XYZFrame } from '../../../crystal/xyz-parser'
import type { ParseResult, TrajectoryFrameMetadata } from '../types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

function scaleMat(m: Mat3, s: number): Mat3 {
  return m.map((row) => row.map((v) => v * s) as Vec3) as Mat3
}

function readMatrix(lines: string[], start: number): Mat3 {
  const m: Vec3[] = []
  for (let i = 0; i < 3; i++) {
    const parts = lines[start + i].trim().split(/\s+/).map(Number)
    if (parts.length < 3 || parts.some(isNaN)) throw new Error(`XDATCAR: bad lattice row at line ${start + i + 1}`)
    m.push([parts[0], parts[1], parts[2]])
  }
  return m as Mat3
}

function fracToCart(frac: Vec3, lattice: Mat3): Vec3 {
  // XDATCAR lattice rows are basis vectors. Cartesian = frac · lattice (row-major).
  return [
    frac[0] * lattice[0][0] + frac[1] * lattice[1][0] + frac[2] * lattice[2][0],
    frac[0] * lattice[0][1] + frac[1] * lattice[1][1] + frac[2] * lattice[2][1],
    frac[0] * lattice[0][2] + frac[1] * lattice[1][2] + frac[2] * lattice[2][2],
  ]
}

function volumeOf(lattice: Mat3): number {
  const [a, b, c] = lattice
  return Math.abs(
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]),
  )
}

function looksLikeRepeatedHeader(lines: string[], cursor: number): boolean {
  return Boolean(lines[cursor + 1] && /^[\s-]*\d/.test(lines[cursor + 1]))
}

export function parseXdatcar(content: string, filename?: string): ParseResult {
  try {
    const lines = content.split(/\r?\n/)
    if (lines.length < 8) return { success: false, error: 'XDATCAR file too short' }

    let cursor = 0
    let lattice: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    let elements: string[] = []
    let counts: number[] = []
    let speciesPerAtom: string[] = []

    const readHeader = (): void => {
      cursor += 1 // title
      const scale = parseFloat(lines[cursor++].trim())
      if (isNaN(scale)) throw new Error('XDATCAR: bad scale factor')
      const rawLattice = readMatrix(lines, cursor)
      cursor += 3
      lattice = scaleMat(rawLattice, scale)
      elements = lines[cursor++].trim().split(/\s+/)
      counts = lines[cursor++].trim().split(/\s+/).map((n) => parseInt(n, 10))
      if (elements.length !== counts.length || counts.some((c) => !Number.isFinite(c))) {
        throw new Error('XDATCAR: element / count mismatch')
      }
      speciesPerAtom = elements.flatMap((el, i) => Array(counts[i]).fill(el))
    }

    readHeader()
    const totalAtoms = speciesPerAtom.length

    const frames: XYZFrame[] = []
    const metadata: TrajectoryFrameMetadata[] = []

    while (cursor < lines.length) {
      const line = lines[cursor]?.trim() ?? ''
      if (!line) { cursor++; continue }

      if (/^Direct\s+configuration\s*=/i.test(line)) {
        const match = line.match(/configuration\s*=\s*(\d+)/i)
        const step = match ? parseInt(match[1], 10) : frames.length + 1
        cursor++
        const atoms: XYZAtom[] = []
        for (let i = 0; i < totalAtoms; i++, cursor++) {
          const row = lines[cursor]?.trim().split(/\s+/).map(Number)
          if (!row || row.length < 3 || row.some(isNaN)) {
            throw new Error(`XDATCAR: bad coord row at line ${cursor + 1}`)
          }
          const frac: Vec3 = [row[0], row[1], row[2]]
          const cart = fracToCart(frac, lattice)
          atoms.push({
            id: `xdatcar-${frames.length}-${i}`,
            element: speciesPerAtom[i],
            position: frac,
            cartesian: cart,
          })
        }
        frames.push({
          atoms,
          comment: line,
          latticeVectors: { a: lattice[0], b: lattice[1], c: lattice[2] },
        })
        metadata.push({ frame: frames.length, step, volume: volumeOf(lattice) })
        continue
      }

    // NPT: header repeats. Title line is followed by scale on the next line —
    // detect by looking at the next line.
      if (looksLikeRepeatedHeader(lines, cursor)) {
        readHeader()
        continue
      }

      // Unrecognized line — skip.
      cursor++
    }

    if (frames.length === 0) return { success: false, error: 'No frames found in XDATCAR' }

    return {
      success: true,
      data: {
        format: 'vasp_xdatcar',
        frames,
        metadata,
        source: filename,
        stats: {
          has_energy: false,
          has_forces: false,
          has_stress: false,
          constant_atom_count: true,
        },
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'XDATCAR parse failed' }
  }
}
