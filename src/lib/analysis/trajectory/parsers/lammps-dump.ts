/**
 * LAMMPS `dump` parser (custom/atom style, text format).
 *
 * Recognises the following column names: id type element x y z xs ys zs xu yu zu
 *   fx fy fz vx vy vz. Element column may be a symbol ("element") or atom-type
 *   integer ("type") — when only `type` is present we name atoms "T1", "T2" etc.
 *
 * Box BOUNDS support: orthogonal (xlo xhi) and triclinic (xlo xhi xy etc.).
 */

import type { XYZAtom, XYZFrame } from '../../../crystal/xyz-parser'
import type { ParseResult, TrajectoryFrameMetadata } from '../types'

type Vec3 = [number, number, number]

interface LammpsBox {
  origin: Vec3
  a: Vec3
  b: Vec3
  c: Vec3
  triclinic: boolean
}

function parseOrthoBox(boundsLines: string[]): LammpsBox {
  // 3 lines: xlo xhi, ylo yhi, zlo zhi
  const parsed = boundsLines.map((l) => l.trim().split(/\s+/).map(Number))
  const [xlo, xhi] = parsed[0]
  const [ylo, yhi] = parsed[1]
  const [zlo, zhi] = parsed[2]
  return {
    origin: [xlo, ylo, zlo],
    a: [xhi - xlo, 0, 0],
    b: [0, yhi - ylo, 0],
    c: [0, 0, zhi - zlo],
    triclinic: false,
  }
}

function parseTriclinicBox(boundsLines: string[]): LammpsBox {
  // 3 lines: xlo_bound xhi_bound xy, ylo_bound yhi_bound xz, zlo zhi yz
  const p = boundsLines.map((l) => l.trim().split(/\s+/).map(Number))
  const [xloB, xhiB, xy] = p[0]
  const [yloB, yhiB, xz] = p[1]
  const [zlo, zhi, yz] = p[2]
  // Convert "bound" form back to true xlo/xhi/etc.
  const xlo = xloB - Math.min(0, xy, xz, xy + xz)
  const xhi = xhiB - Math.max(0, xy, xz, xy + xz)
  const ylo = yloB - Math.min(0, yz)
  const yhi = yhiB - Math.max(0, yz)
  return {
    origin: [xlo, ylo, zlo],
    a: [xhi - xlo, 0, 0],
    b: [xy, yhi - ylo, 0],
    c: [xz, yz, zhi - zlo],
    triclinic: true,
  }
}

function scaledToCart(scaled: Vec3, box: LammpsBox): Vec3 {
  // For LAMMPS "xs/ys/zs" scaled coords:
  //   x = xlo + xs*(xhi-xlo) + ys*xy + zs*xz  (triclinic)
  //   x = xlo + xs*(xhi-xlo)                  (ortho)
  return [
    box.origin[0] + scaled[0] * box.a[0] + scaled[1] * box.b[0] + scaled[2] * box.c[0],
    box.origin[1] + scaled[0] * box.a[1] + scaled[1] * box.b[1] + scaled[2] * box.c[1],
    box.origin[2] + scaled[0] * box.a[2] + scaled[1] * box.b[2] + scaled[2] * box.c[2],
  ]
}

function elementForType(t: number, map: Map<number, string> | null): string {
  if (map && map.has(t)) return map.get(t)!
  return `T${t}`
}

export function parseLammpsDump(
  content: string,
  filename?: string,
  options?: { type_map?: Record<number, string> },
): ParseResult {
  try {
    const lines = content.split(/\r?\n/)
    const typeMap = options?.type_map
      ? new Map(Object.entries(options.type_map).map(([k, v]) => [parseInt(k, 10), v]))
      : null

    const frames: XYZFrame[] = []
    const metadata: TrajectoryFrameMetadata[] = []
    let hasForces = false

    let cursor = 0
    while (cursor < lines.length) {
      const line = lines[cursor]?.trim()
      if (!line) { cursor++; continue }
      if (!line.startsWith('ITEM: TIMESTEP')) { cursor++; continue }

      cursor++
      const stepParsed = parseInt(lines[cursor]?.trim() ?? '', 10)
      const step = Number.isFinite(stepParsed) ? stepParsed : frames.length + 1
      cursor++

      // ITEM: NUMBER OF ATOMS
      if (!lines[cursor]?.startsWith('ITEM: NUMBER OF ATOMS')) {
        throw new Error(`LAMMPS dump: expected NUMBER OF ATOMS header at line ${cursor + 1}`)
      }
      cursor++
      const nAtoms = parseInt(lines[cursor]?.trim() ?? '0', 10)
      if (!Number.isFinite(nAtoms) || nAtoms <= 0) {
        throw new Error('LAMMPS dump: invalid atom count')
      }
      cursor++

      // ITEM: BOX BOUNDS [xy xz yz] periodicity
      const boxHeader = lines[cursor]?.trim() ?? ''
      if (!boxHeader.startsWith('ITEM: BOX BOUNDS')) {
        throw new Error(`LAMMPS dump: expected BOX BOUNDS header at line ${cursor + 1}`)
      }
      const isTriclinic = boxHeader.includes('xy xz yz')
      cursor++
      const boundsLines = [lines[cursor++], lines[cursor++], lines[cursor++]]
      const box = isTriclinic ? parseTriclinicBox(boundsLines) : parseOrthoBox(boundsLines)

      // ITEM: ATOMS <col1> <col2> ...
      const colHeader = lines[cursor]?.trim() ?? ''
      if (!colHeader.startsWith('ITEM: ATOMS')) {
        throw new Error(`LAMMPS dump: expected ATOMS header at line ${cursor + 1}`)
      }
      cursor++
      const cols = colHeader.replace('ITEM: ATOMS', '').trim().split(/\s+/)
      const indexOf = (name: string) => cols.indexOf(name)

      const ixs = indexOf('xs'), iys = indexOf('ys'), izs = indexOf('zs')
      const ix = indexOf('x'), iy = indexOf('y'), iz = indexOf('z')
      const ixu = indexOf('xu'), iyu = indexOf('yu'), izu = indexOf('zu')
      const iElement = indexOf('element')
      const iType = indexOf('type')
      const iFx = indexOf('fx'), iFy = indexOf('fy'), iFz = indexOf('fz')

      const useScaled = ixs >= 0 && iys >= 0 && izs >= 0
      const useUnwrapped = ixu >= 0 && iyu >= 0 && izu >= 0
      const useDirect = ix >= 0 && iy >= 0 && iz >= 0
      if (!useScaled && !useUnwrapped && !useDirect) {
        throw new Error('LAMMPS dump: no recognized coordinate columns (need x/y/z, xs/ys/zs, or xu/yu/zu)')
      }

      const atoms: XYZAtom[] = []
      let sumF2 = 0
      let maxF = 0
      let frameHasForce = false

      for (let i = 0; i < nAtoms; i++, cursor++) {
        const row = lines[cursor]?.trim().split(/\s+/)
        if (!row || row.length < cols.length) {
          throw new Error(`LAMMPS dump: short atom row at line ${cursor + 1}`)
        }
        let element = ''
        if (iElement >= 0) element = row[iElement]
        else if (iType >= 0) element = elementForType(parseInt(row[iType], 10), typeMap)
        else element = 'X'

        let cart: Vec3
        if (useScaled) {
          const scaled: Vec3 = [parseFloat(row[ixs]), parseFloat(row[iys]), parseFloat(row[izs])]
          cart = scaledToCart(scaled, box)
        } else if (useUnwrapped) {
          cart = [parseFloat(row[ixu]), parseFloat(row[iyu]), parseFloat(row[izu])]
        } else {
          cart = [parseFloat(row[ix]), parseFloat(row[iy]), parseFloat(row[iz])]
        }

        if (iFx >= 0 && iFy >= 0 && iFz >= 0) {
          frameHasForce = true
          const fx = parseFloat(row[iFx])
          const fy = parseFloat(row[iFy])
          const fz = parseFloat(row[iFz])
          const f2 = fx * fx + fy * fy + fz * fz
          sumF2 += f2
          const fmag = Math.sqrt(f2)
          if (fmag > maxF) maxF = fmag
        }

        atoms.push({
          id: `lammps-${frames.length}-${i}`,
          element,
          position: [0, 0, 0],
          cartesian: cart,
        })
      }

      const meta: TrajectoryFrameMetadata = {
        frame: frames.length + 1,
        step,
      }
      if (frameHasForce && nAtoms > 0) {
        hasForces = true
        meta.rms_force = Math.sqrt(sumF2 / nAtoms)
        meta.max_force = maxF
      }
      frames.push({
        atoms,
        comment: `LAMMPS step ${step}`,
        latticeVectors: { a: box.a, b: box.b, c: box.c },
      })
      metadata.push(meta)
    }

    if (frames.length === 0) return { success: false, error: 'No frames found in LAMMPS dump' }

    return {
      success: true,
      data: {
        format: 'lammps_dump',
        frames,
        metadata,
        source: filename,
        stats: {
          has_energy: false,
          has_forces: hasForces,
          has_stress: false,
          constant_atom_count: frames.every((f) => f.atoms.length === frames[0].atoms.length),
        },
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'LAMMPS dump parse failed' }
  }
}
