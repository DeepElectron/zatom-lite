import { createCrystalStore } from '../orchestration/crystalStore'
import { expect, it } from 'vitest'
import { hyperStickSurfaceRadius, resolveHyperStickBondRatio, resolveHyperStickPresentation, resolveHyperStickAtomRadius } from '../ui/components/crystal-viewer/hyper-stick-bonds'

it('contains the smooth union of endpoint spheres and thick sticks inside the proxy box', () => {
  const smoothMin = (a: number, b: number, k: number) => {
    const h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k))
    return b * (1 - h) + a * h - k * h * (1 - h)
  }
  for (const [r1, r2] of [[1, 1], [.2, 1.4], [1.4, .2]]) {
    for (const shrink of [.05, .45, 1, 1.5]) {
      for (const length of [.02, 1, 5]) {
        const radius = hyperStickSurfaceRadius(r1, r2, shrink)
        const average = (r1 + r2) / 2
        const k = average * (.3 + .7 * shrink * shrink)
        const sdf = (x: number, z: number) => {
          const sphere1 = Math.hypot(x, z) - r1
          const sphere2 = Math.hypot(x, z - length) - r2
          const stick = Math.hypot(x, z - Math.max(0, Math.min(length, z))) - average * shrink
          return smoothMin(smoothMin(sphere1, stick, k), sphere2, k)
        }
        // Rotational symmetry covers all four sides and both end faces.
        for (let i = 0; i <= 100; i++) {
          expect(sdf(radius, -radius + (length + 2 * radius) * i / 100)).toBeGreaterThan(0)
          expect(sdf(radius * i / 100, -radius)).toBeGreaterThan(0)
          expect(sdf(radius * i / 100, length + radius)).toBeGreaterThan(0)
        }
      }
    }
  }
})


it('applies Bond Size to HyperStick thickness while preserving endpoint radii', () => {
  const store = createCrystalStore()
  store.getState().setViewMode('hyper-stick')
  const ratios: number[] = []
  for (const scale of [.3, 1, 2]) {
    store.getState().setBondScale(scale)
    const state = store.getState()
    const presentation = resolveHyperStickPresentation(state.atomScale, {
      atomScale: state.atomScale, bondScale: state.bondScale, bondRadius: state.bondRadius,
    })
    const radii = new Map([['a', .6], ['b', .4]])
    const r1 = resolveHyperStickAtomRadius(1, state.atomScale, 'a', presentation, radii)
    const r2 = resolveHyperStickAtomRadius(1, state.atomScale, 'b', presentation, radii)
    expect([r1, r2]).toEqual([.6, .4])
    const ratio = resolveHyperStickBondRatio(r1, r2, presentation.stickScale, presentation.bondRadius)
    expect((r1 + r2) / 2 * ratio).toBeCloseTo(.08 * scale)
    ratios.push(ratio)
  }
  expect(ratios[0]).toBeLessThan(ratios[1])
  expect(ratios[1]).toBeLessThan(ratios[2])
  expect(resolveHyperStickBondRatio(.6, .4, .45, null)).toBe(.45)
})
