import { describe, expect, it } from 'vitest'

import MOLECULAR_ORBITAL_LAYER_SOURCE from '../ui/components/crystal-viewer/molecular-orbital-layer.tsx?raw'

describe('molecular-orbital gesture stability', () => {
  it('keeps one configured isosurface geometry through OrbitControls start and end', () => {
    // OrbitControls legitimately toggles interactionPerformanceActive for DPR,
    // atom LOD, and continuous rendering. A static CUBE/Molden surface must not
    // subscribe to that transient flag: changing its sampling resolution rebuilt
    // and swapped the scientific geometry on pointer-down, then swapped it back
    // on pointer-up, which looked like the model shrinking and growing.
    expect(MOLECULAR_ORBITAL_LAYER_SOURCE).not.toContain('interactionPerformanceActive')
    expect(MOLECULAR_ORBITAL_LAYER_SOURCE).not.toContain('effectiveResolution')
    expect(MOLECULAR_ORBITAL_LAYER_SOURCE).toMatch(/sourceType:\s*'cub',[\s\S]*?resolution,[\s\S]*?isoValue/)
    expect(MOLECULAR_ORBITAL_LAYER_SOURCE).toMatch(/sourceType:\s*'molden',[\s\S]*?resolution,[\s\S]*?isoValue/)
  })
})
