import { describe, expect, it } from 'vitest'

import IMPORT_WORKSPACE_SOURCE from '../ui/panels/structure-import-workspace.tsx?raw'
import PANEL_UI_SOURCE from '../ui/panels/panel-ui.tsx?raw'
import STRUCTURE_PANEL_SOURCE from '../ui/panels/structure-panel.tsx?raw'
import MODEL_CATALOG_SOURCE from '../ui/panels/model-catalog.ts?raw'
import { STRUCTURE_IMPORT_CATEGORIES } from '../ui/panels/structure-import-categories'

function componentSource(name: string, nextName: string): string {
  const start = IMPORT_WORKSPACE_SOURCE.indexOf(`function ${name}`)
  const end = IMPORT_WORKSPACE_SOURCE.indexOf(`function ${nextName}`, start + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return IMPORT_WORKSPACE_SOURCE.slice(start, end)
}

describe('Structure import workspace', () => {
  it('offers the import categories in order', () => {
    // Assert the runtime data registry rather than source formatting or module placement.
    expect(STRUCTURE_IMPORT_CATEGORIES.map((entry) => entry.value)).toEqual([
      'materials',
      'molecules',
      'macromolecules',
    ])
    expect(IMPORT_WORKSPACE_SOURCE).toContain('semantics="tabs"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('getOptionId={tabId}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('getPanelId={panelId}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('role="tabpanel"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('aria-labelledby={tabId(value)}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('selectOnPointerEnter={140}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('gentleMotion')
    expect(IMPORT_WORKSPACE_SOURCE).not.toContain('AnimatePresence mode="wait"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('data-structure-import-panel-stack')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('new ResizeObserver')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('animate={{ height: panelHeights[category] ?? 0 }}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('aria-hidden={!active}')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('{...(!active ? { inert: "" } : {})}')
    expect(IMPORT_WORKSPACE_SOURCE).not.toContain('element.inert = !active')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('pointerEvents: active ? "auto" : "none"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('IMPORT_PANEL_CONTENT[value]')
    expect(IMPORT_WORKSPACE_SOURCE).not.toContain('key={category}')
    expect(PANEL_UI_SOURCE).toContain('pointerSelectionTimer')
    expect(PANEL_UI_SOURCE).toContain('onPointerEnter={(event) => selectFromPointer(index, event.pointerType)}')
    expect(PANEL_UI_SOURCE).toContain('onPointerLeave={clearPointerSelection}')
  })

  it('keeps each remote source and local content in its category', () => {
    const materials = componentSource('MaterialsImportPanel', 'MoleculesImportPanel')
    const molecules = componentSource('MoleculesImportPanel', 'MacromoleculesImportPanel')
    const macromolecules = componentSource('MacromoleculesImportPanel', 'StructureImportWorkspace')

    expect(materials).toContain('searchMaterialsProject')
    expect(materials).toContain('loadMaterialsProjectMaterial')
    expect(materials).toContain('<CrystalGrid />')
    expect(materials).not.toContain('searchPubChemCompounds')
    expect(materials).not.toContain('importRcsbPdb')

    expect(molecules).toContain('searchPubChemCompounds')
    expect(molecules).toContain('loadPubChemCompound')
    expect(molecules).toContain('<MoleculeGrid />')
    expect(molecules).not.toContain('searchMaterialsProject')
    expect(molecules).not.toContain('importRcsbPdb')

    expect(macromolecules).toContain('importRcsbPdb')
    expect(macromolecules).toContain('RCSB_BIOMOLECULE_EXAMPLES')
    expect(macromolecules).toContain('BIOMOLECULE_TRAJECTORY_EXAMPLES')
    expect(macromolecules).toContain('<SearchField')
    expect(macromolecules).toContain('canSubmit={pdbId.length === 4}')
    // Boltz remains a subtab of this category.
    expect(macromolecules).toContain('<BoltzPanel />')
    expect(macromolecules).not.toContain('zatom-primary')
    expect(macromolecules).not.toContain('searchMaterialsProject')
    expect(macromolecules).not.toContain('searchPubChemCompounds')

    expect(IMPORT_WORKSPACE_SOURCE).toContain('function TemplateCard({')
    // The template load sequences now live in the shared catalog that Assets ▸
    // Store loads from too, so these assert against that single owner.
    expect(MODEL_CATALOG_SOURCE).toContain('format: "CIF"')
    expect(MODEL_CATALOG_SOURCE).toContain('format: `XYZ · ${template.formula}`')
    expect(MODEL_CATALOG_SOURCE).toContain('loadFromXYZ(template.xyz)')
    expect(MODEL_CATALOG_SOURCE).toContain('const loadedStore = useCrystalStore.getState()')
    expect(MODEL_CATALOG_SOURCE).toContain('createBondsFromMoleculeTemplate(catalogEntry.key, loadedStore.atoms)')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('format="PDB"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('format="PDB · multi-MODEL"')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('font-mono text-[8px] text-[var(--panel-text-tertiary)]')
  })

  it('has one explicit import owner and no legacy database or periodic template switch', () => {
    expect(STRUCTURE_PANEL_SOURCE.match(/<StructureImportWorkspace\s*\/>/g)).toHaveLength(1)
    expect(STRUCTURE_PANEL_SOURCE.match(/<StructureFileImportDropzone\s*\/>/g)).toHaveLength(1)
    expect(STRUCTURE_PANEL_SOURCE.indexOf('<StructureFileImportDropzone'))
      .toBeLessThan(STRUCTURE_PANEL_SOURCE.indexOf('<StructureImportWorkspace'))
    expect(STRUCTURE_PANEL_SOURCE).toContain('const [importOpen, setImportOpen]')
    expect(STRUCTURE_PANEL_SOURCE).toContain('aria-controls="structure-import-workspace"')
    expect(STRUCTURE_PANEL_SOURCE).toContain('onPointerEnter={scheduleImportOpen}')
    expect(STRUCTURE_PANEL_SOURCE).toContain('onPointerLeave={scheduleImportClose}')
    // Boltz is a lazy Macromolecules subtab rather than a top-level Import/Export peer.
    expect(STRUCTURE_PANEL_SOURCE).not.toContain('BoltzPanel')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('<BoltzPanel />')
    expect(IMPORT_WORKSPACE_SOURCE).toContain('import("./boltz-panel")')
    expect(STRUCTURE_PANEL_SOURCE).not.toContain('Database Search')
    expect(STRUCTURE_PANEL_SOURCE).not.toContain('showTemplates')
    expect(STRUCTURE_PANEL_SOURCE).not.toContain('function SearchContent')
    expect(IMPORT_WORKSPACE_SOURCE).not.toContain('periodic ? <CrystalGrid')
  })
})
