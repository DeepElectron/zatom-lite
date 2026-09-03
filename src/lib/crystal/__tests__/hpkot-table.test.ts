import { describe, expect, it } from 'vitest'

import { HPKOT_DATA, evaluateKExpression, type ExtendedBravaisType, type KExpressionScope } from '../hpkot-data'
import { getKPointsForLattice } from '../kpath'
import { calculateReciprocalLattice } from '../brillouin-zone'

// Representative lattice parameters that satisfy each type's defining
// inequalities so every k-parameter is well-defined. Angles in degrees.
const SAMPLE: Record<ExtendedBravaisType, [number, number, number, number, number, number]> = {
  cP1: [4, 4, 4, 90, 90, 90], cP2: [4, 4, 4, 90, 90, 90],
  cF1: [4, 4, 4, 90, 90, 90], cF2: [4, 4, 4, 90, 90, 90],
  cI1: [4, 4, 4, 90, 90, 90],
  tP1: [4, 4, 6, 90, 90, 90],
  tI1: [4, 4, 3, 90, 90, 90], tI2: [4, 4, 6, 90, 90, 90],
  oP1: [4, 5, 6, 90, 90, 90],
  oF1: [3, 5, 6, 90, 90, 90], oF2: [5, 6, 3, 90, 90, 90], oF3: [4, 5, 6, 90, 90, 90],
  oI1: [4, 5, 6, 90, 90, 90], oI2: [6, 4, 5, 90, 90, 90], oI3: [4, 6, 5, 90, 90, 90],
  oC1: [4, 5, 6, 90, 90, 90], oC2: [5, 4, 6, 90, 90, 90],
  oA1: [6, 4, 5, 90, 90, 90], oA2: [6, 5, 4, 90, 90, 90],
  hP1: [3, 3, 5, 90, 90, 120], hP2: [3, 3, 5, 90, 90, 120],
  hR1: [3, 3, 8, 90, 90, 120], hR2: [3, 3, 3, 90, 90, 120],
  mP1: [4, 5, 6, 90, 100, 90],
  mC1: [6, 4, 5, 90, 100, 90], mC2: [4, 5, 6, 90, 95, 90], mC3: [4, 5, 6, 90, 120, 90],
  aP2: [4, 5, 6, 80, 85, 88], aP3: [4, 5, 6, 100, 95, 92],
}

function scopeFor(type: ExtendedBravaisType): KExpressionScope {
  const [a, b, c, alpha, beta, gamma] = SAMPLE[type]
  const rad = Math.PI / 180
  const scope: KExpressionScope = {
    a, b, c,
    cosalpha: Math.cos(alpha * rad), cosbeta: Math.cos(beta * rad), cosgamma: Math.cos(gamma * rad),
    sinalpha: Math.sin(alpha * rad), sinbeta: Math.sin(beta * rad), singamma: Math.sin(gamma * rad),
  }
  for (const { name, expr } of HPKOT_DATA[type].kparams) scope[name] = evaluateKExpression(expr, scope)
  return scope
}

describe('HPKOT band-path table', () => {
  it('evaluates every k-parameter and k-point expression, and every path endpoint is a defined point', () => {
    // evaluateKExpression throws on anything it cannot parse or resolve, so a
    // table typo fails here instead of producing a k-point at 0.
    const offenders: string[] = []
    for (const [type, data] of Object.entries(HPKOT_DATA) as [ExtendedBravaisType, typeof HPKOT_DATA[ExtendedBravaisType]][]) {
      const scope = scopeFor(type)
      for (const [label, coords] of Object.entries(data.points)) {
        for (const expr of coords) {
          const value = evaluateKExpression(expr, scope)
          if (!Number.isFinite(value)) offenders.push(`${type}.${label}: ${expr} = ${value}`)
        }
      }
      for (const [from, to] of data.path) {
        if (!(from in data.points)) offenders.push(`${type}: path references undefined point ${from}`)
        if (!(to in data.points)) offenders.push(`${type}: path references undefined point ${to}`)
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0)
  })

  it('has GAMMA at the origin for every lattice', () => {
    for (const [type, data] of Object.entries(HPKOT_DATA) as [ExtendedBravaisType, typeof HPKOT_DATA[ExtendedBravaisType]][]) {
      expect(data.points['GAMMA'], `${type} lacks GAMMA`).toBeDefined()
      expect(data.points['GAMMA'].map((e) => evaluateKExpression(e, scopeFor(type)))).toEqual([0, 0, 0])
    }
  })

  it('rejects expressions it cannot resolve instead of returning 0', () => {
    const scope = scopeFor('cP1')
    expect(() => evaluateKExpression('Q', scope)).toThrow(/Unknown symbol "Q"/)
    expect(() => evaluateKExpression('1/2+', scope)).toThrow()
    expect(evaluateKExpression('-1+N', { ...scope, N: 0.25 })).toBeCloseTo(-0.75)
    expect(evaluateKExpression('(1+c*c/a/a-c*c/b/b)/4', { ...scope, a: 5, b: 6, c: 3 })).toBeCloseTo((1 + 9 / 25 - 9 / 36) / 4)
  })

  it('places tI2 S_0 where HPKOT defines it', () => {
    // Body-centred tetragonal, c > a: eta = (1+a²/c²)/4 in CONVENTIONAL metrics.
    // Contract (as the BZ viewer calls it): a1..a3 are the conventional cell,
    // b1..b3 the primitive reciprocal basis used for Cartesian placement.
    const a = 4, c = 6
    const conv: [number, number, number][] = [[a, 0, 0], [0, a, 0], [0, 0, c]]
    const prim: [number, number, number][] = [[-a / 2, a / 2, c / 2], [a / 2, -a / 2, c / 2], [a / 2, a / 2, -c / 2]]
    const { b1, b2, b3 } = calculateReciprocalLattice(prim[0], prim[1], prim[2])
    const points = getKPointsForLattice(conv[0], conv[1], conv[2], b1, b2, b3, 'I', 139)
    const labels = points.map((p) => p.label)
    expect(labels).toEqual(expect.arrayContaining(['GAMMA', 'M', 'X', 'P', 'N', 'S', 'S_0', 'R', 'G']))
    const eta = (1 + (a * a) / (c * c)) / 4
    const s0 = points.find((p) => p.label === 'S_0')!
    expect(s0.coords[0]).toBeCloseTo(-eta)
    expect(s0.coords[1]).toBeCloseTo(eta)
    expect(s0.coords[2]).toBeCloseTo(eta)
  })
})
