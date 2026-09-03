import { describe, expect, it } from 'vitest'
import { createCrystalStore } from '../orchestration/crystalStore'

/**
 * End-to-end guard against the cell collapsing to its primitive size after adsorbate placement.
 *
 * Use the real store to build a 2x2x1 slab, detect and choose a site, then place an adsorbate.
 * The rebuilt document cell must still contain every atom.
 */

// Four-atom 2x2 monolayer from a primitive cell with a=b=2.5 and c=20.
const SLAB_XYZ = [
  '4',
  'Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 20.0" Properties=species:S:1:pos:R:3',
  'Cu 0.0 0.0 10.0',
  'Cu 2.5 0.0 10.0',
  'Cu 0.0 2.5 10.0',
  'Cu 2.5 2.5 10.0',
  '',
].join('\n')

describe('adsorbate placement keeps the cell around the atoms', () => {
  it('does not collapse the emitted cell to a single unit cell', async () => {
    const store = createCrystalStore()
    const s = () => store.getState()

    await s().loadFromXYZ(SLAB_XYZ)
    expect(s().atoms.length).toBe(4)
    expect(s().periodic).toBe(true)

    // The visible box is latticeVectors x supercellParams, with atoms baked into the 2x2 supercell.
    const beforeA = s().latticeVectors!.a
    expect(beforeA[0]).toBeCloseTo(5, 6)

    s().detectAdsorbateSites()
    const sites = s().detectedSites
    expect(sites.length).toBeGreaterThan(0)

    s().setSelectedSiteId(sites[0].id)
    s().setAdsorbateFragment('o')
    await s().placeFragmentAtSite()

    const outcome = s().lastPlacementOutcome
    expect(outcome?.ok).toBe(true)

    // Placement adds atoms while the cell must still cover their in-plane extent.
    expect(s().atoms.length).toBeGreaterThan(4)
    const lv = s().latticeVectors
    expect(lv).toBeTruthy()

    // The in-plane lattice must not regress from 5 to the primitive value 2.5.
    expect(lv!.a[0]).toBeGreaterThanOrEqual(beforeA[0] - 1e-6)

    // Every in-plane atom remains inside the cell within numerical tolerance.
    const cartesians = s().atoms.flatMap((a) => (a.cartesian ? [a.cartesian] : []))
    expect(cartesians.length).toBe(s().atoms.length)
    const maxX = Math.max(...cartesians.map((c) => c[0]))
    const maxY = Math.max(...cartesians.map((c) => c[1]))
    expect(maxX).toBeLessThanOrEqual(lv!.a[0] + 1e-6)
    expect(maxY).toBeLessThanOrEqual(lv!.b[1] + 1e-6)
  })

  it('marks the surface normal aperiodic so the vacuum is not contradicted by images above', async () => {
    const store = createCrystalStore()
    const s = () => store.getState()

    await s().loadFromXYZ(SLAB_XYZ)
    s().detectAdsorbateSites()
    s().setSelectedSiteId(s().detectedSites[0].id)
    s().setAdsorbateFragment('o')
    await s().placeFragmentAtSite()

    expect(s().lastPlacementOutcome?.ok).toBe(true)
    // Preserve in-plane periodicity and disable normal periodicity after adding vacuum.
    expect(s().periodicDirs?.c).toBe(false)
    expect(s().periodicDirs?.a).toBe(true)
    expect(s().periodicDirs?.b).toBe(true)
  })
})
