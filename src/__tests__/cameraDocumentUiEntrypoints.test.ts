import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const batchPanelSource = readFileSync('src/ui/panels/batch-panel.tsx', 'utf8')
const structurePanelSource = readFileSync('src/ui/panels/structure-panel.tsx', 'utf8')
const fragmentDrawerSource = readFileSync('src/ui/panels/fragment-2d-drawer.tsx', 'utf8')
const importWorkspaceSource = readFileSync('src/ui/panels/structure-import-workspace.tsx', 'utf8')
const modelCatalogSource = readFileSync('src/ui/panels/model-catalog.ts', 'utf8')

describe('camera document UI entrypoints', () => {
  it('starts a fresh camera document after Batch installs a legacy frame', () => {
    const loadFrame = batchPanelSource.slice(
      batchPanelSource.indexOf('const loadFrame = useCallback'),
      batchPanelSource.indexOf('// ── 导入为 Building Block'),
    )
    const biomoleculeRestore = loadFrame.indexOf('restoreBiomoleculePresentationArtifact')
    const biomoleculeReturn = loadFrame.indexOf('return', biomoleculeRestore)
    const beginDocument = loadFrame.indexOf('store.beginCameraDocument()')
    const periodicStructureInstall = loadFrame.indexOf('periodic: true')
    const molecularStructureInstall = loadFrame.indexOf('periodic: false')
    const crystalRestore = loadFrame.indexOf('restoreCrystalPresentationArtifact', beginDocument)

    expect(loadFrame.match(/store\.beginCameraDocument\(\)/g)).toHaveLength(1)
    expect(biomoleculeRestore).toBeGreaterThan(-1)
    expect(biomoleculeReturn).toBeLessThan(beginDocument)
    expect(beginDocument).toBeGreaterThan(periodicStructureInstall)
    expect(beginDocument).toBeGreaterThan(molecularStructureInstall)
    expect(beginDocument).toBeLessThan(crystalRestore)
    expect(loadFrame).toContain("clippingAxis: 'z'")
    expect(loadFrame).toContain('clippingOffset: 0')
    expect(loadFrame).toContain("volumeField: 'none'")
    expect(loadFrame).toContain('sliceIsolate: false')
  })

  it('lets canonical atom replacement own template and Ketcher camera setup', () => {
    expect(structurePanelSource).not.toContain('resetCameraToInitial')
    expect(fragmentDrawerSource).not.toContain('resetCameraToInitial')
    expect(importWorkspaceSource).not.toContain('resetCameraToInitial')

    // MoleculeGrid moved into structure-import-workspace.tsx. Assert the slice start so a wrong
    // source file cannot produce an empty slice and vacuous checks.
    const moleculeGridStart = importWorkspaceSource.indexOf('function MoleculeGrid()')
    expect(moleculeGridStart).toBeGreaterThan(-1)
    const moleculeGrid = importWorkspaceSource.slice(
      moleculeGridStart,
      importWorkspaceSource.indexOf('function MacromoleculesImportPanel('),
    )
    expect(moleculeGrid).not.toHaveLength(0)
    const writeMolecule = fragmentDrawerSource.slice(
      fragmentDrawerSource.indexOf('function writeMoleculeToStore('),
      fragmentDrawerSource.indexOf('// 升档顺序'),
    )

    // Template loading now uses loadFromXYZ. It must not start a camera document independently;
    // the canonical replacement path owns camera state. Verify the shared model-catalog slice exists.
    const loadMoleculeStart = modelCatalogSource.indexOf('async function loadMolecule(')
    expect(loadMoleculeStart).toBeGreaterThan(-1)
    const loadMolecule = modelCatalogSource.slice(
      loadMoleculeStart,
      modelCatalogSource.indexOf('async function loadRcsb('),
    )
    expect(loadMolecule).not.toHaveLength(0)
    expect(loadMolecule).toContain('loadFromXYZ(template.xyz)')
    expect(loadMolecule).not.toContain('beginCameraDocument')
    // The grid renders and calls the shared loader without touching camera state.
    expect(moleculeGrid).not.toContain('beginCameraDocument')
    expect(writeMolecule).toContain('store.replaceAtomsDirectly(built.atoms)')
    expect(writeMolecule).not.toContain('beginCameraDocument')
  })

  it('initializes the direct-state empty-workspace fragment as a new document', () => {
    const emptyWorkspaceBranch = structurePanelSource.slice(
      structurePanelSource.indexOf('store.unbindFrame()'),
      structurePanelSource.indexOf('const handleLoadFragment'),
    )
    const beginDocument = emptyWorkspaceBranch.indexOf('store.beginCameraDocument()')
    const directStructureInstall = emptyWorkspaceBranch.indexOf('useCrystalStore.setState({')

    expect(beginDocument).toBeGreaterThan(-1)
    expect(beginDocument).toBeGreaterThan(directStructureInstall)
  })
})
