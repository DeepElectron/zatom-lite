import { describe, expect, it } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { createBiomoleculePresentationArtifact, restoreBiomoleculePresentationArtifact } from '../orchestration/biomolecule-presentation-artifact'
import { createCrystalStore } from '../orchestration/crystalStore'
import { appendLocalWorkspaceFrame, createLocalWorkspaceState, parseLocalWorkspaceState, replaceLocalWorkspaceFrame } from '../host/localWorkspace'
import type { WorkspaceFrame } from '../host/ports'

const PDB = [
  'TITLE     ASSET ROUNDTRIP',
  'MODEL        1',
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 12.00           N',
  'ATOM      2  CA  ALA A   1       1.000   0.000   0.000  1.00 18.00           C',
  'ENDMDL',
  'MODEL        2',
  'ATOM      1  N   ALA A   1       0.000   2.000   0.000  1.00 12.00           N',
  'ATOM      2  CA  ALA A   1       1.000   2.000   0.000  1.00 18.00           C',
  'ENDMDL',
  'CONECT    1    2',
  'END',
].join('\n')

describe('biomolecule presentation Asset artifact', () => {
  it('strictly persists source stick separately from the HyperStick enhancement', () => {
    const source = createCrystalStore()
    source.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    source.setState({ viewMode: 'stick', bondRadius: .2 })
    source.getState().recordBaseStyle()
    const artifact = createBiomoleculePresentationArtifact(source.getState())!
    expect(artifact.visual.viewMode).toBe('stick')
    expect(artifact.presentation.baseStyleKeyframes[0].snapshot.viewMode).toBe('stick')
    const destination = createCrystalStore()
    expect(() => restoreBiomoleculePresentationArtifact(destination, artifact)).not.toThrow()
    expect(destination.getState().viewMode).toBe('stick')
  })

  it('roundtrips the edited MODEL, complete viewer settings, live visuals, camera, ghost and tracks', () => {
    const source = createCrystalStore()
    const structure = parseLegacyPdb(PDB, { id: 'roundtrip', inferBonds: false })
    source.getState().loadBiomolecule(structure)
    source.getState().updateBioSettings({
      bioShowCartoon: true,
      bioShowSticks: true,
      bioShowSpacefill: true,
      bioShowSurface: true,
      bioSurfaceOpacity: 0.42,
      bioPolymerRepresentation: 'inherit',
      bioPolymerColor: { mode: 'scheme', scheme: 'hydrophobicity' },
      bioPolymerScale: 1.65,
      bioShowInteractions: true,
      bioShowLigand: false,
      bioLigandRepresentation: 'sticks',
      bioLigandColor: { mode: 'custom', value: '#336699' },
      bioLigandScale: 1.7,
      bioShowIons: false,
      bioIonRepresentation: 'lines',
      bioIonColor: { mode: 'scheme', scheme: 'chain' },
      bioIonScale: 1.2,
      bioShowPocket: true,
      bioPocketRadius: 7.5,
      bioPocketRepresentation: 'space-filling',
      bioPocketColor: { mode: 'custom', value: '#884422' },
      bioPocketScale: 1.4,
      bioHideWater: false,
      bioShowSSBonds: true,
    })
    source.getState().addBioLayer({
      name: 'Chain A',
      selection: 'chain A',
      representation: 'cartoon',
      materialPresetId: 'clay',
      styleTrack: [{ id: 'layer-key', frame: 8, patch: { opacity: 0.3 }, easing: 'smooth', presetId: 'clay' }],
    })
    source.getState().setBioAlignmentGhost({
      structure,
      pairCount: 1,
      rmsd: 0.25,
      method: 'exact-residue-identity',
      sourceLabel: 'comparison.pdb',
      opacity: 0.35,
      color: '#e879a0',
    })
    source.setState({
      presentationFrames: 11,
      presentationFps: 24,
      presentationLoop: false,
      cameraKeyframes: [{
        id: 'camera-key',
        frame: 10,
        position: [5, 6, 7],
        target: [1, 2, 3],
        zoom: 31,
        easing: 'smooth',
      }],
    })
    source.getState().setPresentationFrame(10)
    const edited = source.getState().atoms.map((atom, index) => index === 0
      ? { ...atom, cartesian: [0, 3, 0] as [number, number, number] }
      : atom)
    source.getState().setAtomsDirectly(edited)
    source.getState().setRenderStyle('pixel8')
    source.getState().setCrystalVisualSettings({
      background: '#123456',
      outline: true,
      outlineWidth: 3.2,
      outlineColor: '#fedcba',
      atomShininess: 77,
      bondBicolor: false,
      bondColor: '#abcdef',
      ambientIntensity: 0.31,
      diffuseIntensity: 0.72,
      specularIntensity: 0.44,
      rimIntensity: 0.28,
      sphereDetail: 40,
      elementOverrides: { N: { color: '#224466', radius: 1.11 } },
      radiusScale: .63,
      bondRadius: .17,
      autoRotate: true,
    })
    source.setState({
      viewMode: 'hyper-stick',
      atomScale: 1.8,
      bondScale: 1.1,
      elementRadiusVariance: 0.35,
      showBonds: false,
      lightAmbient: 0.8,
      lightKey: 1.6,
      lightFill: 0.3,
      lightAzimuth: 123,
      lightElevation: -12,
      cameraProjection: 'orthographic',
      savedCameraState: { position: [11, 12, 13], target: [1, 2, 3], zoom: 37 },
      selectedAtomIds: new Set([source.getState().atoms[0].id]),
      presentationPlaying: true,
    })

    const artifact = createBiomoleculePresentationArtifact(source.getState())
    expect(artifact?.schema).toBe('zatom.biomolecule-presentation/v2')
    expect(artifact?.structure.frames[1].positions).toBeInstanceOf(Float32Array)
    expect(artifact?.structure.frames[1].positions[1]).toBe(3)
    expect(artifact?.presentation.activeModel).toBe(1)
    expect(artifact).not.toHaveProperty('selectedAtomIds')
    expect(artifact?.presentation).not.toHaveProperty('playing')

    const initial = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = initial.workspaces[0]
    const batch = workspace.batches[0]
    const frame: WorkspaceFrame = {
      id: 'bio-frame',
      label: 'Asset roundtrip',
      createdAt: '2026-08-13T00:00:00.000Z',
      atoms: source.getState().atoms.map((atom) => ({
        element: atom.element === 'N' ? 7 : 6,
        position: [...atom.cartesian!] as [number, number, number],
        selected: 0,
      })),
      bonds: [{ from: 0, to: 1, type: 'single' }],
      periodicity: 'molecular',
      settings: { stiffness: 100, cutoff: 2, forceField: 'none', method: 'steepest_descent' },
      meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL' },
      biomoleculePresentation: artifact,
    }
    const persisted = appendLocalWorkspaceFrame(initial, workspace.id, batch.id, frame, true)
    const reloadedWorkspace = parseLocalWorkspaceState(structuredClone(persisted))
    const reloadedArtifact = reloadedWorkspace?.workspaces[0].assets['bio-frame'].biomoleculePresentation
    expect(reloadedArtifact?.structure.frames[1].positions).toBeInstanceOf(Float32Array)

    const destination = createCrystalStore()
    restoreBiomoleculePresentationArtifact(destination, reloadedArtifact!)
    const restored = destination.getState()

    expect(restored.bioStructure?.id).toBe('roundtrip')
    expect(restored.bioLayers[0].styleTrack?.[0].id).toBe('layer-key')
    expect(restored.bioLayers[0].materialPresetId).toBe('clay')
    expect(restored.bioLayers[0].styleTrack?.[0].presetId).toBe('clay')
    expect(restored.bioShowCartoon).toBe(true)
    expect(restored.bioShowSticks).toBe(true)
    expect(restored.bioShowSpacefill).toBe(true)
    expect(restored.bioShowSurface).toBe(true)
    expect(restored.bioSurfaceOpacity).toBe(0.42)
    expect(restored.bioPolymerRepresentation).toBe('inherit')
    expect(restored.bioPolymerColor).toEqual({ mode: 'scheme', scheme: 'hydrophobicity' })
    expect(restored.bioPolymerScale).toBe(1.65)
    expect(restored.bioShowInteractions).toBe(true)
    expect(restored.bioShowLigand).toBe(false)
    expect(restored.bioLigandRepresentation).toBe('sticks')
    expect(restored.bioLigandColor).toEqual({ mode: 'custom', value: '#336699' })
    expect(restored.bioLigandScale).toBe(1.7)
    expect(restored.bioShowIons).toBe(false)
    expect(restored.bioIonRepresentation).toBe('lines')
    expect(restored.bioIonColor).toEqual({ mode: 'scheme', scheme: 'chain' })
    expect(restored.bioIonScale).toBe(1.2)
    expect(restored.bioShowPocket).toBe(true)
    expect(restored.bioPocketRadius).toBe(7.5)
    expect(restored.bioPocketRepresentation).toBe('space-filling')
    expect(restored.bioPocketColor).toEqual({ mode: 'custom', value: '#884422' })
    expect(restored.bioPocketScale).toBe(1.4)
    expect(restored.bioHideWater).toBe(false)
    expect(restored.bioShowSSBonds).toBe(true)
    expect(restored.bioAlignmentGhost?.sourceLabel).toBe('comparison.pdb')
    expect(restored.bioAlignmentGhost?.color).toBe('#e879a0')
    expect(restored.presentationFrame).toBe(10)
    expect(restored.presentationFps).toBe(24)
    expect(restored.presentationLoop).toBe(false)
    expect(restored.cameraKeyframes[0].id).toBe('camera-key')
    expect(restored.cameraKeyframes[0].zoom).toBe(31)
    expect(restored.trajectoryTotalFrames).toBe(2)
    expect(restored.trajectoryCurrentFrame).toBe(1)
    expect(restored.atoms[0].cartesian?.[1]).toBe(3)
    expect(restored.bioStructure?.frames[1].positions[1]).toBe(3)
    expect(restored.renderStyle).toBe('pixel8')
    expect(restored.background).toBe('#123456')
    expect(restored.outline).toBe(true)
    expect(restored.outlineWidth).toBe(3.2)
    expect(restored.outlineColor).toBe('#fedcba')
    expect(restored.atomShininess).toBe(77)
    expect(restored.bondBicolor).toBe(false)
    expect(restored.bondColor).toBe('#abcdef')
    expect(restored.ambientIntensity).toBe(0.31)
    expect(restored.diffuseIntensity).toBe(0.72)
    expect(restored.specularIntensity).toBe(0.44)
    expect(restored.rimIntensity).toBe(0.28)
    expect(restored.sphereDetail).toBe(40)
    expect(restored.elementOverrides).toEqual({ N: { color: '#224466', radius: 1.11 } })
    expect(restored.radiusScale).toBe(.63)
    expect(restored.bondRadius).toBe(.17)
    expect(restored.elementRadiusVariance).toBe(0.35)
    expect(restored.autoRotate).toBe(true)
    expect(restored.viewMode).toBe('hyper-stick')
    expect(restored.atomScale).toBe(1.8)
    expect(restored.bondScale).toBe(1.1)
    expect(restored.showBonds).toBe(false)
    expect(restored.lightAmbient).toBe(0.8)
    expect(restored.lightKey).toBe(1.6)
    expect(restored.lightFill).toBe(0.3)
    expect(restored.lightAzimuth).toBe(123)
    expect(restored.lightElevation).toBe(-12)
    expect(restored.cameraProjection).toBe('orthographic')
    expect(restored.savedCameraState).toEqual({ position: [11, 12, 13], target: [1, 2, 3], zoom: 37 })
    expect(restored.presentationPlaying).toBe(false)
    expect(restored.selectedAtomIds.size).toBe(0)
  })

  it('keeps ordinary crystal frames free of biomolecular artifact data', () => {
    const store = createCrystalStore()
    expect(createBiomoleculePresentationArtifact(store.getState())).toBeUndefined()
  })

  it('restores an explicitly selected MODEL independently of the presentation playhead', () => {
    const source = createCrystalStore()
    source.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    source.getState().setPresentationFrames(11)
    source.getState().setPresentationFrame(0)
    source.getState().setTrajectoryFrame(1)
    const artifact = createBiomoleculePresentationArtifact(source.getState())!

    expect(artifact.presentation.frame).toBe(0)
    expect(artifact.presentation.activeModel).toBe(1)

    const destination = createCrystalStore()
    restoreBiomoleculePresentationArtifact(destination, artifact)
    expect(destination.getState().presentationFrame).toBe(0)
    expect(destination.getState().trajectoryCurrentFrame).toBe(1)
    expect(destination.getState().atoms[0].cartesian?.[1]).toBe(2)
  })

  it('rejects invalid built-in subsystem viewer settings', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    const artifact = createBiomoleculePresentationArtifact(store.getState())!
    const invalidRepresentation = structuredClone(artifact)
    invalidRepresentation.viewer.bioLigandRepresentation = 'cartoon' as never
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), invalidRepresentation)).toThrow(/Invalid/)

    const invalidRadius = structuredClone(artifact)
    invalidRadius.viewer.bioPocketRadius = Number.NaN
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), invalidRadius)).toThrow(/Invalid/)

    const invalidColor = structuredClone(artifact)
    invalidColor.viewer.bioIonColor = { mode: 'custom', value: 'red' }
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), invalidColor)).toThrow(/Invalid/)

    const invalidGhostColor = structuredClone(artifact)
    invalidGhostColor.alignmentGhost = {
      structure: invalidGhostColor.structure,
      pairCount: 1,
      rmsd: 0,
      method: 'exact-residue-identity',
      sourceLabel: 'comparison.pdb',
      opacity: .45,
      color: 'pink',
    }
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), invalidGhostColor)).toThrow(/Invalid/)
  })

  it('roundtrips pLDDT colors only when the structure declares pLDDT provenance', () => {
    const source = createCrystalStore()
    source.getState().loadBiomolecule(parseLegacyPdb(PDB, {
      id: 'AF-ROUNDTRIP',
      inferBonds: false,
    }))
    source.getState().updateBioSettings({
      bioColorScheme: 'plddt',
      bioPolymerColor: { mode: 'scheme', scheme: 'plddt' },
    })
    source.getState().addBioLayer({
      name: 'Confidence',
      color: { mode: 'scheme', scheme: 'plddt' },
      styleTrack: [{
        id: 'confidence-key', frame: 0, easing: 'smooth',
        patch: { color: { mode: 'scheme', scheme: 'plddt' } },
      }],
    })
    const artifact = createBiomoleculePresentationArtifact(source.getState())!
    const destination = createCrystalStore()

    expect(() => restoreBiomoleculePresentationArtifact(destination, artifact)).not.toThrow()
    expect(destination.getState().bioStructure?.bFactorSemantics).toBe('plddt')
    expect(destination.getState().bioColorScheme).toBe('plddt')
    expect(destination.getState().bioPolymerColor).toEqual({ mode: 'scheme', scheme: 'plddt' })
    expect(destination.getState().bioLayers[0].styleTrack?.[0].patch.color).toEqual({ mode: 'scheme', scheme: 'plddt' })
  })

  it('rejects invalid presentation state before it reaches history or persistence', () => {
    const source = createCrystalStore()
    source.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    source.setState({ bioColorScheme: 'plddt' })
    expect(() => createBiomoleculePresentationArtifact(source.getState())).toThrow(/Cannot create/)

    source.setState({ bioColorScheme: 'viridis' })
    const validArtifact = createBiomoleculePresentationArtifact(source.getState())!
    const invalidArtifact = structuredClone(validArtifact)
    invalidArtifact.viewer.bioLigandColor = { mode: 'scheme', scheme: 'plddt' }
    const frame: WorkspaceFrame = {
      id: 'guarded-frame', label: 'Guarded', createdAt: '2026-08-13T00:00:00.000Z',
      atoms: [], settings: { stiffness: 100, cutoff: 2, forceField: 'none', method: 'steepest_descent' },
      meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL' }, biomoleculePresentation: invalidArtifact,
    }
    const state = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = state.workspaces[0]
    const batch = workspace.batches[0]
    expect(() => appendLocalWorkspaceFrame(state, workspace.id, batch.id, frame)).toThrow(/Invalid workspace frame/)
    expect(state.workspaces[0].frames).toEqual([])

    const validFrame = { ...frame, biomoleculePresentation: validArtifact }
    const appended = appendLocalWorkspaceFrame(state, workspace.id, batch.id, validFrame)
    expect(() => replaceLocalWorkspaceFrame(appended, workspace.id, batch.id, validFrame.id, frame)).toThrow(/Invalid workspace frame/)
    expect(appended.workspaces[0].assets[validFrame.id].biomoleculePresentation?.viewer.bioLigandColor).toEqual({ mode: 'scheme', scheme: 'element' })
  })

  it.each([
    'zatom.biomolecule-presentation/v1',
    'zatom.biomolecule-presentation/v3',
  ])('rejects unsupported schema %s instead of guessing', (schema) => {
    const state = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = state.workspaces[0]
    const batch = workspace.batches[0]
    const invalidFrame: WorkspaceFrame = {
      id: 'invalid-bio',
      label: 'Invalid bio',
      createdAt: '2026-08-13T00:00:00.000Z',
      atoms: [],
      settings: { stiffness: 100, cutoff: 2, forceField: 'none', method: 'steepest_descent' },
      meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL' },
      biomoleculePresentation: { schema } as never,
    }
    expect(() => appendLocalWorkspaceFrame(state, workspace.id, batch.id, invalidFrame)).toThrow(/Invalid workspace frame/)
  })

  it('rejects a malformed v2 artifact before restore or surface allocation', () => {
    const source = createCrystalStore()
    source.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    const artifact = createBiomoleculePresentationArtifact(source.getState())!
    const malformed = structuredClone(artifact)
    malformed.presentation.fps = 1_000

    const state = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = state.workspaces[0]
    const batch = workspace.batches[0]
    const invalidFrame: WorkspaceFrame = {
      id: 'malformed-v2', label: 'Malformed', createdAt: '2026-08-13T00:00:00.000Z', atoms: [],
      settings: { stiffness: 100, cutoff: 2, forceField: 'none', method: 'steepest_descent' },
      meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL' }, biomoleculePresentation: malformed,
    }
    expect(() => appendLocalWorkspaceFrame(state, workspace.id, batch.id, invalidFrame)).toThrow(/Invalid workspace frame/)
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), malformed)).toThrow(/Invalid/)
  })

  it.each([
    ['missing viewer contract', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      ;(artifact as unknown as { viewer: unknown }).viewer = {}
    }],
    ['dangling residue reference', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.structure.atoms[0].residueIndex = 99
    }],
    ['invalid layer keyframe patch', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.layers[0].styleTrack![0].patch.opacity = Number.NaN
    }],
    ['missing layer preset authoring identity', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      delete (artifact!.layers[0] as { materialPresetId?: string | null }).materialPresetId
    }],
    ['incomplete global-style snapshot', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.presentation.baseStyleKeyframes = [{
        id: 'broken-style', frame: 0, easing: 'smooth', snapshot: { background: '#ffffff' } as never,
      }]
    }],
    ['incomplete live visual state', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.visual = { background: '#ffffff' } as never
    }],
    ['invalid camera pose', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.camera.pose = { position: [0, 0, 1], target: [0, 0, 0], zoom: 0 }
    }],
    ['invalid active MODEL', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.presentation.activeModel = artifact!.structure.frames.length
    }],
    ['pLDDT global color on temperature-factor data', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.viewer.bioColorScheme = 'plddt'
    }],
    ['pLDDT subsystem color on temperature-factor data', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.viewer.bioLigandColor = { mode: 'scheme', scheme: 'plddt' }
    }],
    ['pLDDT layer color on temperature-factor data', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.layers[0].color = { mode: 'scheme', scheme: 'plddt' }
    }],
    ['pLDDT keyframe color on temperature-factor data', (artifact: ReturnType<typeof createBiomoleculePresentationArtifact>) => {
      artifact!.layers[0].styleTrack![0].patch.color = { mode: 'scheme', scheme: 'plddt' }
    }],
  ])('rejects %s', (_, mutate) => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.getState().addBioLayer({
      name: 'Tracked', selection: 'all', styleTrack: [{
        id: 'tracked-key', frame: 1, easing: 'smooth', patch: { opacity: .5 },
      }],
    })
    const artifact = createBiomoleculePresentationArtifact(store.getState())!
    mutate(artifact)

    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), artifact)).toThrow(/Invalid/)
  })

  it('preserves valid keys outside a shortened timeline and rejects only the absolute bound', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.setState({
      presentationFrames: 20,
      cameraKeyframes: [{ id: 'outside-camera', frame: 80, easing: 'smooth', position: [1, 2, 3], target: [0, 0, 0] }],
    })
    store.getState().addBioLayer({
      styleTrack: [{ id: 'outside-layer', frame: 70, easing: 'smooth', patch: { opacity: .5 } }],
    })
    const artifact = createBiomoleculePresentationArtifact(store.getState())!
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), artifact)).not.toThrow()
    artifact.presentation.cameraKeyframes[0].frame = 100_001
    expect(() => restoreBiomoleculePresentationArtifact(createCrystalStore(), artifact)).toThrow(/Invalid/)
  })
})
