"use client"

import { useState, useEffect, useCallback, useRef, type DragEvent } from "react"
import { Plus, Minus, Grid3X3, Hexagon, Save, Circle, Move3D, Pencil, Trash2, Upload, FolderInput, FolderPlus, CheckCircle2 } from "lucide-react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../ui-kit/context-menu"
import { getActiveViewportStoreApi, useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useViewportManager } from "../../orchestration/viewportManager"
import { useWorkspaceLayers } from "../../host"
import type { WorkspaceFrame } from "../../host"
import { getElement, ELEMENTS } from "../../lib/crystal/elements"
import { resetAtomIdCounter, scaleLatticeVectorsForSupercell } from "../../lib/crystal/supercell-utils"
import { replaceWorkspaceFrameStructure } from "./batch-frame"
import { saveFrameAsTemplate } from "../../lib/molecule/frame-to-template"
import { BatchDeleteDialog } from "./batch-delete-dialog"
import { workspaceFrameBondsToCrystalBonds } from "../../lib/assembly/workspace-frame-block"
import {
  createBiomoleculePresentationArtifact,
  restoreBiomoleculePresentationArtifact,
} from "../../orchestration/biomolecule-presentation-artifact"
import {
  createCrystalPresentationArtifact,
  crystalPresentationChanged,
  restoreCrystalPresentationArtifact,
} from "../../orchestration/crystal-presentation-artifact"
import type { CrystalStore } from "../../orchestration/crystal-store-types"
import { crystalAtomsFromWorkspaceFrame } from '../../lib/crystal/workspace-frame-structure'
import { defaultMolecularOrbitalState } from '../../lib/molecular-orbitals/state'
import { analysisOverlayResetPatch } from '../../orchestration/slices/atom-attributes-slice'
import {
  restoreStructureGroups,
  serializeStructureGroups,
} from '../../orchestration/slices/structure-groups-slice'

const Z_TO_SYMBOL: Record<number, string> = {}
Object.values(ELEMENTS).forEach(el => { Z_TO_SYMBOL[el.atomicNumber] = el.symbol })

const BIO_PERSISTED_KEYS = [
  'bioStructure', 'bioLayers', 'bioAlignmentGhost',
  'bioShowCartoon', 'bioShowSticks', 'bioShowSpacefill', 'bioShowSurface', 'bioColorScheme',
  'bioCartoonModel', 'bioCartoonQuality', 'bioCartoonSmooth',
  'bioRibbonWidth', 'bioRibbonThickness', 'bioSurfaceSpacing', 'bioSurfaceOpacity',
  'bioPolymerRepresentation', 'bioPolymerColor', 'bioPolymerScale',
  'bioShowLigand', 'bioLigandRepresentation', 'bioLigandColor', 'bioLigandScale',
  'bioShowIons', 'bioIonRepresentation', 'bioIonColor', 'bioIonScale',
  'bioShowPocket', 'bioPocketRadius', 'bioPocketRepresentation', 'bioPocketColor', 'bioPocketScale',
  'bioHideWater', 'bioShowSSBonds',
  'bioShowChainLabels', 'bioShowTerminiLabels', 'bioShowLigandLabels',
  'bioResidueLabelInterval', 'bioLabelSize', 'bioLabelColor',
  'bioShowInteractions', 'bioInteractionHBond', 'bioInteractionSaltBridge',
  'bioInteractionPiStacking', 'bioInteractionHydrophobic', 'bioInteractionScope',
  'bioInteractionLabels', 'presentationFrame', 'presentationFrames',
  'presentationFps', 'presentationLoop', 'trajectoryCurrentFrame',
  'cameraKeyframes', 'baseStyleKeyframes',
  'renderStyle', 'background', 'outline', 'outlineWidth', 'outlineColor',
  'atomShininess', 'bondBicolor', 'bondColor', 'elementRadiusVariance',
  'showCoordinationPolyhedra', 'polyhedraOpacity', 'polyStyle', 'polyColorSource',
  'polyElementColors', 'polyColor', 'showPolyEdges', 'polyEdgeColor', 'polyEdgeOpacity',
  'polySpecular', 'polyShininess', 'polyFresnel', 'cellColor', 'cellLineWidth',
  'showCellGrid', 'showCrystalAxes',
  'ambientIntensity', 'diffuseIntensity', 'specularIntensity', 'rimIntensity',
  'viewMode', 'radiusScale', 'bondRadius', 'atomScale', 'bondScale', 'showBonds', 'showLattice',
  'lightAmbient', 'lightKey', 'lightFill', 'lightAzimuth', 'lightElevation',
  'cameraProjection', 'savedCameraState',
  'sphereDetail', 'elementOverrides', 'autoRotate',
] as const satisfies readonly (keyof CrystalStore)[]

function biomoleculePresentationChanged(current: CrystalStore, previous: CrystalStore): boolean {
  return BIO_PERSISTED_KEYS.some((key) => current[key] !== previous[key])
}

function assetPresentationChanged(current: CrystalStore, previous: CrystalStore): boolean {
  return current.bioStructure
    ? biomoleculePresentationChanged(current, previous)
    : crystalPresentationChanged(current, previous)
}

/** Batch manager that loads frames into the editor and writes edits back. */
export function BatchPanel() {
  const [batchExpandedMap, setBatchExpandedMap] = useState<Record<string, boolean>>({})
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null)
  const [editingBatchName, setEditingBatchName] = useState('')
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null)
  const [editingFrameLabel, setEditingFrameLabel] = useState('')
  /**
   * Save-as-template prompt. Held at panel level rather than per row because the
   * name matters: a frame's label is inherited from whatever loaded it, so
   * saving silently is how two identical, unsearchable library rows appear.
   * The prompt seeds the field with the label but still requires a decision.
   */
  const [templateDraft, setTemplateDraft] = useState<{ frame: WorkspaceFrame; name: string } | null>(null)
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)

  const boundFrameRef = useCrystalStore(s => s.boundFrameRef)
  const boundFrameDirty = useCrystalStore(s => s.boundFrameDirty)
  const activeViewportId = useViewportManager((state) => state.activeViewportId)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    workspaceState, persistenceError,
    createBatch, switchBatch, removeBatch, renameBatch, renameFrame,
    removeFramesFromActiveBatch, replaceFrameInBatch, moveFramesToBatch,
  } = useWorkspaceLayers()

  const commitFrameName = (frame: WorkspaceFrame) => {
    const next = editingFrameLabel.trim()
    if (next && next !== frame.label) renameFrame(frame.id, next)
    setEditingFrameId(null)
  }

  const saveDraftAsTemplate = () => {
    if (!templateDraft) return
    const result = saveFrameAsTemplate(templateDraft.frame, templateDraft.name)
    setTemplateNotice(result.ok
      ? `Saved “${result.name}” to Templates`
      : result.error ?? 'Could not save this asset')
    if (result.ok) setTemplateDraft(null)
  }

  const activeWs = workspaceState.workspaces.find(ws => ws.id === workspaceState.activeWorkspaceId)
    ?? workspaceState.workspaces[0] ?? null
  const activeBatchObj = activeWs?.batches.find(b => b.id === activeWs.activeBatchId)
    ?? activeWs?.batches[0] ?? null

  const startFrameDrag = (event: DragEvent<HTMLButtonElement>, frame: WorkspaceFrame) => {
    event.stopPropagation()
    event.dataTransfer.setData('application/x-modeler-frame', JSON.stringify(frame))
    event.dataTransfer.setData('text/plain', `modeler-frame:${frame.id}`)
    event.dataTransfer.effectAllowed = 'copy'
  }

  // Write the current editor state back to its bound batch frame.
  const saveBoundFrame = useCallback(() => {
    const store = useCrystalStore.getState()
    const ref = store.boundFrameRef
    if (!ref) return

    const { atoms, bonds, latticeVectors, periodic, atomAttributes, supercellParams, structureGroups } = store
    const biomoleculePresentation = createBiomoleculePresentationArtifact(store)
    const crystalPresentation = createCrystalPresentationArtifact(store)

    const frameAtoms = atoms.map((a, atomIndex) => {
      const at = atomAttributes[a.id]
      const m = at?.magmom, th = at?.magmomTheta, ph = at?.magmomPhi
      return {
        element: getElement(a.element).atomicNumber,
        position: (a.cartesian || a.position) as [number, number, number],
        selected: 0 as const,
        ...(crystalPresentation ? {
          id: a.id,
          fractionalPosition: [...a.position] as [number, number, number],
          ...(a.cellIndex ? { cellIndex: [...a.cellIndex] as [number, number, number] } : {}),
          siteIndex: a.siteIndex ?? atomIndex,
        } : {}),
        // preserve the Magnetism-panel per-atom moment + non-collinear direction into
        // the saved frame so it flows to spin-polarised DFT via toPayloadAtoms(frame).
        ...(typeof m === 'number' && Number.isFinite(m) ? { magmom: m } : {}),
        ...(typeof th === 'number' && Number.isFinite(th) ? { magmomTheta: th } : {}),
        ...(typeof ph === 'number' && Number.isFinite(ph) ? { magmomPhi: ph } : {}),
        // Persist composite-layer ownership with the Asset.
        ...(a.groupId === undefined ? {} : { groupId: a.groupId }),
      }
    })

    let latticeMatrix: [number, number, number][] | undefined
    if (periodic && latticeVectors) {
      const savedLattice = crystalPresentation
        ? latticeVectors
        : scaleLatticeVectorsForSupercell(latticeVectors, supercellParams)
      latticeMatrix = [
        savedLattice.a,
        savedLattice.b,
        savedLattice.c,
      ]
    }

    const existingFrame = workspaceState.workspaces
      .find(workspace => workspace.id === ref.workspaceId)
      ?.assets[ref.frameId]
    if (!existingFrame) return

    const atomIndices = new Map(atoms.map((atom, index) => [atom.id, index]))
    const frameBonds = bonds
      .filter((bond) => atomIndices.has(bond.atom1Id) && atomIndices.has(bond.atom2Id))
      // Round-trip latticeOffset so periodic bonds do not cut across the restored cell.
      .map((bond) => ({
        from: atomIndices.get(bond.atom1Id)!,
        to: atomIndices.get(bond.atom2Id)!,
        type: bond.type,
        ...(bond.latticeOffset ? { latticeOffset: [...bond.latticeOffset] as [number, number, number] } : {}),
      }))
    const structureFrame = replaceWorkspaceFrameStructure(existingFrame, frameAtoms, frameBonds, latticeMatrix)
    // Persist groups with atom group IDs and omit the field for empty documents.
    if (structureGroups.length > 0) {
      structureFrame.structureGroups = serializeStructureGroups(structureGroups)
    } else {
      delete structureFrame.structureGroups
    }
    const {
      biomoleculePresentation: _discardedBiomoleculeArtifact,
      crystalPresentation: _discardedCrystalArtifact,
      ...ordinaryStructureFrame
    } = structureFrame
    const updatedFrame: WorkspaceFrame = biomoleculePresentation
      ? { ...ordinaryStructureFrame, biomoleculePresentation }
      : crystalPresentation
        ? { ...ordinaryStructureFrame, crystalPresentation }
        : ordinaryStructureFrame

    replaceFrameInBatch(ref.workspaceId, ref.batchId, ref.frameId, updatedFrame)
    useCrystalStore.setState({ boundFrameDirty: false })
  }, [replaceFrameInBatch, workspaceState])

  // Presentation-only edits do not enter structure Undo history. They still
  // belong to the bound Asset and participate in the same debounced autosave.
  useEffect(() => {
    const store = getActiveViewportStoreApi()
    return store.subscribe((current, previous) => {
      if (!current.boundFrameRef || current.boundFrameDirty || !assetPresentationChanged(current, previous)) return
      store.setState({ boundFrameDirty: true })
    })
  }, [activeViewportId])

  // Debounce dirty-state autosaves.
  useEffect(() => {
    if (!boundFrameDirty || !boundFrameRef) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveBoundFrame()
    }, 2000) // Two-second debounce.

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [boundFrameDirty, boundFrameRef, saveBoundFrame])

  // Flush pending edits when the component unmounts.
  // Do not discard edits that are still inside the debounce window.
  // A ref keeps saveBoundFrame current while the empty dependency list limits this effect
  // to actual unmounts.
  const saveBoundFrameRef = useRef(saveBoundFrame)
  saveBoundFrameRef.current = saveBoundFrame
  useEffect(() => () => {
    const store = useCrystalStore.getState()
    if (store.boundFrameRef && store.boundFrameDirty) saveBoundFrameRef.current()
  }, [])

  // Load and bind a clicked frame.
  const loadFrame = useCallback((frame: WorkspaceFrame, wsId: string, batchId: string) => {
    const store = useCrystalStore.getState()

    // Save a dirty bound frame before switching.
    if (store.boundFrameRef && store.boundFrameDirty) {
      saveBoundFrame()
    }

    // Selecting an Asset is document navigation, not an editable operation.
    // A frame must never inherit Undo snapshots belonging to another frame.
    store.unbindFrame()
    store.resetStructureHistory()
    resetAtomIdCounter()

    if (frame.biomoleculePresentation) {
      restoreBiomoleculePresentationArtifact(useCrystalStore, frame.biomoleculePresentation)
      useCrystalStore.setState({
        builderMode: 'structure',
        activeSceneId: null,
        boundFrameRef: { workspaceId: wsId, batchId, frameId: frame.id },
        boundFrameDirty: false,
      })
      return
    }

    // Coordinate frames replace structure state directly. Install the complete
    // geometry first, then start the new
    // camera document so its default Home pose can only be computed from this frame.
    // A crystal presentation, when present, restores its own live pose below.
    store.clearBiomolecule()
    store.clearCrystalLayers()
    store.clearTrajectory()
    store.clearCompactStructure()
    store.resetPresentationTimeline()

    const hasPeriodic = !!frame.latticeMatrix

    if (hasPeriodic && frame.latticeMatrix) {
      const [va, vb, vc] = frame.latticeMatrix
      const newLatticeVectors = { a: va, b: vb, c: vc }

      const atoms = crystalAtomsFromWorkspaceFrame(frame, newLatticeVectors)

      const aMag=Math.sqrt(va[0]**2+va[1]**2+va[2]**2), bMag=Math.sqrt(vb[0]**2+vb[1]**2+vb[2]**2), cMag=Math.sqrt(vc[0]**2+vc[1]**2+vc[2]**2)
      const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
      const alpha=Math.acos(Math.max(-1,Math.min(1,dot(vb,vc)/(bMag*cMag))))*180/Math.PI
      const beta=Math.acos(Math.max(-1,Math.min(1,dot(va,vc)/(aMag*cMag))))*180/Math.PI
      const gamma=Math.acos(Math.max(-1,Math.min(1,dot(va,vb)/(aMag*bMag))))*180/Math.PI

      const bonds = workspaceFrameBondsToCrystalBonds(frame, atoms as any[], newLatticeVectors)

      useCrystalStore.setState({
        builderMode: 'structure',
        periodic: true,
        latticeParams: {
          a: aMag,
          b: bMag,
          c: cMag,
          alpha,
          beta,
          gamma,
          ...(frame.meta.centeringType ? { centeringType: frame.meta.centeringType } : {}),
          ...(frame.meta.spaceGroupNumber ? { spaceGroupNumber: frame.meta.spaceGroupNumber } : {}),
        },
        latticeVectors: newLatticeVectors,
        atoms: atoms as any[],
        unitCellAtoms: frame.crystalPresentation
          ? structuredClone(frame.crystalPresentation.supercell.unitCellAtoms)
          : atoms as any[],
        bonds,
        supercellParams: { nx: 1, ny: 1, nz: 1 },
        selectedAtomIds: new Set(),
        focusedAtomIds: new Set(),
        measurementMode: 'none',
        measurements: [],
        pendingMeasurementAtoms: [],
        activeMeasurementEdit: null,
        pendingBondAtomId: null,
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        selectionRegionPreview: null,
        constructedPlane: null,
        show2DPlaneView: false,
        activeSceneId: null,
        // Older Assets without groups receive the required Base layer.
        structureGroups: restoreStructureGroups(frame.structureGroups, atoms.length),
        activeGroupId: null,
        soloGroupId: null,
        // Atoms with group IDs are merged-layer atoms protected during supercell regeneration.
        userAddedAtomIds: new Set(atoms.filter((a) => a.groupId !== undefined).map((a) => a.id)),
        boundFrameRef: { workspaceId: wsId, batchId, frameId: frame.id },
        boundFrameDirty: false,
      })
    } else {
      const atoms = frame.crystalPresentation
        ? crystalAtomsFromWorkspaceFrame(frame, { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] })
        : frame.atoms.map((a, idx) => {
          const symbol = typeof a.element === 'number' ? (Z_TO_SYMBOL[a.element] || 'C') : String(a.element)
          return {
            id: `frame-atom-${idx}`,
            element: symbol,
            position: a.position as [number,number,number],
            cartesian: a.position as [number,number,number],
            ...(a.groupId === undefined ? {} : { groupId: a.groupId }),
          }
        })

      const bonds = workspaceFrameBondsToCrystalBonds(frame, atoms as any[], store.latticeVectors)

      useCrystalStore.setState({
        builderMode: 'structure',
        periodic: false,
        atoms: atoms as any[],
        unitCellAtoms: [],
        bonds,
        selectedAtomIds: new Set(),
        focusedAtomIds: new Set(),
        measurementMode: 'none',
        measurements: [],
        pendingMeasurementAtoms: [],
        activeMeasurementEdit: null,
        pendingBondAtomId: null,
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        selectionRegionPreview: null,
        constructedPlane: null,
        show2DPlaneView: false,
        activeSceneId: null,
        // Older Assets without groups receive the required Base layer.
        structureGroups: restoreStructureGroups(frame.structureGroups, atoms.length),
        activeGroupId: null,
        soloGroupId: null,
        boundFrameRef: { workspaceId: wsId, batchId, frameId: frame.id },
        boundFrameDirty: false,
      })
    }

    useCrystalStore.setState({
      selectedBondIds: new Set(),
      selectedEdgeIds: new Set(),
      selectedFaceIds: new Set(),
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      molecularOrbital: defaultMolecularOrbitalState,
      domainWallReview: null,
      ...analysisOverlayResetPatch(),
    })
    store.beginCameraDocument()

    if (frame.crystalPresentation) {
      restoreCrystalPresentationArtifact(useCrystalStore, frame.crystalPresentation)
      useCrystalStore.setState({ boundFrameDirty: false })
    }

  }, [saveBoundFrame])


  return (
    <div className="overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel-elevated)]">
      <div className="border-b border-[var(--panel-border)] px-3 py-2">
        <div className="text-xs text-[var(--panel-text-secondary)]">{activeWs?.name ?? 'Workspace unavailable'}</div>
      </div>
      {persistenceError && (
        <div className="status-surface-red border-b px-3 py-2 text-[10px]">
          {persistenceError}
        </div>
      )}

      {/* Batches header. */}
      {activeWs && (
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--panel-text-tertiary)]">Batches</span>
          <div className="flex items-center gap-1">
            {/* Manual save action. */}
            {boundFrameDirty && (
              <button
                onClick={() => { saveBoundFrame();  }}
                className="status-surface-amber zatom-pressable flex h-6 items-center gap-1 rounded-md border px-2 text-[9px] font-medium"
                title="Save changes to selected Asset"
              >
                <Save className="w-3 h-3" />
                Save
              </button>
            )}
            <button
              onClick={() => { createBatch();  }}
              className="w-5 h-5 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title="New Batch"
            >
              <Plus className="w-3 h-3" />
            </button>
            {activeWs.batches.length > 1 && activeBatchObj && (
              <BatchDeleteDialog
                batchName={activeBatchObj.name}
                assetCount={activeBatchObj.frameIds.length}
                onConfirm={() => { removeBatch(activeBatchObj.id);  }}
              >
                <button
                  type="button"
                  className="status-hover-red w-5 h-5 rounded flex items-center justify-center text-[var(--panel-text-tertiary)] transition-colors"
                  title="Delete Selected Batch"
                >
                  <Minus className="w-3 h-3" />
                </button>
              </BatchDeleteDialog>
            )}
          </div>
        </div>
      )}

      {/* Batch list. */}
      {activeWs && (
        <div className="px-2 py-1 max-h-[300px] overflow-y-auto space-y-0.5">
          {activeWs.batches.map(batch => {
            const isActive = batch.id === activeWs.activeBatchId
            const expanded = batchExpandedMap[batch.id] ?? isActive
            const frames = batch.frameIds.map(fid => activeWs.assets[fid]).filter(Boolean)
            return (
              <div key={batch.id}>
                <ContextMenuRoot>
                <ContextMenuTrigger asChild>
                <div className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-[var(--panel-hover)]">
                  <button
                    onClick={() => setBatchExpandedMap(prev => ({ ...prev, [batch.id]: !expanded }))}
                    className="w-4 text-center text-[10px] text-[var(--panel-text-tertiary)]"
                  >
                    {expanded ? '▼' : '▶'}
                  </button>
                  {editingBatchId === batch.id ? (
                    <input
                      autoFocus value={editingBatchName}
                      onChange={e => setEditingBatchName(e.target.value)}
                      onBlur={() => { const n=editingBatchName.trim(); if(n&&n!==batch.name) renameBatch(batch.id,n); setEditingBatchId(null) }}
                      onKeyDown={e => { if(e.key==='Enter'){const n=editingBatchName.trim();if(n&&n!==batch.name)renameBatch(batch.id,n);setEditingBatchId(null)} if(e.key==='Escape')setEditingBatchId(null) }}
                      className="zatom-field flex-1 rounded px-1.5 py-0.5 text-[10px]"
                    />
                  ) : (
                    <button
                      onClick={() => switchBatch(batch.id)}
                      className="zatom-pressable flex-1 rounded px-1.5 py-0.5 text-left text-[11px]"
                      data-selected={isActive}
                      aria-pressed={isActive}
                      style={{
                        color: isActive ? 'var(--control-selected-text)' : 'var(--panel-text-secondary)',
                        background: isActive ? 'var(--control-selected-bg)' : 'transparent',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {batch.name} ({frames.length})
                    </button>
                  )}
                  {isActive && <span className="shrink-0 text-[8px] text-[var(--control-selected-text)]">selected</span>}
                  {isActive && editingBatchId !== batch.id && (
                    <button
                      type="button"
                      aria-label={`Rename ${batch.name}`}
                      title="Rename selected Batch"
                      onClick={() => { setEditingBatchId(batch.id); setEditingBatchName(batch.name) }}
                      className="zatom-pressable flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--panel-text-tertiary)] hover:text-[var(--panel-text)]"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>
                    {`${batch.name} \u00B7 ${frames.length} assets`}
                  </ContextMenuLabel>
                  <ContextMenuItem
                    icon={<CheckCircle2 />}
                    disabled={isActive}
                    onSelect={() => { switchBatch(batch.id);  }}
                  >
                    Select batch
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Pencil />}
                    onSelect={() => { setEditingBatchId(batch.id); setEditingBatchName(batch.name) }}
                  >
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<FolderPlus />}
                    onSelect={() => { createBatch();  }}
                  >
                    New batch
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {/* Delete stays disabled on the last batch: removeBatch would
                      leave the workspace with no active batch. Same guard the
                      header's Minus button uses (batches.length > 1). */}
                  <ContextMenuItem
                    icon={<Trash2 />}
                    destructive
                    disabled={!activeWs || activeWs.batches.length < 2}
                    onSelect={() => { removeBatch(batch.id);  }}
                  >
                    Delete batch
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenuRoot>

                {expanded && (
                  <div className="ml-5 space-y-0.5 pb-1">
                    {frames.length === 0 && <div className="px-1.5 py-1 text-[9px] text-[var(--panel-text-tertiary)]">Empty</div>}
                    {frames.map(frame => {
                      const isBound = boundFrameRef?.frameId === frame.id
                      const isDirty = isBound && boundFrameDirty
                      return (
                        <ContextMenuRoot key={frame.id}>
                        <ContextMenuTrigger asChild>
                        <div
                          onClick={() => {
                            if (!isBound && activeWs) {
                              loadFrame(frame, activeWs.id, batch.id)
                            }
                          }}
                          className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-[var(--panel-hover)]"
                          style={isBound ? { background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' } : { border: '1px solid transparent' }}
                        >
                          <div className="shrink-0 relative" title={frame.latticeMatrix ? 'Crystal' : 'Molecule'}>
                            {/* Crystal and Molecule are categories, so use theme-aware category tokens. */}
                            {frame.latticeMatrix ? (
                              <Grid3X3 className="w-3 h-3" style={{ color: 'var(--chart-4)' }} />
                            ) : (
                              <Hexagon className="w-3 h-3" style={{ color: 'var(--chart-3)' }} />
                            )}
                            {/* Dirty indicator. */}
                            {isDirty && (
                              <Circle className="status-amber w-1.5 h-1.5 fill-current absolute -top-0.5 -right-0.5" />
                            )}
                          </div>
                          <button
                            draggable
                            onClick={e => e.stopPropagation()}
                            onDragStart={e => startFrameDrag(e, frame)}
                            className="zatom-choice zatom-pressable flex shrink-0 cursor-grab items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium active:cursor-grabbing"
                            title="Drag into the 3D viewport to combine"
                          >
                            <Move3D className="w-3 h-3" />
                            Drag
                          </button>
                          <div className="flex-1 min-w-0">
                            {editingFrameId === frame.id ? (
                              <input
                                autoFocus
                                value={editingFrameLabel}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setEditingFrameLabel(e.target.value)}
                                onBlur={() => commitFrameName(frame)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitFrameName(frame)
                                  if (e.key === 'Escape') setEditingFrameId(null)
                                }}
                                aria-label={`Rename ${frame.label}`}
                                className="zatom-field w-full rounded px-1.5 py-0.5 text-[10px]"
                              />
                            ) : (
                              <div className="truncate text-[10px]" style={{ color: isBound ? 'var(--control-selected-text)' : 'var(--panel-text-secondary)' }}>
                                {frame.label}
                              </div>
                            )}
                            <div className="text-[8px] text-[var(--panel-text-tertiary)]">{frame.atoms.length} atoms</div>
                          </div>
                          {isBound && isDirty && (
                            <span className="status-amber shrink-0 text-[8px]">Unsaved</span>
                          )}
                          {isBound && !isDirty && (
                            <span className="shrink-0 text-[8px] text-[var(--control-selected-text)]">selected</span>
                          )}

                          {/* Expose per-structure actions on hover and keyboard focus. */}
                          {editingFrameId !== frame.id && (
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              <button
                                type="button"
                                aria-label={`Rename ${frame.label}`}
                                title="Rename this structure"
                                onClick={e => {
                                  e.stopPropagation()
                                  setEditingFrameId(frame.id)
                                  setEditingFrameLabel(frame.label)
                                }}
                                className="zatom-pressable flex h-5 w-5 items-center justify-center rounded text-[var(--panel-text-tertiary)] hover:text-[var(--panel-text)]"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Save ${frame.label} to Templates`}
                                title="Save this structure to Templates"
                                onClick={e => {
                                  e.stopPropagation()
                                  setTemplateNotice(null)
                                  setTemplateDraft({ frame, name: frame.label })
                                }}
                                className="zatom-pressable flex h-5 w-5 items-center justify-center rounded text-[var(--panel-text-tertiary)] hover:text-[var(--panel-text)]"
                              >
                                <Save className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuLabel>
                            {`${frame.latticeMatrix ? 'Crystal' : 'Molecule'} \u00B7 ${frame.atoms.length} atoms`}
                          </ContextMenuLabel>
                          <ContextMenuItem
                            icon={<Upload />}
                            disabled={isBound || !activeWs}
                            onSelect={() => { if (activeWs) loadFrame(frame, activeWs.id, batch.id) }}
                          >
                            {isBound ? 'Already in viewport' : 'Load into viewport'}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={<Pencil />}
                            onSelect={() => {
                              setEditingFrameId(frame.id)
                              setEditingFrameLabel(frame.label)
                            }}
                          >
                            Rename
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={<Save />}
                            onSelect={() => {
                              setTemplateNotice(null)
                              setTemplateDraft({ frame, name: frame.label })
                            }}
                          >
                            Save to Templates
                          </ContextMenuItem>
                          {/* moveFramesToBatch existed on the port with zero UI
                              consumers. A submenu is the only shape that fits:
                              the target is a runtime list, so it cannot be a
                              flat item, and a dialog would be heavier than the
                              action. */}
                          <ContextMenuSub>
                            <ContextMenuSubTrigger
                              icon={<FolderInput />}
                              disabled={activeWs ? activeWs.batches.length < 2 : true}
                            >
                              Move to batch
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              {(activeWs?.batches ?? [])
                                .filter(b => b.id !== batch.id)
                                .map(target => (
                                  <ContextMenuItem
                                    key={target.id}
                                    onSelect={() => {
                                      moveFramesToBatch([frame.id], target.id)
                                    }}
                                  >
                                    {`${target.name} (${target.frameIds.length})`}
                                  </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            icon={<Trash2 />}
                            destructive
                            onSelect={() => {
                              removeFramesFromActiveBatch([frame.id])
                            }}
                          >
                            Remove from batch
                          </ContextMenuItem>
                        </ContextMenuContent>
                        </ContextMenuRoot>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Keep one save-as-template editor at panel level; Escape cancels and input receives focus. */}
      {templateDraft && (
        <div className="border-t border-[var(--panel-border)] px-3 py-2">
          <div className="mb-1.5 text-[10px] text-[var(--panel-text-secondary)]">
            Save to Templates
          </div>
          <input
            autoFocus
            value={templateDraft.name}
            onChange={e => setTemplateDraft({ ...templateDraft, name: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') saveDraftAsTemplate()
              if (e.key === 'Escape') { setTemplateDraft(null); setTemplateNotice(null) }
            }}
            aria-label="Template name"
            className="zatom-field mb-1.5 w-full rounded px-2 py-1 text-[11px]"
          />
          <div className="mb-1.5 text-[9px] text-[var(--panel-text-tertiary)]">
            {templateDraft.frame.atoms.length} atoms · a duplicate name gets a numeric suffix
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={saveDraftAsTemplate}
              disabled={!templateDraft.name.trim()}
              className="zatom-choice zatom-pressable flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium disabled:opacity-40"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
            <button
              type="button"
              onClick={() => { setTemplateDraft(null); setTemplateNotice(null) }}
              className="zatom-pressable flex h-6 items-center rounded-md px-2 text-[10px] text-[var(--panel-text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {templateNotice && !templateDraft && (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--panel-border)] px-3 py-1.5">
          <span className="text-[10px] text-[var(--panel-text-secondary)]">{templateNotice}</span>
          <button
            type="button"
            onClick={() => setTemplateNotice(null)}
            aria-label="Dismiss"
            className="zatom-pressable shrink-0 rounded px-1 text-[10px] text-[var(--panel-text-tertiary)]"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
