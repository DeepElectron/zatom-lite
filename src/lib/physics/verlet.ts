/**
 * Velocity Verlet + Lennard-Jones + Harmonic Bond Integrator
 *
 * Real-time modeling preview using the same parameters as the scene simulation.
 */

import type { Atom, Bond } from '../crystal/types'
import { getElement } from '../crystal/elements'

// LJ parameters (consistent with scene Simulation engine)
const LJ_EPSILON = 1.0
const LJ_SIGMA = 1.0
const LJ_CUTOFF_SQ = 2.5 * 2.5
const MIN_R2 = 1e-8

// Harmonic bond potential parameters (consistent with the scene Simulation engine)
const HARMONIC_K_DEFAULT = 100.0
const HARMONIC_R0 = 1.5

// Velocity damping (consistent with Rust engine: 0.98)
const DAMPING = 0.98

interface PhysicsState {
  velocities: Map<string, [number, number, number]>
  forces: Map<string, [number, number, number]>
}

let _state: PhysicsState | null = null

function ensureState(atoms: Atom[]): PhysicsState {
  if (!_state) {
    _state = { velocities: new Map(), forces: new Map() }
  }
  for (const atom of atoms) {
    if (!_state.velocities.has(atom.id)) {
      _state.velocities.set(atom.id, [0, 0, 0])
    }
    if (!_state.forces.has(atom.id)) {
      _state.forces.set(atom.id, [0, 0, 0])
    }
  }
  return _state
}

export function resetPhysicsState(): void {
  _state = null
}

function getAtomMass(atom: Atom): number {
  const el = getElement(atom.element)
  return el?.mass ?? 12.011
}

function getPos(atom: Atom): [number, number, number] {
  const p = atom.cartesian ?? atom.position ?? [0, 0, 0]
  return [p[0], p[1], p[2]]
}

/**
 * One-step Velocity Verlet integration (consistent with Rust engine step() logic)
 *
 * 1. Half-step speed update v += 0.5 * f_old / m * dt
 * 2. Position update x += v * dt
 * 3. Clear force and recalculate LJ + Harmonic
 * 4. The second half-step speed update v += 0.5 * f_new / m * dt
 * 5. Damping v *= 0.98
 */
export function stepVerlet(atoms: Atom[], bonds: Bond[], dt: number, stiffness: number): Atom[] {
  if (atoms.length === 0) return atoms

  const state = ensureState(atoms)
  const n = atoms.length
  const harmonicK = stiffness > 0 ? stiffness : HARMONIC_K_DEFAULT

  // ── Step 1: Half-step speed update + position update ──────────────────────────
  const updated: Atom[] = []
  for (const atom of atoms) {
    const pos = getPos(atom)
    const vel = state.velocities.get(atom.id)!
    const force = state.forces.get(atom.id) ?? [0, 0, 0]
    const invM = 1.0 / getAtomMass(atom)

    // v += 0.5 * f / m * dt
    vel[0] += 0.5 * force[0] * invM * dt
    vel[1] += 0.5 * force[1] * invM * dt
    vel[2] += 0.5 * force[2] * invM * dt

    // x += v * dt
    const newPos: [number, number, number] = [
      pos[0] + vel[0] * dt,
      pos[1] + vel[1] * dt,
      pos[2] + vel[2] * dt,
    ]

    updated.push({ ...atom, position: newPos, cartesian: newPos })
  }

  // ── Step 2: Rebuild dynamic bonds from the topology cutoff.
  const topologyCutoffSq = (bonds.length > 0 ? HARMONIC_R0 * 2.0 : 2.0) ** 2
  const dynamicBonds: Bond[] = []
  for (let i = 0; i < n; i++) {
    const pi = getPos(updated[i])
    for (let j = i + 1; j < n; j++) {
      const pj = getPos(updated[j])
      const dx = pj[0] - pi[0]
      const dy = pj[1] - pi[1]
      const dz = pj[2] - pi[2]
      const r2 = dx * dx + dy * dy + dz * dz
      if (r2 < topologyCutoffSq) {
        dynamicBonds.push({ id: `dyn-${updated[i].id}-${updated[j].id}`, atom1Id: updated[i].id, atom2Id: updated[j].id, type: 'single' } as Bond)
      }
    }
  }
  // Bonds may break or form during simulation.
  const activeBonds = dynamicBonds.length > 0 ? dynamicBonds : bonds

  // ── Step 3: Clearing force ───────────────────────────────────────
  for (const atom of updated) {
    state.forces.set(atom.id, [0, 0, 0])
  }

  // ── Step 4: Calculate LJ force ─────────────────────────────────────
  const sigma2 = LJ_SIGMA * LJ_SIGMA
  for (let i = 0; i < n; i++) {
    const pi = getPos(updated[i])
    const fi = state.forces.get(updated[i].id)!
    for (let j = i + 1; j < n; j++) {
      const pj = getPos(updated[j])
      const dx = pj[0] - pi[0]
      const dy = pj[1] - pi[1]
      const dz = pj[2] - pi[2]
      const r2 = dx * dx + dy * dy + dz * dz

      if (r2 >= LJ_CUTOFF_SQ || r2 < MIN_R2) continue

      const r2inv = sigma2 / r2
      const r6inv = r2inv * r2inv * r2inv
      const r12inv = r6inv * r6inv
      const f = 24.0 * LJ_EPSILON * (2.0 * r12inv - r6inv) / r2

      const fx = f * dx
      const fy = f * dy
      const fz = f * dz

      fi[0] -= fx; fi[1] -= fy; fi[2] -= fz
      const fj = state.forces.get(updated[j].id)!
      fj[0] += fx; fj[1] += fy; fj[2] += fz
    }
  }

  // ── Step 5: Calculate Harmonic key power ─────────────────────────────
  const atomIndex = new Map<string, number>()
  for (let i = 0; i < n; i++) atomIndex.set(updated[i].id, i)

  for (const bond of activeBonds) {
    const iIdx = atomIndex.get(bond.atom1Id)
    const jIdx = atomIndex.get(bond.atom2Id)
    if (iIdx === undefined || jIdx === undefined) continue

    const pi = getPos(updated[iIdx])
    const pj = getPos(updated[jIdx])
    const dx = pj[0] - pi[0]
    const dy = pj[1] - pi[1]
    const dz = pj[2] - pi[2]
    const r2 = dx * dx + dy * dy + dz * dz
    const r = Math.sqrt(r2)

    if (r < 1e-5) continue

    const delta = r - HARMONIC_R0
    const fSpring = harmonicK * delta / r
    const fx = fSpring * dx
    const fy = fSpring * dy
    const fz = fSpring * dz

    const fi = state.forces.get(updated[iIdx].id)!
    fi[0] += fx; fi[1] += fy; fi[2] += fz
    const fj = state.forces.get(updated[jIdx].id)!
    fj[0] -= fx; fj[1] -= fy; fj[2] -= fz
  }

  // ── Step 6: Second half-step speed update + damping ───────────────────────
  for (const atom of updated) {
    const vel = state.velocities.get(atom.id)!
    const force = state.forces.get(atom.id)!
    const invM = 1.0 / getAtomMass(atom)

    vel[0] = (vel[0] + 0.5 * force[0] * invM * dt) * DAMPING
    vel[1] = (vel[1] + 0.5 * force[1] * invM * dt) * DAMPING
    vel[2] = (vel[2] + 0.5 * force[2] * invM * dt) * DAMPING
  }

  return updated
}
