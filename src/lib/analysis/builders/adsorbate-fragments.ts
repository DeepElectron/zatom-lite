/**
 * Built-in adsorbate fragment templates.
 *
 * Each fragment lists its atoms with positions in a local coordinate frame
 * where:
 *   - the anchor atom (index `anchor`) is at the origin
 *   - the "up" direction (which will be aligned with the surface normal when
 *     the fragment is placed) is +z in the local frame
 *
 * Bond lengths and basic geometries are picked from standard textbook values.
 * Used by the Adsorbate Inspector tool for one-click molecule placement.
 */

import type { Vec3 } from './adsorbate-types'

export interface FragmentAtom {
  element: string
  /** Position relative to anchor, with +z pointing away from the surface. */
  pos: Vec3
}

export interface Fragment {
  /** Identifier (also used as key in the FRAGMENTS map). */
  id: string
  /** Display name in the UI. */
  label: string
  atoms: FragmentAtom[]
  /** Index of the anchor atom (typically the one bonded to the surface). */
  anchor: number
}

/** Built-in fragments. Anchor atom is at (0,0,0); +z points away from surface. */
export const FRAGMENTS: Record<string, Fragment> = {
  H: {
    id: 'H',
    label: 'H',
    anchor: 0,
    atoms: [{ element: 'H', pos: [0, 0, 0] }],
  },
  O: {
    id: 'O',
    label: 'O',
    anchor: 0,
    // Atomic oxygen — the *O intermediate of 4e ORR/OER.
    atoms: [{ element: 'O', pos: [0, 0, 0] }],
  },
  OH: {
    id: 'OH',
    label: 'OH',
    anchor: 0,
    atoms: [
      { element: 'O', pos: [0, 0, 0] },
      { element: 'H', pos: [0, 0, 0.97] },
    ],
  },
  OOH: {
    id: 'OOH',
    label: 'OOH',
    anchor: 0,
    // Hydroperoxyl — the *OOH intermediate of 4e ORR/OER. Anchor O bonds to the
    // surface; O–O 1.39 Å, O–H 0.96 Å, O–O–H ~106° (bent).
    atoms: [
      { element: 'O', pos: [0, 0, 0] },
      { element: 'O', pos: [0, 0, 1.39] },
      { element: 'H', pos: [0.92, 0, 1.65] },
    ],
  },
  H2O: {
    id: 'H2O',
    label: 'H2O',
    anchor: 0,
    atoms: [
      // O at origin; H-O-H angle 104.5°, OH bond 0.96 Å
      { element: 'O', pos: [0, 0, 0] },
      { element: 'H', pos: [0.7570, 0, 0.5859] },
      { element: 'H', pos: [-0.7570, 0, 0.5859] },
    ],
  },
  CO: {
    id: 'CO',
    label: 'CO',
    anchor: 0,
    atoms: [
      // C anchors to surface; O above. Bond length 1.13 Å.
      { element: 'C', pos: [0, 0, 0] },
      { element: 'O', pos: [0, 0, 1.13] },
    ],
  },
  CO2: {
    id: 'CO2',
    label: 'CO2',
    anchor: 0,
    atoms: [
      // Linear CO2; anchor on one O.
      { element: 'O', pos: [0, 0, 0] },
      { element: 'C', pos: [0, 0, 1.16] },
      { element: 'O', pos: [0, 0, 2.32] },
    ],
  },
  N2: {
    id: 'N2',
    label: 'N2',
    anchor: 0,
    atoms: [
      // Bond length 1.10 Å
      { element: 'N', pos: [0, 0, 0] },
      { element: 'N', pos: [0, 0, 1.10] },
    ],
  },
  NH3: {
    id: 'NH3',
    label: 'NH3',
    anchor: 0,
    atoms: [
      // Pyramidal; N–H 1.012 Å, H-N-H angle 106.7°
      { element: 'N', pos: [0, 0, 0] },
      // Place H atoms at angle ~67° from +z (so pyramid points up at surface)
      // Inverted: lone pair up (typical adsorbed orientation depends on site)
      { element: 'H', pos: [0.9377, 0, -0.3816] },
      { element: 'H', pos: [-0.4688, 0.8120, -0.3816] },
      { element: 'H', pos: [-0.4688, -0.8120, -0.3816] },
    ],
  },
  CH3: {
    id: 'CH3',
    label: 'CH3',
    anchor: 0,
    atoms: [
      // Pyramidal; C-H 1.09 Å. C anchors to surface, H atoms point up.
      { element: 'C', pos: [0, 0, 0] },
      { element: 'H', pos: [1.0287, 0, 0.3636] },
      { element: 'H', pos: [-0.5143, 0.8908, 0.3636] },
      { element: 'H', pos: [-0.5143, -0.8908, 0.3636] },
    ],
  },
}

export type FragmentKey = keyof typeof FRAGMENTS

/**
 * Convert a molecule-library fragment (Structure panel's FRAGMENT_TEMPLATES /
 * custom fragments) into an adsorbate Fragment.
 *
 * Library templates have an arbitrary orientation with atom 0 as the
 * attachment point. Adsorbate fragments require the anchor at the origin and
 * the molecular bulk pointing +z (away from the surface). We translate the
 * anchor to the origin, then rotate so the anchor→centroid(rest) direction
 * aligns with +z. Single-atom fragments need no rotation.
 */
export function fragmentFromLibrary(
  id: string,
  label: string,
  atoms: Array<{ element: string; position: [number, number, number] }>,
): Fragment {
  const anchor = atoms[0]
  const translated = atoms.map((a) => ({
    element: a.element,
    pos: [
      a.position[0] - anchor.position[0],
      a.position[1] - anchor.position[1],
      a.position[2] - anchor.position[2],
    ] as Vec3,
  }))
  if (translated.length > 1) {
    // Direction from anchor to the centroid of the remaining atoms.
    let cx = 0, cy = 0, cz = 0
    for (let i = 1; i < translated.length; i++) {
      cx += translated[i].pos[0]
      cy += translated[i].pos[1]
      cz += translated[i].pos[2]
    }
    const n = translated.length - 1
    cx /= n; cy /= n; cz /= n
    const len = Math.hypot(cx, cy, cz)
    if (len > 1e-6) {
      // Rodrigues rotation taking unit(a) → +z.
      const ax = cx / len, ay = cy / len, az = cz / len
      const dot = az  // a · (0,0,1)
      if (dot < 1 - 1e-9) {
        // Rotation axis = a × z = (ay, -ax, 0); handle antiparallel case.
        let kx = ay, ky = -ax, kz = 0
        const kLen = Math.hypot(kx, ky, kz)
        if (kLen < 1e-9) { kx = 1; ky = 0; kz = 0 }
        else { kx /= kLen; ky /= kLen; kz /= kLen }
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
        const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
        for (const a of translated) {
          const [x, y, z] = a.pos
          a.pos = [
            (t * kx * kx + c) * x + (t * kx * ky - s * kz) * y + (t * kx * kz + s * ky) * z,
            (t * kx * ky + s * kz) * x + (t * ky * ky + c) * y + (t * ky * kz - s * kx) * z,
            (t * kx * kz - s * ky) * x + (t * ky * kz + s * kx) * y + (t * kz * kz + c) * z,
          ]
        }
      }
    }
  }
  return { id, label, anchor: 0, atoms: translated }
}
