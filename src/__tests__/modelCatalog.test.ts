import { describe, expect, it } from 'vitest'

import STORE_PANEL_SOURCE from '../ui/panels/model-store-panel.tsx?raw'
import IMPORT_WORKSPACE_SOURCE from '../ui/panels/structure-import-workspace.tsx?raw'
import { MODEL_CATALOG, filterModelCatalog } from '../ui/panels/model-catalog'
import { getCrystalTemplateNames, STRUCTURE_TEMPLATE_CIFS } from '../lib/crystal/crystal-template-cifs'
import { MOLECULE_TEMPLATES } from '../lib/molecule/templates'
import {
  BIOMOLECULE_TRAJECTORY_EXAMPLES,
  RCSB_BIOMOLECULE_EXAMPLES,
} from '../lib/biomolecule/examples'

describe('Model catalog', () => {
  it('covers every bundled library with unique namespaced ids', () => {
    const byKind = (kind: string) => MODEL_CATALOG.filter((item) => item.kind === kind)

    // The Store's premise is that it shows the whole bundled library, so a new
    // template added to any of these constants must appear without extra wiring.
    expect(byKind('crystal')).toHaveLength(getCrystalTemplateNames().length)
    expect(byKind('molecule')).toHaveLength(Object.keys(MOLECULE_TEMPLATES).length)
    expect(byKind('biomolecule')).toHaveLength(RCSB_BIOMOLECULE_EXAMPLES.length)
    expect(byKind('trajectory')).toHaveLength(BIOMOLECULE_TRAJECTORY_EXAMPLES.length)

    const ids = MODEL_CATALOG.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('matches Model Market installed ids exactly for the curated kinds', () => {
    // The Templates grids filter on installedId against the Model Market's keys;
    // a drift here would silently empty those grids.
    const crystalKey = getCrystalTemplateNames()[0]
    const moleculeKey = Object.keys(MOLECULE_TEMPLATES)[0]

    expect(MODEL_CATALOG.find((item) => item.id === `crystal:${crystalKey}`)?.installedId)
      .toBe(`crystal:${crystalKey}`)
    expect(MODEL_CATALOG.find((item) => item.id === `molecule:${moleculeKey}`)?.installedId)
      .toBe(`molecule:${moleculeKey}`)

    // Biomolecules and trajectories are not curated, so they must stay unmarked
    // or the Templates grids would start listing them.
    for (const item of MODEL_CATALOG) {
      if (item.kind === 'biomolecule' || item.kind === 'trajectory') {
        expect(item.installedId).toBeUndefined()
      }
    }
  })

  it('filters on name, formula and kind vocabulary with every term required', () => {
    const quartzName = STRUCTURE_TEMPLATE_CIFS[getCrystalTemplateNames()[0]].name
    const firstWord = quartzName.split(/[\s(]/)[0]

    expect(filterModelCatalog(MODEL_CATALOG, firstWord).length).toBeGreaterThan(0)
    expect(filterModelCatalog(MODEL_CATALOG, '')).toHaveLength(MODEL_CATALOG.length)
    expect(filterModelCatalog(MODEL_CATALOG, 'trajectory').length)
      .toBe(BIOMOLECULE_TRAJECTORY_EXAMPLES.length)
    // Both terms must match, so an impossible pair yields nothing.
    expect(filterModelCatalog(MODEL_CATALOG, `${firstWord} trajectory`)).toHaveLength(0)
  })

  it('routes both surfaces through the one shared loader', () => {
    expect(STORE_PANEL_SOURCE).toContain('loadModelCatalogEntry')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('loadModelCatalogEntry')
    // Neither surface may re-implement a load sequence locally.
    expect(STORE_PANEL_SOURCE).not.toContain('loadFromXYZ')
    expect(IMPORT_WORKSPACE_SOURCE).not.toContain('createBondsFromMoleculeTemplate')
  })
})
