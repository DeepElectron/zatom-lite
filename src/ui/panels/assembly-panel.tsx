"use client"

import { useState } from "react"
import { 
  Plus, 
  Minus,
  Trash2, 
  Copy, 
  RotateCcw,
  Move3D,
  Box,
  Hexagon,
  ChevronDown,
  ChevronRight,
  Save,
  Move,
  RotateCw,
  MousePointer2,
  Grid3X3,
  Download,
  ChevronLeft,
  PanelLeft,
  PictureInPicture2,
  Pencil,
  LogIn,
} from "lucide-react"
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "../ui-kit/context-menu"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getElement } from "../../lib/crystal/elements"
import { wrapFractional } from "../../lib/crystal/lattice"
import { computeAssemblyGeometry } from "../../lib/assembly/computeAssemblyGeometry"
import { useWorkspaceLayers } from "../../host"
import type { WorkspaceFrame } from "../../host"
import { BatchPanel } from "./batch-panel"
import { ConfirmDeleteDialog } from "./confirm-delete-dialog"
import { StructureLayersTree } from "./structure-layers-tree"
import { SlidingSegmented } from "./panel-ui"
import { ModelStorePanel } from "./model-store-panel"
import { LocalFolderImportPanel } from "./local-folder-import-panel"
import type { AssetsMode } from "./sidebar-tabs"

const ASSETS_PLACEMENT_OPTIONS = [
  { value: 'dock', label: 'Dock', icon: PanelLeft },
  { value: 'float', label: 'Float', icon: PictureInPicture2 },
] as const

const ASSEMBLY_TRANSFORM_MODE_OPTIONS = [
  { value: 'translate', label: 'Move', icon: Move },
  { value: 'rotate', label: 'Rotate', icon: RotateCw },
] as const

interface AssemblyPanelProps {
  assetsBlockFloating?: boolean
  onAssetsBlockFloatingChange?: (floating: boolean) => void
  assetsMode?: AssetsMode
}

export function AssemblyPanel({
  assetsBlockFloating = false,
  onAssetsBlockFloatingChange,
  assetsMode = 'assets',
}: AssemblyPanelProps = {}) {

  const buildingBlocks = useCrystalStore((s) => s.buildingBlocks)
  const sceneObjects = useCrystalStore((s) => s.sceneObjects)
  const selectedSceneObjectId = useCrystalStore((s) => s.selectedSceneObjectId)
  const removeSceneObject = useCrystalStore((s) => s.removeSceneObject)
  const removeBuildingBlock = useCrystalStore((s) => s.removeBuildingBlock)
  const duplicateBuildingBlock = useCrystalStore((s) => s.duplicateBuildingBlock)
  const selectSceneObject = useCrystalStore((s) => s.selectSceneObject)
  const duplicateSceneObject = useCrystalStore((s) => s.duplicateSceneObject)
  const updateSceneObjectRotation = useCrystalStore((s) => s.updateSceneObjectRotation)
  const assemblyTransformMode = useCrystalStore((s) => s.assemblyTransformMode)
  const setAssemblyTransformMode = useCrystalStore((s) => s.setAssemblyTransformMode)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const expandSceneObjectSupercell = useCrystalStore((s) => s.expandSceneObjectSupercell)
  const startPlacement = useCrystalStore((s) => s.startPlacement)
  const placementState = useCrystalStore((s) => s.placementState)
  
  const [blocksExpanded, setBlocksExpanded] = useState(true)
  const [sceneExpanded, setSceneExpanded] = useState(true)

  // The application supplies its browser-local workspace hook at startup.
  const { workspaceState, appendFrameToBatch } = useWorkspaceLayers()
  const periodicDirs = useCrystalStore(s => s.periodicDirs)
  const setPeriodicDirs = useCrystalStore(s => s.setPeriodicDirs)
  const freeDirPadding = useCrystalStore(s => s.freeDirPadding)
  const setFreeDirPadding = useCrystalStore(s => s.setFreeDirPadding)
  // Show transform controls only when drag-atom tool is active
  const showTransformControls = toolMode === 'drag-atom'
  
  // Generate Assembly CIF content.
  const generateAssemblyCIF = (): string | null => {
    try {
      const geometry = computeAssemblyGeometry(sceneObjects, buildingBlocks, periodicDirs, freeDirPadding)
      if (!geometry) return null

      const { atoms: allCartesianAtoms, latticeVectors, hasMolecule } = geometry

    // Convert cartesian to fractional coordinates
    const [va, vb, vc] = (latticeVectors ?? []) as number[][]
    
    // Lattice matrix M (column vectors)
    // M = | va[0] vb[0] vc[0] |
    //     | va[1] vb[1] vc[1] |
    //     | va[2] vb[2] vc[2] |
    const m00 = va[0], m01 = vb[0], m02 = vc[0]
    const m10 = va[1], m11 = vb[1], m12 = vc[1]
    const m20 = va[2], m21 = vb[2], m22 = vc[2]
    
    // Determinant
    const det = m00*(m11*m22 - m12*m21) - m01*(m10*m22 - m12*m20) + m02*(m10*m21 - m11*m20)
    
    // Inverse matrix (adjugate / determinant)
    const inv00 = (m11*m22 - m12*m21) / det
    const inv01 = (m02*m21 - m01*m22) / det
    const inv02 = (m01*m12 - m02*m11) / det
    const inv10 = (m12*m20 - m10*m22) / det
    const inv11 = (m00*m22 - m02*m20) / det
    const inv12 = (m02*m10 - m00*m12) / det
    const inv20 = (m10*m21 - m11*m20) / det
    const inv21 = (m01*m20 - m00*m21) / det
    const inv22 = (m00*m11 - m01*m10) / det
    
    const elementCount: Record<string, number> = {}
    const allAtoms = allCartesianAtoms.map(atom => {
      const [x, y, z] = atom.cartesian
      // Fractional = inv(M) * cartesian
      let fracX = inv00*x + inv01*y + inv02*z
      let fracY = inv10*x + inv11*y + inv12*z
      let fracZ = inv20*x + inv21*y + inv22*z
      
      // Only wrap to [0, 1) range for purely periodic structures (no molecules)
      // For slab models with molecules, keep actual coordinates to preserve molecule positions
      if (!hasMolecule) {
        fracX = wrapFractional(fracX)
        fracY = wrapFractional(fracY)
        fracZ = wrapFractional(fracZ)
      }
      
      elementCount[atom.element] = (elementCount[atom.element] || 0) + 1
      return {
        element: atom.element,
        fractional: [fracX, fracY, fracZ] as [number, number, number],
        label: `${atom.element}${elementCount[atom.element]}`
      }
    })
    
    // Calculate lattice parameters
    const aMag = Math.sqrt(va[0]**2 + va[1]**2 + va[2]**2)
    const bMag = Math.sqrt(vb[0]**2 + vb[1]**2 + vb[2]**2)
    const cMag = Math.sqrt(vc[0]**2 + vc[1]**2 + vc[2]**2)
    const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot(vb, vc) / (bMag * cMag)))) * 180 / Math.PI
    const beta = Math.acos(Math.max(-1, Math.min(1, dot(va, vc) / (aMag * cMag)))) * 180 / Math.PI
    const gamma = Math.acos(Math.max(-1, Math.min(1, dot(va, vb) / (aMag * bMag)))) * 180 / Math.PI
    
    // Generate chemical formula
    const formulaParts = Object.entries(elementCount)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([el, count]) => count === 1 ? el : `${el}${count}`)
      .join(' ')
    
    // Generate CIF content with proper formatting
    let content = `data_assembly
_audit_creation_method           'Generated by Zatom'
# ${hasMolecule ? 'Assembled structure with molecule on periodic surface' : 'Periodic crystal structure'}

_chemical_formula_sum            '${formulaParts}'

_symmetry_space_group_name_H-M   'P 1'
_symmetry_Int_Tables_number      1
_symmetry_cell_setting           triclinic

_cell_length_a                   ${aMag.toFixed(6)}
_cell_length_b                   ${bMag.toFixed(6)}
_cell_length_c                   ${cMag.toFixed(6)}
_cell_angle_alpha                ${(isNaN(alpha) ? 90 : alpha).toFixed(4)}
_cell_angle_beta                 ${(isNaN(beta) ? 90 : beta).toFixed(4)}
_cell_angle_gamma                ${(isNaN(gamma) ? 90 : gamma).toFixed(4)}

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
`
    
    allAtoms.forEach(atom => {
      // Format: label(8) symbol(4) x(12) y(12) z(12) occ(6)
      const x = atom.fractional[0].toFixed(8)
      const y = atom.fractional[1].toFixed(8)
      const z = atom.fractional[2].toFixed(8)
      content += `${atom.label.padEnd(8)}${atom.element.padEnd(4)}${x.padStart(12)}${y.padStart(12)}${z.padStart(12)}    1.0000\n`
    })
    
    return content
    } catch (error) {
      console.error('Export assembly error:', error)
      return null
    }
  }

  const handleExportAssembly = () => {
    const content = generateAssemblyCIF()
    if (!content) return
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a_elem = document.createElement("a")
    a_elem.href = url
    a_elem.download = "assembly.cif"
    a_elem.style.display = 'none'
    document.body.appendChild(a_elem)
    a_elem.click()
    setTimeout(() => {
      document.body.removeChild(a_elem)
      URL.revokeObjectURL(url)
    }, 100)
  }

  const selectedObject = sceneObjects.find(o => o.id === selectedSceneObjectId)
  const selectedBlock = selectedObject ? buildingBlocks.find(b => b.id === selectedObject.blockId) : null

  const assemblyScenes = useCrystalStore((s) => s.assemblyScenes)
  const activeSceneId = useCrystalStore((s) => s.activeSceneId)
  const createScene = useCrystalStore((s) => s.createScene)
  const deleteScene = useCrystalStore((s) => s.deleteScene)
  const enterScene = useCrystalStore((s) => s.enterScene)
  const exitScene = useCrystalStore((s) => s.exitScene)
  // renameScene existed on mode-slice with zero UI consumers before this.
  const renameScene = useCrystalStore((s) => s.renameScene)
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null)
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [editingSceneName, setEditingSceneName] = useState('')

  // Model Store replaces only the Assets overview; the scene editor owns active scenes.
  if (!activeSceneId && assetsMode === 'store') {
    return <ModelStorePanel />
  }

  /** A bound folder needs its own scroll container because directory depth is unbounded. */
  if (!activeSceneId && assetsMode === 'folder') {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="px-5 pt-5 pb-3 shrink-0">
          <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-secondary)' }}>
            Local folder
          </span>
          <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', marginTop: 2 }}>
            Bind a directory on disk and browse its structure files in place
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 custom-scrollbar">
          <LocalFolderImportPanel />
        </div>
      </div>
    )
  }

  // ── Scene overview (not editing) ──
  if (!activeSceneId) {
    return (
      <>
      <div className="w-full h-full flex flex-col">
        <div className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-secondary)' }}>
              Assets
            </span>
            <SlidingSegmented
              options={ASSETS_PLACEMENT_OPTIONS}
              value={assetsBlockFloating ? 'float' : 'dock'}
              onChange={(placement) => {
                const floating = placement === 'float'
                if (floating === assetsBlockFloating) return
                onAssetsBlockFloatingChange?.(floating)
              }}
              ariaLabel="Assets panel placement"
              className="w-[142px] shrink-0"
            />
          </div>
          <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', marginTop: 2 }}>
            Drag any asset into the viewport to merge · {assemblyScenes.length} scenes
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 custom-scrollbar">
          {/* Workspace and batches stay first; floating mode renders the actual BatchPanel elsewhere. */}
          {assetsBlockFloating ? (
            <div className="rounded-lg border border-dashed border-[var(--panel-border)] p-4 text-center" style={{ color: 'var(--panel-text-tertiary)', fontSize: 11 }}>
              <p>Assets block is floating</p>
              <button
                onClick={() => onAssetsBlockFloatingChange?.(false)}
                className="zatom-choice zatom-pressable mt-2 rounded px-2 py-1 text-[10px]"
              >
                Dock back
              </button>
            </div>
          ) : (
            <BatchPanel />
          )}

          <div style={{ height: 1, flexShrink: 0, backgroundColor: 'var(--panel-border)' }} />

          {/* Composite structure layer tree. */}
          <StructureLayersTree />

          {/* Saved assembly scenes. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-secondary)' }}>
                Scenes ({assemblyScenes.length})
              </span>
              <button
                onClick={() => { createScene(`Scene ${assemblyScenes.length + 1}`);  }}
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--panel-text-secondary)' }}
                title="New Scene"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {assemblyScenes.length === 0 ? (
              <button
                onClick={() => { createScene('Scene 1');  }}
                className="zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-3 hover:bg-[var(--panel-elevated)]"
                style={{ border: '1px dashed var(--panel-border-focus)', color: 'var(--panel-text-secondary)', fontSize: 12 }}
              >
                <Plus className="w-3.5 h-3.5" />
                Create first scene
              </button>
            ) : (
              <div className="space-y-1.5">
                {assemblyScenes.map(scene => {
                  const isExpanded = expandedSceneId === scene.id
                  return (
                    <div key={scene.id} className="rounded-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
                    >
                      {/* Scene header */}
                      <ContextMenuRoot>
                      <ContextMenuTrigger asChild>
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button onClick={() => setExpandedSceneId(isExpanded ? null : scene.id)}
                          style={{ color: 'var(--panel-text-tertiary)' }}
                        >
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        {editingSceneId === scene.id ? (
                          <input
                            autoFocus
                            value={editingSceneName}
                            onChange={(e) => setEditingSceneName(e.target.value)}
                            onBlur={() => {
                              const n = editingSceneName.trim()
                              if (n && n !== scene.name) renameScene(scene.id, n)
                              setEditingSceneId(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const n = editingSceneName.trim()
                                if (n && n !== scene.name) renameScene(scene.id, n)
                                setEditingSceneId(null)
                              }
                              if (e.key === 'Escape') setEditingSceneId(null)
                            }}
                            className="zatom-field flex-1 rounded px-1.5 py-0.5 text-[12px]"
                          />
                        ) : (
                          <button
                            onClick={() => { enterScene(scene.id);  }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div style={{ fontSize: 12, color: 'var(--panel-text)' }} className="truncate">{scene.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>
                              {scene.objects.length} objects
                            </div>
                          </button>
                        )}
                        <button onClick={() => { deleteScene(scene.id);  }}
                          className="p-1 rounded transition-colors"
                          style={{ color: 'var(--panel-text-tertiary)' }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuLabel>
                          {`${scene.name} \u00B7 ${scene.objects.length} objects`}
                        </ContextMenuLabel>
                        <ContextMenuItem
                          icon={<LogIn />}
                          onSelect={() => { enterScene(scene.id);  }}
                        >
                          Enter scene
                        </ContextMenuItem>
                        <ContextMenuItem
                          icon={<Pencil />}
                          onSelect={() => { setEditingSceneId(scene.id); setEditingSceneName(scene.name) }}
                        >
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem
                          icon={<Plus />}
                          onSelect={() => { createScene(`Scene ${assemblyScenes.length + 1}`);  }}
                        >
                          New scene
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          icon={<Trash2 />}
                          destructive
                          onSelect={() => { deleteScene(scene.id);  }}
                        >
                          Delete scene
                        </ContextMenuItem>
                      </ContextMenuContent>
                      </ContextMenuRoot>

                      {/* Expanded: show objects */}
                      {isExpanded && scene.objects.length > 0 && (
                        <div className="px-3 pb-2 space-y-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
                          {scene.objects.map((obj, i) => {
                            const block = buildingBlocks.find(b => b.id === obj.blockId)
                            return (
                              <div key={obj.id} className="flex items-center gap-2 py-1.5 px-2"
                                style={{ fontSize: 11, color: 'var(--panel-text-secondary)' }}
                              >
                                <span style={{ color: 'var(--panel-text-tertiary)', fontSize: 10, fontFamily: 'monospace' }}>{i + 1}</span>
                                <span className="truncate">{block?.name ?? 'Unknown'}</span>
                                <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                                  ({obj.position[0].toFixed(1)}, {obj.position[1].toFixed(1)}, {obj.position[2].toFixed(1)})
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
      </>
    )
  }

  // ── Scene editor (inside assembly) ──
  const activeScene = assemblyScenes.find(s => s.id === activeSceneId)

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header with back button */}
      <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-3" style={{ borderBottom: '1px solid var(--panel-border)' }}>
        <button
          onClick={() => { exitScene();  }}
          className="p-1 rounded-md transition-colors"
          style={{ color: 'var(--panel-text-secondary)' }}
          title="Exit Scene"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--panel-text)' }}>
            {activeScene?.name ?? 'Scene'}
          </span>
          <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', marginTop: 1 }}>
            {sceneObjects.length} objects · {buildingBlocks.length} blocks
          </p>
        </div>
        <button
          onClick={() => onAssetsBlockFloatingChange?.(!assetsBlockFloating)}
          className="zatom-choice zatom-pressable ml-auto rounded-md px-2 py-1 text-[11px]"
          title={assetsBlockFloating ? 'Dock back to sidebar' : 'Float Assets as a separate window'}
        >
          {assetsBlockFloating ? 'Dock Assets' : 'Float Assets'}
        </button>
      </div>

      {/* Transform Mode Buttons - Only show when Drag Atom tool is active */}
      {showTransformControls && (
        <div className="px-4 py-3 border-b border-[var(--glass-border-subtle)]">
          <div className="text-[10px] text-white/50 mb-2 uppercase tracking-wider">Transform Mode</div>
          <SlidingSegmented
            options={ASSEMBLY_TRANSFORM_MODE_OPTIONS}
            value={assemblyTransformMode}
            onChange={setAssemblyTransformMode}
            ariaLabel="Transform mode"
          />
        </div>
      )}

  {/* Content - scrollable area */}
<div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
        {/* Building Blocks Library */}
        <div className="rounded-xl bg-black/30 border border-white/5 overflow-hidden">
          <button
            onClick={() => {
              setBlocksExpanded(!blocksExpanded)
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 transition-colors"
          >
            <span className="text-xs font-medium text-white/80 uppercase tracking-wider">
              Building Blocks ({buildingBlocks.length})
            </span>
            {blocksExpanded ? (
              <ChevronDown className="w-4 h-4 text-white/40" />
            ) : (
              <ChevronRight className="w-4 h-4 text-white/40" />
            )}
          </button>
          
          {blocksExpanded && (
            <div className="px-3 pb-3 space-y-2">
              {buildingBlocks.length === 0 ? (
                <div className="text-center py-6">
                  <Box className="w-8 h-8 mx-auto text-white/20 mb-2" />
                  <p className="text-[11px] text-white/40">No building blocks yet</p>
                  <p className="text-[10px] text-white/30 mt-1">
                    Build a structure in Crystal or Molecule mode,<br />then save it as a building block
                  </p>
                </div>
              ) : (
                buildingBlocks.map(block => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: block.type === 'crystal' ? 'var(--badge-6)' : 'var(--badge-2)' }}>
                      {block.type === 'crystal' ? (
                        <Hexagon className="w-4 h-4 text-[var(--badge-fg)]" />
                      ) : (
                        <Box className="w-4 h-4 text-[var(--badge-fg)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{block.name}</div>
                      <div className="text-[10px] text-white/40">
                        {block.atoms.length} atoms, {block.bonds.length} bonds
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        startPlacement(block.id)
                      }}
                      disabled={placementState.step !== 'idle'}
                      className="zatom-primary zatom-pressable rounded-md p-1.5"
                      title="Add to scene"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        duplicateBuildingBlock(block.id)
                      }}
                      className="zatom-pressable rounded-md p-1.5 text-[var(--panel-text-tertiary)] opacity-0 hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] group-hover:opacity-100"
                      title="Duplicate block"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <ConfirmDeleteDialog
                      title={`Delete “${block.name}”?`}
                      description={sceneObjects.some((object) => object.blockId === block.id)
                        ? `This also removes ${sceneObjects.filter((object) => object.blockId === block.id).length} placed Scene Object(s). You can undo this action.`
                        : 'This removes the saved Building Block. You can undo this action.'}
                      confirmLabel="Delete Block"
                      onConfirm={() => { removeBuildingBlock(block.id);  }}
                    >
                      <button
                        type="button"
                        aria-label={`Delete ${block.name}`}
                        className="status-hover-red p-1.5 rounded-md text-[var(--panel-text-tertiary)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Delete Building Block"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </ConfirmDeleteDialog>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Scene Objects */}
        <div className="rounded-xl bg-black/30 border border-white/5 overflow-hidden">
          <button
            onClick={() => {
              setSceneExpanded(!sceneExpanded)
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 transition-colors"
          >
            <span className="text-xs font-medium text-white/80 uppercase tracking-wider">
              Scene Objects ({sceneObjects.length})
            </span>
            {sceneExpanded ? (
              <ChevronDown className="w-4 h-4 text-white/40" />
            ) : (
              <ChevronRight className="w-4 h-4 text-white/40" />
            )}
          </button>
          
          {sceneExpanded && (
            <div className="px-3 pb-3 space-y-1">
              {sceneObjects.length === 0 ? (
                <div className="text-center py-6">
                  <Move3D className="w-8 h-8 mx-auto text-white/20 mb-2" />
                  <p className="text-[11px] text-white/40">Scene is empty</p>
                  <p className="text-[10px] text-white/30 mt-1">
                    Add building blocks to the scene
                  </p>
                </div>
              ) : (
                sceneObjects.map((obj, idx) => {
                  const block = buildingBlocks.find(b => b.id === obj.blockId)
                  const isSelected = selectedSceneObjectId === obj.id
                  return (
                    <ContextMenuRoot key={obj.id}>
                    <ContextMenuTrigger asChild>
                    <div
                      onClick={() => {
                        selectSceneObject(obj.id)
                      }}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        isSelected 
                          ? 'bg-[#FF9F0A]/20 border border-[#FF9F0A]/50' 
                          : 'bg-white/5 hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      <div className="w-6 h-6 rounded flex items-center justify-center bg-white/10 text-[10px] font-mono text-white/60">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">{block?.name || 'Unknown'}</div>
                        <div className="text-[9px] text-white/40 font-mono">
                          ({obj.position[0].toFixed(1)}, {obj.position[1].toFixed(1)}, {obj.position[2].toFixed(1)})
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicateSceneObject(obj.id);  }}
                        className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        title="Duplicate"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSceneObject(obj.id);  }}
                        className="status-hover-red p-1 rounded text-[var(--panel-text-tertiary)] transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuLabel>
                        {`${block?.name ?? 'Unknown'} \u00B7 #${idx + 1}`}
                      </ContextMenuLabel>
                      <ContextMenuItem
                        icon={<MousePointer2 />}
                        disabled={isSelected}
                        onSelect={() => { selectSceneObject(obj.id);  }}
                      >
                        Select
                      </ContextMenuItem>
                      <ContextMenuItem
                        icon={<Copy />}
                        onSelect={() => { duplicateSceneObject(obj.id);  }}
                      >
                        Duplicate
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        icon={<Trash2 />}
                        destructive
                        onSelect={() => { removeSceneObject(obj.id);  }}
                      >
                        Remove from scene
                      </ContextMenuItem>
                    </ContextMenuContent>
                    </ContextMenuRoot>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Workspace batches — browser-local in standalone, host-injected when embedded. */}
        {/* Reuse the same Assets list in scene mode so edits never target a hidden duplicate. */}
        {assetsBlockFloating ? (
          <div className="rounded-xl border border-dashed border-[var(--panel-border)] p-4 text-center" style={{ color: "var(--panel-text-tertiary)", fontSize: 11 }}>
            <p>Assets block is floating</p>
            <button
              onClick={() => onAssetsBlockFloatingChange?.(false)}
              className="zatom-choice zatom-pressable mt-2 rounded px-2 py-1 text-[10px]"
            >
              Dock back
            </button>
          </div>
        ) : (
          <BatchPanel />
        )}

        {/* Selected Object Properties */}
        {selectedObject && selectedBlock && (
          <div className="rounded-xl bg-black/30 border border-[#FF9F0A]/30 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--glass-border-subtle)]">
              <span className="text-xs font-medium text-[#FF9F0A]">
                Selected: {selectedBlock.name}
              </span>
            </div>
            <div className="px-3 py-3 space-y-3">
              {/* Supercell Expansion - Only for crystal blocks */}
              {selectedBlock.type === 'crystal' && selectedBlock.latticeVectors && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Grid3X3 className="w-3 h-3 text-[var(--control-selected-text)]" />
                    <span className="text-[10px] text-white/50 uppercase tracking-wider">Supercell Expansion</span>
                  </div>
                  <div className="flex gap-2">
                    {['a', 'b', 'c'].map((axis) => (
                      <div key={axis} className="flex-1">
                        <label className="text-[9px] text-white/40 block mb-0.5 text-center uppercase">{axis}</label>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => {
                              expandSceneObjectSupercell?.(selectedObject.id, axis as 'a' | 'b' | 'c', -1)
                            }}
                            className="flex-none w-6 h-6 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <div className="flex-1 px-1 py-1 rounded text-[11px] bg-black/40 border border-white/10 text-white text-center">
                            {(selectedObject as any).supercell?.[axis] || 1}
                          </div>
                          <button
                            onClick={() => {
                              expandSceneObjectSupercell?.(selectedObject.id, axis as 'a' | 'b' | 'c', 1)
                            }}
                            className="flex-none w-6 h-6 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Rotation */}
              <div>
                <div className="text-[10px] text-white/50 mb-1.5">Rotation (degrees)</div>
                <div className="flex gap-2">
                  {['X', 'Y', 'Z'].map((axis, i) => (
                    <div key={axis} className="flex-1">
                      <label className="text-[9px] text-white/40 block mb-0.5">{axis}</label>
                      <input
                        type="number"
                        value={Math.round(selectedObject.rotation[i] * 180 / Math.PI)}
                        onChange={(e) => {
                          const newRot = [...selectedObject.rotation] as [number, number, number]
                          newRot[i] = parseFloat(e.target.value) * Math.PI / 180
                          updateSceneObjectRotation(selectedObject.id, newRot)
                        }}
                        className="w-full px-2 py-1 rounded text-[11px] bg-black/40 border border-white/10 text-white outline-none focus:border-[#FF9F0A]"
                      />
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Reset rotation button */}
              <button
                onClick={() => {
                  updateSceneObjectRotation(selectedObject.id, [0, 0, 0])
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-[11px] transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Rotation
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Export Button */}
      {sceneObjects.length > 0 && (<>
        {buildingBlocks.some(b => b.type === 'crystal' && b.latticeVectors) && (
          <div className="px-4 py-2.5 border-t border-[var(--glass-border-subtle)]">
            <div className="text-[10px] text-white/50 font-medium mb-1.5">Periodicity</div>
            <div className="flex gap-2">
              {(['a', 'b', 'c'] as const).map(dir => (
                <button
                  key={dir}
                  onClick={() => setPeriodicDirs({ ...periodicDirs, [dir]: !periodicDirs[dir] })}
                  aria-pressed={periodicDirs[dir]}
                  data-selected={periodicDirs[dir]}
                  className="zatom-choice zatom-pressable flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium"
                  style={periodicDirs[dir] ? undefined : { color: 'var(--status-red)' }}
                >
                  <span className="text-[11px] font-bold">{dir}</span>
                  <span>{periodicDirs[dir] ? 'periodic' : 'free'}</span>
                </button>
              ))}
            </div>
            {/* Independent padding on each free-direction side. */}
            {(['a', 'b', 'c'] as const).some(d => !periodicDirs[d]) && (
              <div className="mt-2 space-y-2">
                {(['a', 'b', 'c'] as const).map(dir => !periodicDirs[dir] && (
                  <div key={dir} className="space-y-1">
                    {/* a/b/c are lattice-axis names, not status values. */}
                    <div className="text-[10px] font-bold text-[var(--panel-text-secondary)]">{dir}</div>
                    {/* Use the panel accent for vacuum thickness because it carries no warning semantics. */}
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 text-[9px] text-[var(--panel-text-tertiary)]">−</span>
                      <input
                        type="range" min={0} max={20} step={0.5}
                        value={freeDirPadding[dir][0]}
                        onChange={(e) => setFreeDirPadding({ ...freeDirPadding, [dir]: [parseFloat(e.target.value), freeDirPadding[dir][1]] })}
                        className="flex-1 h-1 accent-[var(--panel-accent)]"
                      />
                      <span className="w-8 text-right text-[9px] text-[var(--panel-text-tertiary)]">{freeDirPadding[dir][0].toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 text-[9px] text-[var(--panel-text-tertiary)]">+</span>
                      <input
                        type="range" min={0} max={20} step={0.5}
                        value={freeDirPadding[dir][1]}
                        onChange={(e) => setFreeDirPadding({ ...freeDirPadding, [dir]: [freeDirPadding[dir][0], parseFloat(e.target.value)] })}
                        className="flex-1 h-1 accent-[var(--panel-accent)]"
                      />
                      <span className="w-8 text-right text-[9px] text-[var(--panel-text-tertiary)]">{freeDirPadding[dir][1].toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--glass-border-subtle)]">
          <div className="flex gap-2">
            <button
              onClick={handleExportAssembly}
              className="zatom-primary zatom-pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Export .cif
            </button>
          </div>
          {/* Save to Workspace Batch */}
          {workspaceState.activeWorkspaceId && (
            <button
              onClick={() => {
                const activeWsLocal = workspaceState.workspaces.find(ws => ws.id === workspaceState.activeWorkspaceId)
                  ?? workspaceState.workspaces[0]
                const activeBatchLocal = activeWsLocal?.batches.find(b => b.id === activeWsLocal.activeBatchId)
                  ?? activeWsLocal?.batches[0]
                if (!activeWsLocal || !activeBatchLocal) return

                // Use exactly the same geometry source as CIF export.
                const geometry = computeAssemblyGeometry(sceneObjects, buildingBlocks, periodicDirs, freeDirPadding)
                if (!geometry || geometry.atoms.length === 0) return

                const frameAtoms = geometry.atoms.map(a => ({
                  element: getElement(a.element).atomicNumber,
                  position: a.cartesian,
                }))

                const frameLattice = geometry.latticeVectors
                  ? geometry.latticeVectors.map(v => v as [number, number, number])
                  : undefined

                const frame: WorkspaceFrame = {
                  id: `frame-assembly-${Date.now()}`,
                  label: `Assembly (${sceneObjects.length} objects, ${frameAtoms.length} atoms)`,
                  createdAt: new Date().toISOString(),
                  atoms: frameAtoms.map(a => ({ element: a.element, position: a.position as [number, number, number], selected: 0 as const })),
                  latticeMatrix: frameLattice as [number, number, number][] | undefined,
                  settings: {
                    stiffness: 100,
                    cutoff: 2,
                    forceField: 'none',
                    method: 'steepest_descent',
                  },
                  meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL', functionId: 'assembly_export', runState: 'idle' },
                }
                appendFrameToBatch(activeWsLocal.id, activeBatchLocal.id, frame)
              }}
              className="zatom-choice zatom-pressable mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium"
            >
              <Save className="w-3 h-3" />
              Save to Active Batch
            </button>
          )}
          <p className="text-[9px] text-[var(--text-tertiary)] text-center mt-2">
            Exports assembled structure with lattice parameters
          </p>
        </div>
      </>)}

      {/* Footer hint */}
      <div className="px-4 py-3 border-t border-[var(--glass-border-subtle)] rounded-br-[32px]">
        <p className="text-[10px] text-[var(--text-tertiary)] text-center">
          Drag objects in 3D view to reposition. Use scroll to zoom.
        </p>
      </div>
    </div>
  )
}
