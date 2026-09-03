import { describe, expect, it } from 'vitest'
import { analyzeSystem, detectLayers, resolveSurfaceNormal } from '../../lib/scene-grid/system-semantics'
import { cu111Slab, cu111SlabWithCO, fccCu, water } from './fixtures/cu111-co'

/**
 * The system classifier is what every perception tool leans on to say
 * "this is a slab, layer 0 is the surface, that CO is an adsorbate". These
 * cases pin the public contract on programmatic fixtures (no browser).
 */
describe('system semantics', () => {
  it('reads a Cu(111) slab with CO as slab-with-adsorbates: vacuum along c, 4 host layers, 1 network + 1 CO', () => {
    const { structure } = cu111SlabWithCO()
    const semantics = analyzeSystem(structure)

    expect(semantics.system.kind).toBe('slab-with-adsorbates')
    expect(semantics.vacuum.map((v) => v.axis)).toEqual([2])
    expect(semantics.layers?.layers).toHaveLength(4)

    const networks = semantics.fragments.filter((f) => f.isPeriodicNetwork)
    const discrete = semantics.fragments.filter((f) => !f.isPeriodicNetwork)
    expect(networks).toHaveLength(1)
    expect(discrete).toHaveLength(1)
    expect(discrete[0].formula).toBe('CO')
  })

  it('classifies the same slab without CO as slab, without vacuum as crystal, a monolayer as 2d-material, and water as molecule', () => {
    expect(analyzeSystem(cu111Slab()).system.kind).toBe('slab')
    expect(analyzeSystem(fccCu).system.kind).toBe('crystal')
    expect(analyzeSystem(cu111Slab({ layers: 1 })).system.kind).toBe('2d-material')
    expect(analyzeSystem(water).system.kind).toBe('molecule')
  })

  it('orders layers so index 0 is the vacuum side and reports the (111) interlayer spacing', () => {
    const slab = cu111Slab()
    const normal = resolveSurfaceNormal(slab)
    expect(normal).not.toBeNull()

    const analysis = detectLayers(slab, normal!.normal)
    expect(analysis.layers).toHaveLength(4)
    for (let i = 1; i < analysis.layers.length; i++) {
      expect(analysis.layers[i - 1].heightA).toBeGreaterThan(analysis.layers[i].heightA)
    }
    // fcc Cu a = 3.615 Å → d(111) = a / √3 ≈ 2.087 Å.
    for (const spacing of analysis.spacingsA) expect(spacing).toBeCloseTo(3.615 / Math.sqrt(3), 1)
    expect(analysis.layers[0].index).toBe(0)
  })
})
