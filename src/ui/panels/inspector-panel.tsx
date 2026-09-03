"use client"

import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react"
import { Focus, Download, Link, ChevronRight, ChevronLeft, Crosshair, Grid3X3, Maximize, Hexagon, Ruler, MousePointer, PenTool, Sun, BarChart3, Activity, Atom, Sparkles, Gem, Droplet, Beaker, SlidersHorizontal, MoreHorizontal, Layers, Layers2, Combine, Boxes, Spline, Magnet, Waves, LineChart, CircleDashed, Cylinder, Workflow, Palette, Clapperboard, LayoutGrid, ListTree, Settings, type LucideIcon } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useViewportManager, type ChartKind } from "../../orchestration/viewportManager"
import { useInstalledToolsStore, FUNCTION_ORDER, TOOL_LOCKED, TOOL_FAMILIES, TOOL_FAMILY_BY_ID } from "../../orchestration/installedToolsStore"
import { normalizePinnedFunctionIds, loadPinnedFunctionIds, savePinnedFunctionIds, FUNCTION_PINS_CHANGED } from "../../orchestration/functionPins"
import { summarizeCharge, formatCharge } from "../../lib/crystal/charge"
import { SearchFilterPanel } from "./search-filter-panel"
import { MeasurementPanel } from "./measurement-panel"
import { LatticeControls } from "./lattice-controls"
import { SymmetryPanel } from "./symmetry-panel"
import { BrillouinZoneSection } from "./brillouin-zone-section"
import { SelectionTools } from "./selection-tools"
import { useProximityReveal } from "./use-proximity-reveal"
import { SelectionInfo } from "./selection-info"
import { ClippingSettings } from "./clipping-settings"
import { SceneGridPanelSection } from "./scene-grid-panel"
import { BondSettings } from "./bond-settings"
import { AnalysisSettings } from "./analysis-settings"
import { PlaneBuilder } from "./plane-builder"
import { SlabBuilder } from "./slab-builder"
import { AdsorbateTool } from "./adsorbate-tool"
import { OverlayerBuilder } from "./overlayer-builder"
import { AmorphousBuilder } from "./amorphous-builder"
import { PolymerBuilder } from "./polymer-builder"
import { DislocationBuilderSection } from "./dislocation-builder"
import { MagnetismPanel } from "./magnetism-panel"
import { PorosityPanel } from "./porosity-panel"
import { ClusterBuilderSection } from "./cluster-builder"
import { WulffBuilderSection } from "./wulff-builder"
import { PolycrystalBuilderSection } from "./polycrystal-builder"
import { WaterLayerBuilderSection } from "./water-layer-builder"
import { HeterostructureBuilderSection } from "./heterostructure-builder"
import { MoireBuilderSection } from "./moire-builder"
import { NanotubeBuilderSection } from "./nanotube-builder"
import { PerovskiteBuilderSection } from "./perovskite-builder"
import { PolysulfideBuilderSection } from "./polysulfide-builder"
import { SingleAtomBuilderSection } from "./single-atom-builder"
import { DualAtomBuilderSection } from "./dual-atom-builder"
import { MofAnalyzerSection } from "./mof-analyzer"
import { ViewSettings } from "./view-settings"
import { VisualSettings } from "./visual-settings"
import { SlidingSegmented } from "./panel-ui"
import { LightingControls } from "./lighting-controls"
import { ExportPanel } from "./export-panel"
import { PlateExportPanel } from "./plate-export-panel"
import { ApiSettingsPanel } from "./api-settings-panel"
import { ELEMENTS } from "../../lib/crystal/elements"
import { getGlobalBackendClient } from "../../host"
import { AnimationWorkspace } from "./animation-workspace"
import { resolveInspectorWorkspace, type InspectorTab } from "./inspector-workspace-route"

const AgentModelingPanel = lazy(() => import('./agent-modeling-panel').then((module) => ({
  default: module.AgentModelingPanel,
})))

const HOST_ONLY_FUNCTION_IDS = new Set(['overlayer', 'amorphous', 'polymer'])

/**
 * functionItems entries that intentionally have no grid button. These are
 * reachable through another button, so listing them in FUNCTION_ORDER would
 * render a duplicate entry point; they exist only so the panel header can
 * resolve a label.
 */
const UNLISTED_BY_DESIGN = new Set(['analysis'])

/**
 * Dev-only guard for the reverse direction of installedToolsStore's integrity
 * check. That one walks FUNCTION_ORDER and reports ids missing a label/family,
 * so it cannot see a functionItems entry that FUNCTION_ORDER never lists — the
 * panel simply never renders its button, with no error anywhere. 'scenegrid'
 * shipped unreachable that way. Runs once per session; a no-op in production.
 */
let unreachableReported = false
function reportUnreachableFunctionItems(itemIds: string[]) {
  if (!import.meta.env?.DEV || unreachableReported) return
  unreachableReported = true
  const unreachable = itemIds.filter((id) => !FUNCTION_ORDER.includes(id as never) && !UNLISTED_BY_DESIGN.has(id))
  if (unreachable.length > 0) {
    console.error(
      '[zatom] Function entries absent from FUNCTION_ORDER will not render:',
      unreachable,
    )
  }
}

// --- Grid button ---

function GridBtn({
  icon, label, active, onClick, disabled, reason, selectedOrder, compact = false, familyColor,
  draggable = false, onDragStart, onDragOver, onDrop, onDragEnd, isDragTarget = false, isDragging = false,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
  /** Why the tool is unavailable. A gate that stays silent reads as a broken
   *  button — the label alone never tells you a lattice is what's missing. */
  reason?: string
  selectedOrder?: number
  compact?: boolean
  /** Tool-family tint (see TOOL_FAMILIES). Applied as a faint hover background,
   *  so it never affects the button's size or reflows the grid. */
  familyColor?: string
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void
  onDrop?: () => void
  onDragEnd?: () => void
  isDragTarget?: boolean
  isDragging?: boolean
}) {
  const canDrag = draggable && !disabled
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => { if (!disabled) { onClick();  } }}
      disabled={disabled}
      title={disabled && reason ? `${label} — ${reason}` : undefined}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) return
        const { width, height } = event.currentTarget.getBoundingClientRect()
        const dragPreview = document.createElement('div')
        dragPreview.style.width = `${width}px`
        dragPreview.style.height = `${height}px`
        dragPreview.style.borderRadius = '12px'
        dragPreview.style.border = '1px solid var(--control-selected-border)'
        dragPreview.style.background = 'transparent'
        dragPreview.style.boxSizing = 'border-box'
        dragPreview.style.position = 'fixed'
        dragPreview.style.top = '-1000px'
        dragPreview.style.left = '-1000px'
        dragPreview.style.pointerEvents = 'none'
        document.body.appendChild(dragPreview)
        event.dataTransfer.setDragImage(dragPreview, width / 2, height / 2)
        window.setTimeout(() => dragPreview.remove(), 0)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', label)
        onDragStart?.()
      }}
      onDragOver={(event) => {
        if (!canDrag) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver?.(event)
      }}
      onDrop={(event) => {
        if (!canDrag) return
        event.preventDefault()
        onDrop?.()
      }}
      onDragEnd={() => {
        if (!canDrag) return
        onDragEnd?.()
      }}
      className="modeler-function-grid-button zatom-choice zatom-pressable group relative flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3"
      data-selected={active}
      data-compact={compact || undefined}
      /* CSS owns the family hover tint and transition; data-family is only its selector hook. */
      data-family={familyColor && !isDragging ? '' : undefined}
      style={{
        '--tool-family': familyColor ?? 'transparent',
        backgroundColor: isDragging ? 'transparent' : undefined,
        borderStyle: isDragTarget || isDragging ? 'dashed' : undefined,
        borderColor: isDragTarget || isDragging ? 'var(--control-selected-border)' : undefined,
        color: disabled ? 'var(--panel-text-tertiary)' : undefined,
        boxShadow: 'none',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : canDrag ? 'grab' : 'pointer',
      } as React.CSSProperties}
    >
      <span className="modeler-function-grid-button-content relative z-10 flex flex-col items-center justify-center gap-1.5" style={{ opacity: isDragging ? 0 : 1 }}>
        <span>{icon}</span>
        <span className="modeler-function-grid-button-label" style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0, lineHeight: 1.1 }}>{label}</span>
      </span>
      {selectedOrder !== undefined && !isDragging && (
        <span
          className="absolute right-1.5 top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full px-1"
          style={{ fontSize: 9, color: 'var(--control-primary-text)', backgroundColor: 'var(--control-primary-bg)' }}
        >
          {selectedOrder}
        </span>
      )}
    </button>
  )
}

/**
 * Colour key for the tool-family hover tints. Rendered above the expanded grid so
 * the tints are decodable without reordering the tools or breaking the flat grid
 * into labelled sections. Families with no available tool are omitted.
 */
function FamilyLegend({ availableIds }: { availableIds: string[] }) {
  const present = TOOL_FAMILIES.filter((family) => family.ids.some((id) => availableIds.includes(id)))
  if (present.length < 2) return null
  return (
    <div className="mb-1.5 px-0.5">
      {/* Keep the auxiliary key to one line so it does not split the flat tool grid. */}
      <ul className="flex items-center gap-x-1.5 overflow-hidden" aria-label="Tool group colour key">
        {present.map((family) => (
          <li key={family.id} className="flex shrink-0 items-center gap-1">
            {/* Match the swatch to the button's tinted fill and stronger border. */}
            <span
              aria-hidden
              className="h-2 w-2 rounded-[3px] border"
              style={{
                background: `color-mix(in oklab, ${family.color} 45%, transparent)`,
                borderColor: `color-mix(in oklab, ${family.color} 70%, transparent)`,
              }}
            />
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--panel-text-tertiary)' }}>
              {family.label}
            </span>
          </li>
        ))}
        {/* A quiet trailing note clarifies when the tint appears. */}
        <li
          aria-hidden
          className="shrink-0"
          style={{ fontSize: 9, letterSpacing: '0.02em', color: 'var(--panel-text-tertiary)', opacity: 0.45 }}
        >
          hover
        </li>
      </ul>
    </div>
  )
}

export function InspectorPanel({
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onWidthChange,
}: {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onWidthChange?: (width: number) => void
} = {}) {
  const [localCollapsed, setLocalCollapsed] = useState(true)
  const collapsed = controlledCollapsed ?? localCollapsed
  const setCollapsed = (value: boolean) => {
    setLocalCollapsed(value)
    onCollapsedChange?.(value)
  }
  const [activeFunc, setActiveFunc] = useState<string | null>('tools')
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>('functions')
  const [animationOpen, setAnimationOpen] = useState(false)
  const activeWorkspace = resolveInspectorWorkspace(animationOpen, activeInspectorTab)
  const [functionsExpanded, setFunctionsExpanded] = useState(false)
  const [editingFunctions, setEditingFunctions] = useState(false)
  const [defaultEditSlotIndex, setDefaultEditSlotIndex] = useState(5)
  const [pinnedFunctionIds, setPinnedFunctionIds] = useState<string[]>(loadPinnedFunctionIds)
  const [draggedFunctionId, setDraggedFunctionId] = useState<string | null>(null)
  // Installed-tools set (curated via the marketplace "Modeling Tools" category).
  // Only installed functions appear in the panel; locked 4 are always installed.
  const installedTools = useInstalledToolsStore((s) => s.installed)
  const ensureToolsHydrated = useInstalledToolsStore((s) => s.ensureHydrated)
  useEffect(() => { ensureToolsHydrated() }, [ensureToolsHydrated])
  // Reload pins when a tool is installed elsewhere (marketplace auto-pin).
  useEffect(() => {
    const onPins = () => setPinnedFunctionIds(loadPinnedFunctionIds())
    window.addEventListener(FUNCTION_PINS_CHANGED, onPins)
    return () => window.removeEventListener(FUNCTION_PINS_CHANGED, onPins)
  }, [])
  const isToolInstalled = (id: string) => installedTools.has(id) || TOOL_LOCKED.includes(id)
  const atoms = useCrystalStore((s) => s.atoms)
  const trajectoryFrameCount = useCrystalStore((s) => s.trajectoryFrames?.length ?? 0)
  const bonds = useCrystalStore((s) => s.bonds)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const periodic = useCrystalStore((s) => s.periodic)
  // Hierarchical drilling requires biomolecular chain and secondary-structure data.
  const hasBioStructure = useCrystalStore((s) => s.bioStructure !== null)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const hasBackend = getGlobalBackendClient() !== null

  const axisCleaveRequest = useCrystalStore((s) => s.axisCleaveRequest)
  // Axis-menu cleave requests open the Slab controls that consume the request.
  useEffect(() => {
    if (!axisCleaveRequest) return
    setActiveInspectorTab('functions')
    setActiveFunc('slab')
    setCollapsed(false)
  }, [axisCleaveRequest])

  const selectMode = useCrystalStore((s) => s.selectMode)
  // Entering face selection opens Plane controls once; later manual navigation wins.
  useEffect(() => {
    if (selectMode !== 'face') return
    setActiveInspectorTab('functions')
    setActiveFunc('plane')
    setCollapsed(false)
  }, [selectMode])

  const toolMode = useCrystalStore((s) => s.toolMode)
  // Entering bond mode opens its criteria panel once without pinning the user there.
  useEffect(() => {
    if (toolMode !== 'add-bond') return
    setActiveInspectorTab('functions')
    setActiveFunc('bond')
    setCollapsed(false)
  }, [toolMode])

  const activeVpId = useViewportManager((s) => s.activeViewportId)
  const viewports = useViewportManager((s) => s.viewports)
  const openChartSlot = useViewportManager((s) => s.openChartSlot)
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  const activeChartCount = Object.values(viewports).filter(
    (slot) => slot.kind === 'chart' && slot.sourceViewportId === activeVpId,
  ).length
  const hadChartRef = useRef(activeChartCount > 0)
  // The first chart opens Analysis settings; subsequent tab choices remain user-owned.
  useEffect(() => {
    const hasChart = activeChartCount > 0
    const justOpened = hasChart && !hadChartRef.current
    hadChartRef.current = hasChart
    if (!justOpened) return
    setActiveInspectorTab('functions')
    setActiveFunc('analysis')
    setCollapsed(false)
  }, [activeChartCount])

  const toggle = (id: string) => setActiveFunc(activeFunc === id ? null : id)
  const selectInspectorTab = (tab: InspectorTab) => {
    if (tab === activeInspectorTab) return
    setActiveInspectorTab(tab)
    setFunctionsExpanded(false)
    setEditingFunctions(false)
    setDraggedFunctionId(null)
  }
  const setPinned = (ids: readonly string[]) => {
    const normalized = normalizePinnedFunctionIds(ids)
    setPinnedFunctionIds(normalized)
    savePinnedFunctionIds(normalized)
  }

  /** Return id of the chart slot currently showing `kind` for the active VP, if any. */
  const activeChartSlot = (kind: ChartKind): string | null => {
    for (const slot of Object.values(viewports)) {
      if (slot.kind === 'chart' && slot.chartKind === kind && slot.sourceViewportId === activeVpId) {
        return slot.id
      }
    }
    return null
  }

  /** Toggle chart slot: open if none, close if one already exists for active VP. */
  const toggleChart = (kind: ChartKind) => {
    const existing = activeChartSlot(kind)
    if (existing) {
      closeChartSlot(existing)
    } else {
      openChartSlot(kind)
    }
  }

  const functionItems: Record<string, {
    id: string
    label: string
    icon: React.ReactNode
    active: boolean
    disabled?: boolean
    /** Shown on hover when `disabled`, so the gate explains itself. */
    reason?: string
    run: () => void
  }> = {
    modeling: { id: 'modeling', label: 'Agent', icon: <Workflow className="w-4 h-4" />, active: activeFunc === 'modeling', run: () => toggle('modeling') },
    tools: { id: 'tools', label: 'Tools', icon: <MousePointer className="w-4 h-4" />, active: activeFunc === 'tools', run: () => toggle('tools') },
    cell: { id: 'cell', label: 'Cell', icon: <Grid3X3 className="w-4 h-4" />, active: activeFunc === 'cell', disabled: !periodic, reason: 'needs a periodic cell', run: () => toggle('cell') },
    super: { id: 'super', label: 'Symmetry', icon: <Maximize className="w-4 h-4" />, active: activeFunc === 'super', disabled: !periodic, reason: 'needs a periodic cell', run: () => toggle('super') },
    bz: { id: 'bz', label: 'BZ', icon: <Hexagon className="w-4 h-4" />, active: activeFunc === 'bz', disabled: !periodic, reason: 'needs a periodic cell', run: () => toggle('bz') },
    measure: { id: 'measure', label: 'Measure', icon: <Ruler className="w-4 h-4" />, active: activeFunc === 'measure', run: () => toggle('measure') },
    bond: { id: 'bond', label: 'Bonds', icon: <Link className="w-4 h-4" />, active: activeFunc === 'bond', run: () => toggle('bond') },
    select: { id: 'select', label: 'Select', icon: <Crosshair className="w-4 h-4" />, active: activeFunc === 'select', run: () => toggle('select') },
    plane: { id: 'plane', label: 'Plane', icon: <PenTool className="w-4 h-4" />, active: activeFunc === 'plane', run: () => toggle('plane') },
    slab: { id: 'slab', label: 'Slab', icon: <Layers className="w-4 h-4" />, active: activeFunc === 'slab', disabled: !hasBackend && (!periodic || atoms.length === 0), run: () => toggle('slab') },
    adsorbate: { id: 'adsorbate', label: 'Adsorbate', icon: <Atom className="w-4 h-4" />, active: activeFunc === 'adsorbate', disabled: atoms.length === 0, run: () => toggle('adsorbate') },
    overlayer: { id: 'overlayer', label: 'Overlayer', icon: <Combine className="w-4 h-4" />, active: activeFunc === 'overlayer', disabled: atoms.length === 0, run: () => toggle('overlayer') },
    amorphous: { id: 'amorphous', label: 'Amorphous', icon: <Boxes className="w-4 h-4" />, active: activeFunc === 'amorphous', disabled: atoms.length === 0, run: () => toggle('amorphous') },
    polymer: { id: 'polymer', label: 'Polymer', icon: <Spline className="w-4 h-4" />, active: activeFunc === 'polymer', disabled: atoms.length === 0, run: () => toggle('polymer') },
    magnetism: { id: 'magnetism', label: 'Magnetism', icon: <Magnet className="w-4 h-4" />, active: activeFunc === 'magnetism', disabled: atoms.length === 0, run: () => toggle('magnetism') },
    porosity: { id: 'porosity', label: 'Porosity', icon: <Waves className="w-4 h-4" />, active: activeFunc === 'porosity', disabled: atoms.length === 0, run: () => toggle('porosity') },
    cluster: { id: 'cluster', label: 'Cluster', icon: <Sparkles className="w-4 h-4" />, active: activeFunc === 'cluster', run: () => toggle('cluster') },
    wulff: { id: 'wulff', label: 'Wulff', icon: <Gem className="w-4 h-4" />, active: activeFunc === 'wulff', disabled: !periodic, run: () => toggle('wulff') },
    polycrystal: { id: 'polycrystal', label: 'Polycrystal', icon: <Combine className="w-4 h-4" />, active: activeFunc === 'polycrystal', run: () => toggle('polycrystal') },
    // Needs a crystal on screen and a lattice: a Burgers vector is a lattice
    // translation, so without one there is nothing for it to be.
    dislocation: { id: 'dislocation', label: 'Dislocation', icon: <Spline className="w-4 h-4" />, active: activeFunc === 'dislocation', disabled: atoms.length === 0 || !periodic, run: () => toggle('dislocation') },
    hetero: { id: 'hetero', label: 'Hetero', icon: <Layers2 className="w-4 h-4" />, active: activeFunc === 'hetero', disabled: atoms.length === 0, run: () => toggle('hetero') },
    moire: { id: 'moire', label: 'Moiré', icon: <CircleDashed className="w-4 h-4" />, active: activeFunc === 'moire', run: () => toggle('moire') },
    nanotube: { id: 'nanotube', label: 'Nanotube', icon: <Cylinder className="w-4 h-4" />, active: activeFunc === 'nanotube', run: () => toggle('nanotube') },
    perovskite: { id: 'perovskite', label: 'Perovskite', icon: <Boxes className="w-4 h-4" />, active: activeFunc === 'perovskite', run: () => toggle('perovskite') },
    polysulfide: { id: 'polysulfide', label: 'Polysulfide', icon: <Spline className="w-4 h-4" />, active: activeFunc === 'polysulfide', run: () => toggle('polysulfide') },
    'single-atom': { id: 'single-atom', label: 'Single-atom', icon: <Sparkles className="w-4 h-4" />, active: activeFunc === 'single-atom', run: () => toggle('single-atom') },
    'dual-atom': { id: 'dual-atom', label: 'Dual-atom', icon: <Sparkles className="w-4 h-4" />, active: activeFunc === 'dual-atom', run: () => toggle('dual-atom') },
    water: { id: 'water', label: 'Water', icon: <Droplet className="w-4 h-4" />, active: activeFunc === 'water', run: () => toggle('water') },
    mof: { id: 'mof', label: 'MOF', icon: <Beaker className="w-4 h-4" />, active: activeFunc === 'mof', run: () => toggle('mof') },
    clip: { id: 'clip', label: 'Clip', icon: <Focus className="w-4 h-4" />, active: activeFunc === 'clip', run: () => toggle('clip') },
    scenegrid: { id: 'scenegrid', label: 'SceneGrid', icon: <LayoutGrid className="w-4 h-4" />, active: activeFunc === 'scenegrid', disabled: atoms.length === 0, reason: 'needs atoms in the scene', run: () => toggle('scenegrid') },
    light: { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, active: activeFunc === 'light', run: () => toggle('light') },
    // Settings page for whichever chart panes are open. Deliberately absent
    // from FUNCTION_ORDER: the grid entries below (g(r) / XRD / eDiff) are its
    // entry points, so a separate grid button would just duplicate them. This
    // entry exists so the panel header can resolve a label for it.
    analysis: { id: 'analysis', label: 'Analysis', icon: <BarChart3 className="w-4 h-4" />, active: activeFunc === 'analysis', run: () => toggle('analysis') },
    rdf: { id: 'rdf', label: 'g(r)', icon: <BarChart3 className="w-4 h-4" />, active: activeChartSlot('rdf') !== null, disabled: atoms.length < 2, reason: 'needs 2+ atoms', run: () => toggleChart('rdf') },
    xrd: { id: 'xrd', label: 'XRD', icon: <Activity className="w-4 h-4" />, active: activeChartSlot('xrd') !== null, disabled: !periodic || atoms.length < 1, reason: 'needs a periodic cell', run: () => toggleChart('xrd') },
    ediff: { id: 'ediff', label: 'eDiff', icon: <Waves className="w-4 h-4" />, active: activeChartSlot('ediff') !== null, disabled: !periodic || atoms.length < 1, reason: 'needs a periodic cell', run: () => toggleChart('ediff') },
    convergence: { id: 'convergence', label: 'E/F', icon: <LineChart className="w-4 h-4" />, active: activeChartSlot('convergence') !== null, disabled: trajectoryFrameCount < 2, run: () => toggleChart('convergence') },
    ladder: { id: 'ladder', label: 'Ladder', icon: <ListTree className="w-4 h-4" />, active: activeChartSlot('ladder') !== null, disabled: !hasBioStructure, run: () => toggleChart('ladder') },
    // Export and movie share one structure-gated panel. Plate stays reachable so
    // its notice can explain how to add the second required populated viewport.
    export: { id: 'export', label: 'Export', icon: <Download className="w-4 h-4" />, active: activeFunc === 'export', disabled: atoms.length === 0, run: () => toggle('export') },
    plate: { id: 'plate', label: 'Plate', icon: <LayoutGrid className="w-4 h-4" />, active: activeFunc === 'plate', run: () => toggle('plate') },
    // Credentials must remain reachable precisely when they have not been configured.
    settings: { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, active: activeFunc === 'settings', run: () => toggle('settings') },
  }
  reportUnreachableFunctionItems(Object.keys(functionItems))
  const isToolAvailable = (id: string) => hasBackend || !HOST_ONLY_FUNCTION_IDS.has(id)
  const visibleFunctionIds = normalizePinnedFunctionIds(pinnedFunctionIds).filter((id) => isToolInstalled(id) && isToolAvailable(id))
  const hiddenFunctionIds = FUNCTION_ORDER.filter(
    (id) => !visibleFunctionIds.includes(id) && isToolInstalled(id) && isToolAvailable(id),
  )
  // Count both pinned overflow and the library because neither is visible at rest.
  const collapsedFunctionCount = Math.max(0, visibleFunctionIds.length - 3) + hiddenFunctionIds.length
  const markedFunctionIds = [...visibleFunctionIds, ...hiddenFunctionIds]
  const modelingWorkspace = activeFunc === 'modeling'
  const expandedWidth = modelingWorkspace ? 440 : 340
  const inspectorWidth = collapsed ? 52 : expandedWidth

  useEffect(() => {
    onWidthChange?.(inspectorWidth)
  }, [inspectorWidth, onWidthChange])

  // A collapsed right rail reveals itself as the pointer approaches its left edge.
  const proximityRef = useProximityReveal<HTMLElement>('right', collapsed)

  const runFunctionItem = (id: string) => {
    const item = functionItems[id]
    if (!item || item.disabled) return
    item.run()
    // Every selected function gets the freed vertical space, regardless of source row.
    setFunctionsExpanded(false)
    setEditingFunctions(false)
  }

  const toggleDefaultFunction = (id: string) => {
    if (!functionItems[id]) return
    const existingIndex = visibleFunctionIds.indexOf(id)
    if (existingIndex >= 0) {
      setDefaultEditSlotIndex(existingIndex)
      return
    }
    const next = [...visibleFunctionIds]
    next[Math.min(defaultEditSlotIndex, next.length - 1)] = id
    setPinned(next)
  }

  const dropDefaultFunction = (targetId: string) => {
    if (!draggedFunctionId || draggedFunctionId === targetId || !functionItems[draggedFunctionId] || !functionItems[targetId]) {
      setDraggedFunctionId(null)
      return
    }

    const next = [...visibleFunctionIds]
    const sourceIndex = next.indexOf(draggedFunctionId)
    const targetIndex = next.indexOf(targetId)

    if (sourceIndex >= 0 && targetIndex >= 0) {
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      setDefaultEditSlotIndex(targetIndex)
      setPinned(next)
    } else if (sourceIndex >= 0) {
      next[sourceIndex] = targetId
      setDefaultEditSlotIndex(sourceIndex)
      setPinned(next)
    } else if (targetIndex >= 0) {
      next[targetIndex] = draggedFunctionId
      setDefaultEditSlotIndex(targetIndex)
      setPinned(next)
    } else {
      const fallbackIndex = Math.min(defaultEditSlotIndex, next.length - 1)
      next[fallbackIndex] = draggedFunctionId
      setDefaultEditSlotIndex(fallbackIndex)
      setPinned(next)
    }

    setDraggedFunctionId(null)
  }

  return (
    <div className="pointer-events-auto h-full relative">
      <aside
        ref={proximityRef}
        className="modeler-side-panel flex h-full flex-col overflow-hidden transition-[width,background-color,border-color,box-shadow] duration-200 ease-out"
        data-collapsed={collapsed}
        aria-label={modelingWorkspace ? 'Agent workspace' : 'Inspector'}
        style={{
          width: inspectorWidth,
        }}
      >
        {/* Collapsed rail. */}
        {collapsed ? (
        <button
          type="button"
          aria-label="Expand Inspector"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          onClick={() => { setCollapsed(false);  }}
        >
          <ChevronLeft className="w-4 h-4" style={{ color: 'var(--panel-text-secondary)' }} />
          <span style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', fontSize: 10, fontWeight: 500, color: 'var(--panel-text-tertiary)', letterSpacing: '0.04em' }}>
            Inspector
          </span>
          <div className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: selectedAtomIds.size > 0 ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)' }} />
        </button>
        ) : null}

        <div
          aria-hidden={collapsed}
          className={`flex h-full flex-col transition-opacity duration-200 ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          style={{ minWidth: expandedWidth, visibility: collapsed ? 'hidden' : 'visible' }}
        >
        {modelingWorkspace ? (
          <div className="flex h-12 shrink-0 items-center justify-between px-4" style={{ borderBottom: '1px solid var(--panel-border)' }}>
            <button
              type="button"
              onClick={() => { setActiveFunc('tools');  }}
              className="zatom-pressable flex h-8 items-center gap-2 rounded-lg px-2.5 text-[11px] font-medium"
              style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Inspector
            </button>
            <button
              type="button"
              aria-label="Collapse Agent workspace"
              onClick={() => { setCollapsed(true);  }}
              className="zatom-pressable flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: 'var(--panel-text-secondary)' }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {/* ── Compact system data ── */}
        <div className={modelingWorkspace ? 'hidden' : 'shrink-0 px-5 py-3'} style={{ borderBottom: '1px solid var(--panel-border)' }}>
          <div className="flex h-8 min-w-0 items-stretch gap-1">
            <SystemDataCards
              atoms={atoms ?? []}
              bonds={bonds ?? []}
              periodic={!!periodic}
              supercellParams={supercellParams}
              selectedAtomCount={selectedAtomIds.size}
            />
            <div id="inspector-header-controls" className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              id="inspector-animation-toggle"
              type="button"
              aria-label={animationOpen ? 'Close Animation workspace' : 'Open Animation workspace'}
              aria-pressed={animationOpen}
              aria-expanded={animationOpen}
              aria-controls="inspector-animation-panel"
              title={animationOpen ? 'Close Animation' : 'Animation'}
              onClick={() => {
                setAnimationOpen((open) => !open)
              }}
              className="zatom-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--panel-elevated)]"
              style={{
                color: animationOpen ? 'var(--panel-text)' : 'var(--panel-text-secondary)',
                backgroundColor: animationOpen ? 'var(--control-selected-bg)' : 'transparent',
              }}
            >
              <Clapperboard className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Collapse Inspector"
              onClick={() => { setCollapsed(true);  }}
              className="zatom-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ color: 'var(--panel-text-secondary)' }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            </div>
          </div>
        </div>

        {activeWorkspace === 'animation' ? (
          <div
            id="inspector-animation-panel"
            role="region"
            aria-labelledby="inspector-animation-toggle"
            className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
          >
            <div className="p-5"><AnimationWorkspace /></div>
          </div>
        ) : (
        <>
        <div className={modelingWorkspace ? 'hidden' : 'shrink-0 px-4 py-3'} style={{ borderBottom: '1px solid var(--panel-border)' }}>
          <SlidingSegmented
            options={[
              { value: 'functions', label: 'Functions', icon: MousePointer },
              { value: 'visual', label: 'Visual', icon: Palette },
            ] as const}
            value={activeInspectorTab}
            onChange={selectInspectorTab}
            ariaLabel="Inspector sections"
            semantics="tabs"
            getOptionId={(value) => `inspector-${value}-tab`}
            getPanelId={(value) => `inspector-${value}-panel`}
          />
        </div>

        <div
          id="inspector-functions-panel"
          role="tabpanel"
          aria-labelledby="inspector-functions-tab"
          className={`${activeInspectorTab === 'functions' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        >
        {/* ── Function grid: one-line rest state, pointer/focus disclosure ── */}
        <div
          className={`${modelingWorkspace ? 'hidden' : ''} modeler-functions-disclosure min-h-0 overflow-y-auto custom-scrollbar px-5 py-2`}
          data-open={functionsExpanded || editingFunctions || undefined}
          style={{ borderBottom: '1px solid var(--panel-border)' }}
        >
          <div className="flex h-8 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <MousePointer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" style={{ color: 'var(--panel-text-secondary)' }} />
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-secondary)' }}>
                Functions
              </span>
              <span className="truncate text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                {/* Report only the tools hidden from the three-button resting row. */}
                {activeFunc && functionItems[activeFunc]
                  ? functionItems[activeFunc].label
                  : collapsedFunctionCount > 0
                    ? `+${collapsedFunctionCount} more`
                    : 'All shown'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Edit configures defaults; More is the primary disclosure action. */}
              <button
                type="button"
                onClick={() => {
                  setEditingFunctions(!editingFunctions)
                  setFunctionsExpanded(false)
                  setDraggedFunctionId(null)
                }}
                data-selected={editingFunctions}
                aria-expanded={editingFunctions}
                aria-controls="inspector-function-picker"
                className="zatom-choice zatom-pressable flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold uppercase"
                style={{ letterSpacing: 0 }}
                title={editingFunctions ? 'Finish editing default buttons' : 'Set default function buttons'}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {editingFunctions ? 'Done' : <span className="sr-only">Edit default function buttons</span>}
              </button>
              {!editingFunctions && (
                <button
                  type="button"
                  onClick={() => {
                    setFunctionsExpanded(!functionsExpanded)
                    setEditingFunctions(false)
                  }}
                  data-selected={functionsExpanded}
                  aria-expanded={functionsExpanded}
                  aria-controls="inspector-function-picker"
                  className="zatom-choice zatom-pressable flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold uppercase"
                  style={{ letterSpacing: 0 }}
                  title={functionsExpanded ? 'Collapse functions' : 'Show all functions and keep this section open'}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  {functionsExpanded ? 'Less' : 'More'}
                </button>
              )}
            </div>
          </div>

          <div id="inspector-function-picker" className="modeler-functions-disclosure-body pt-2">
            <div className="grid grid-cols-3 gap-2">
                  {visibleFunctionIds.slice(0, 3).map((id) => {
                    const item = functionItems[id]
                    if (!item) return null
                    const selectedIndex = visibleFunctionIds.indexOf(id)
                    return (
                      <GridBtn
                        key={id}
                        icon={item.icon}
                        label={item.label}
                        familyColor={TOOL_FAMILY_BY_ID[id]?.color}
                        active={editingFunctions ? selectedIndex >= 0 : item.active}
                        onClick={() => editingFunctions ? setDefaultEditSlotIndex(selectedIndex) : runFunctionItem(id)}
                        disabled={!editingFunctions && item.disabled}
                        reason={item.reason}
                        selectedOrder={editingFunctions && selectedIndex >= 0 ? selectedIndex + 1 : undefined}
                        draggable={editingFunctions}
                        onDragStart={() => setDraggedFunctionId(id)}
                        onDragOver={() => {
                          if (selectedIndex >= 0) setDefaultEditSlotIndex(selectedIndex)
                        }}
                        onDrop={() => dropDefaultFunction(id)}
                        onDragEnd={() => setDraggedFunctionId(null)}
                        isDragTarget={editingFunctions && (draggedFunctionId === id || selectedIndex === defaultEditSlotIndex)}
                        isDragging={editingFunctions && draggedFunctionId === id}
                        compact={!functionsExpanded && !editingFunctions}
                      />
                    )
                  })}
            </div>

            <div className="modeler-functions-disclosure-remainder">
              <div className="modeler-functions-disclosure-clip">
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {visibleFunctionIds.slice(3).map((id) => {
                    const item = functionItems[id]
                    if (!item) return null
                    const selectedIndex = visibleFunctionIds.indexOf(id)
                    return (
                      <GridBtn
                        key={id}
                        icon={item.icon}
                        label={item.label}
                        familyColor={TOOL_FAMILY_BY_ID[id]?.color}
                        active={editingFunctions ? selectedIndex >= 0 : item.active}
                        onClick={() => editingFunctions ? setDefaultEditSlotIndex(selectedIndex) : runFunctionItem(id)}
                        disabled={!editingFunctions && item.disabled}
                        reason={item.reason}
                        selectedOrder={editingFunctions && selectedIndex >= 0 ? selectedIndex + 1 : undefined}
                        draggable={editingFunctions}
                        onDragStart={() => setDraggedFunctionId(id)}
                        onDragOver={() => {
                          if (selectedIndex >= 0) setDefaultEditSlotIndex(selectedIndex)
                        }}
                        onDrop={() => dropDefaultFunction(id)}
                        onDragEnd={() => setDraggedFunctionId(null)}
                        isDragTarget={editingFunctions && (draggedFunctionId === id || selectedIndex === defaultEditSlotIndex)}
                        isDragging={editingFunctions && draggedFunctionId === id}
                      />
                    )
                  })}
                </div>

                {editingFunctions && (
                  <div className="mt-3">
                    <div className="mb-2" style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-tertiary)' }}>
                      Library
                    </div>
                    <FamilyLegend availableIds={markedFunctionIds} />
                    <div className="grid grid-cols-3 gap-2">
                      {hiddenFunctionIds.map((id) => {
                        const item = functionItems[id]
                        if (!item) return null
                        return (
                          <GridBtn
                            key={id}
                            icon={item.icon}
                            label={item.label}
                            familyColor={TOOL_FAMILY_BY_ID[id]?.color}
                            active={draggedFunctionId === id}
                            onClick={() => toggleDefaultFunction(id)}
                            disabled={false}
                            draggable
                            onDragStart={() => setDraggedFunctionId(id)}
                            onDragEnd={() => setDraggedFunctionId(null)}
                            isDragTarget={draggedFunctionId === id}
                            isDragging={draggedFunctionId === id}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {functionsExpanded && !editingFunctions && (
                  <div className="mt-2">
                    <FamilyLegend availableIds={markedFunctionIds} />
                    <div className="grid grid-cols-3 gap-2">
                    {hiddenFunctionIds.map((id) => {
                      const item = functionItems[id]
                      if (!item) return null
                      return (
                        <GridBtn
                          key={id}
                          icon={item.icon}
                          label={item.label}
                          familyColor={TOOL_FAMILY_BY_ID[id]?.color}
                          active={item.active}
                          onClick={() => runFunctionItem(id)}
                          disabled={item.disabled}
                          reason={item.reason}
                        />
                      )
                    })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Expanded function panel. */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {activeFunc === 'modeling' && (
            <div className="p-4">
              <Suspense fallback={<div className="py-8 text-center text-[11px]" role="status" style={{ color: 'var(--panel-text-tertiary)' }}>Loading Agent workspace…</div>}>
                <AgentModelingPanel />
              </Suspense>
            </div>
          )}
          {activeFunc === 'tools' && <div className="p-5"><ViewSettings /></div>}
          {activeFunc === 'cell' && periodic && <div className="p-5"><LatticeControls /></div>}
          {activeFunc === 'super' && periodic && <div className="p-5"><SymmetryPanel /></div>}
          {activeFunc === 'bz' && periodic && <div className="p-5"><BrillouinZoneSection /></div>}
          {activeFunc === 'measure' && <div className="p-5"><MeasurementPanel /></div>}
          {activeFunc === 'bond' && <div className="p-5"><BondSettings /></div>}
          {activeFunc === 'analysis' && <div className="p-5"><AnalysisSettings /></div>}
          {/* Put selection methods before selection-dependent details and actions. */}
          {activeFunc === 'select' && <div className="p-5" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><SelectionTools /><SelectionInfo /><SearchFilterPanel /></div>}
          {activeFunc === 'plane' && <div className="p-5"><PlaneBuilder /></div>}
          {activeFunc === 'slab' && <div className="p-5"><SlabBuilder /></div>}
          {activeFunc === 'adsorbate' && <div className="p-5"><AdsorbateTool /></div>}
          {activeFunc === 'overlayer' && <div className="p-5"><OverlayerBuilder /></div>}
          {activeFunc === 'amorphous' && <div className="p-5"><AmorphousBuilder /></div>}
          {activeFunc === 'polymer' && <div className="p-5"><PolymerBuilder /></div>}
          {activeFunc === 'dislocation' && <div className="p-5"><DislocationBuilderSection /></div>}
          {activeFunc === 'magnetism' && <div className="p-5"><MagnetismPanel /></div>}
          {activeFunc === 'porosity' && <div className="p-5"><PorosityPanel /></div>}
          {activeFunc === 'cluster' && <div className="p-5"><ClusterBuilderSection /></div>}
          {activeFunc === 'wulff' && periodic && <div className="p-5"><WulffBuilderSection /></div>}
          {activeFunc === 'polycrystal' && <div className="p-5"><PolycrystalBuilderSection /></div>}
          {activeFunc === 'hetero' && <div className="p-5"><HeterostructureBuilderSection /></div>}
          {activeFunc === 'moire' && <div className="p-5"><MoireBuilderSection /></div>}
          {activeFunc === 'nanotube' && <div className="p-5"><NanotubeBuilderSection /></div>}
          {activeFunc === 'perovskite' && <div className="p-5"><PerovskiteBuilderSection /></div>}
          {activeFunc === 'polysulfide' && <div className="p-5"><PolysulfideBuilderSection /></div>}
          {activeFunc === 'single-atom' && <div className="p-5"><SingleAtomBuilderSection /></div>}
          {activeFunc === 'dual-atom' && <div className="p-5"><DualAtomBuilderSection /></div>}
          {activeFunc === 'water' && <div className="p-5"><WaterLayerBuilderSection /></div>}
          {activeFunc === 'mof' && <div className="p-5"><MofAnalyzerSection /></div>}
          {activeFunc === 'clip' && <div className="p-5"><ClippingSettings /></div>}
          {activeFunc === 'scenegrid' && <div className="p-5"><SceneGridPanelSection /></div>}
          {activeFunc === 'light' && <div className="p-5"><LightingControls /></div>}
              {activeFunc === 'export' && <div className="p-5"><ExportPanel /></div>}
          {activeFunc === 'plate' && <div className="p-5"><PlateExportPanel /></div>}
          {activeFunc === 'settings' && <div className="p-5"><ApiSettingsPanel /></div>}
          {!activeFunc && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--panel-elevated)' }}>
                <MousePointer className="w-5 h-5" style={{ color: 'var(--panel-text-tertiary)' }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--panel-text-tertiary)' }}>Select a function above</p>
            </div>
          )}
        </div>
        </div>
        <div
          id="inspector-visual-panel"
          role="tabpanel"
          aria-labelledby="inspector-visual-tab"
          className={`${activeInspectorTab === 'visual' && !modelingWorkspace ? 'block' : 'hidden'} min-h-0 flex-1 overflow-y-auto custom-scrollbar`}
        >
          <div className="p-5"><VisualSettings /></div>
        </div>
        </>
        )}
        </div>
      </aside>
    </div>
  )
}
// Compact system-data cards and the element breakdown popover.
interface CardAtomLike { element: string; charge?: number }

// Stable neutral fallback prevents needless popover rerenders.
const EMPTY_CHARGE_MAP: Map<string, number> = new Map()

function SystemDataCards({
  atoms, bonds, periodic, supercellParams, selectedAtomCount,
}: {
  atoms: CardAtomLike[]
  bonds: unknown[]
  periodic: boolean
  supercellParams: { nx: number; ny: number; nz: number }
  selectedAtomCount: number
}) {
  const [hoverElements, setHoverElements] = useState(false)
  const [focusElements, setFocusElements] = useState(false)
  const [activeDatum, setActiveDatum] = useState<'atoms' | 'middle' | 'elements'>('atoms')
  const hoverIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverIntentDatum = useRef<'atoms' | 'middle' | 'elements' | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerSettling = useRef(false)
  const compactStructure = useCrystalStore((s) => s.compactStructure)

  // Compact structures keep species in a palette + typed index. Build the
  // histogram only when the source structure changes, never when a pill opens.
  const elementCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (compactStructure) {
      const count = Math.min(compactStructure.count, compactStructure.elementIndex.length)
      for (let index = 0; index < count; index++) {
        const symbol = compactStructure.elements[compactStructure.elementIndex[index]]
        if (symbol) counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
      }
      return counts
    }
    for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
    return counts
  }, [atoms, compactStructure])

  // Compact typed arrays carry no per-atom formal charge, so omit rather than invent zero.
  const chargeSummary = useMemo(
    () => (compactStructure ? null : summarizeCharge(atoms)),
    [atoms, compactStructure],
  )
  const netCharge = chargeSummary?.totalCharge ?? 0
  // Neutral structures keep the compact element-count presentation without a noisy zero.
  const elementsValue = netCharge === 0
    ? elementCounts.size.toLocaleString()
    : `${elementCounts.size.toLocaleString()} · ${formatCharge(netCharge)}`
  const elementsAriaLabel = netCharge === 0
    ? `${elementCounts.size.toLocaleString()} elements, net charge neutral`
    : `${elementCounts.size.toLocaleString()} elements, net charge ${netCharge > 0 ? '+' : '-'}${Math.abs(netCharge)}`
  // In compact mode store.atoms is empty; the bulk typed array owns the real count.
  const totalAtoms = compactStructure ? compactStructure.count : atoms.length
  const sortedElements = useMemo(
    () => Array.from(elementCounts.entries()).sort((a, b) => b[1] - a[1]),
    [elementCounts],
  )

  // The middle card reports cells for periodic structures and bonds otherwise.
  const cellCount = totalAtoms === 0
    ? 0
    : supercellParams.nx * supercellParams.ny * supercellParams.nz
  const middleCard = periodic
    ? { label: 'Cells', value: cellCount, icon: Boxes }
    : { label: 'Bonds', value: bonds.length, icon: Link }
  const elementsExpanded = hoverElements || focusElements
  const atomValue = selectedAtomCount > 0
    ? `${totalAtoms.toLocaleString()} · ${selectedAtomCount.toLocaleString()} selected`
    : totalAtoms.toLocaleString()

  const clearHoverIntent = () => {
    if (hoverIntentTimer.current) clearTimeout(hoverIntentTimer.current)
    hoverIntentTimer.current = null
    hoverIntentDatum.current = null
  }

  const clearSettleLock = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = null
    pointerSettling.current = false
  }

  useEffect(() => () => {
    clearHoverIntent()
    clearSettleLock()
  }, [])

  const activateFromFocus = (datum: 'atoms' | 'middle' | 'elements') => {
    clearHoverIntent()
    clearSettleLock()
    setActiveDatum(datum)
    setHoverElements(false)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return
    const slot = event.target.closest<HTMLElement>('[data-datum]')
    const datum = slot?.dataset.datum
    if (!slot || !event.currentTarget.contains(slot)
      || (datum !== 'atoms' && datum !== 'middle' && datum !== 'elements')) {
      clearHoverIntent()
      setHoverElements(false)
      return
    }
    if (pointerSettling.current) return
    if (datum === activeDatum) {
      clearHoverIntent()
      setHoverElements(datum === 'elements')
      return
    }
    if (hoverIntentDatum.current === datum) return
    clearHoverIntent()
    hoverIntentDatum.current = datum
    hoverIntentTimer.current = setTimeout(() => {
      hoverIntentTimer.current = null
      hoverIntentDatum.current = null
      setActiveDatum(datum)
      setHoverElements(datum === 'elements')
      pointerSettling.current = true
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null
        pointerSettling.current = false
      }, 480)
    }, 120)
  }

  const handlePointerLeave = () => {
    clearHoverIntent()
    setHoverElements(false)
  }

  return (
    <div
      className="modeler-system-data-cards relative"
      role="group"
      aria-label="System data"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className="modeler-system-data-slot"
        data-datum="atoms"
        data-active={activeDatum === 'atoms' || undefined}
        data-wide={selectedAtomCount > 0 || undefined}
        onFocusCapture={() => activateFromFocus('atoms')}
      >
        <CompactCard
          icon={Atom}
          label="Atoms"
          value={atomValue}
          ariaLabel={selectedAtomCount > 0
            ? `${totalAtoms.toLocaleString()} atoms, ${selectedAtomCount.toLocaleString()} selected`
            : `${totalAtoms.toLocaleString()} atoms`}
          accent={selectedAtomCount > 0}
        />
      </div>
      <div
        className="modeler-system-data-slot"
        data-datum="middle"
        data-active={activeDatum === 'middle' || undefined}
        onFocusCapture={() => activateFromFocus('middle')}
      >
        <CompactCard icon={middleCard.icon} label={middleCard.label} value={middleCard.value.toLocaleString()} />
      </div>

      <div
        className="modeler-system-data-slot relative"
        data-datum="elements"
        data-active={activeDatum === 'elements' || undefined}
        onFocusCapture={() => {
          activateFromFocus('elements')
          setFocusElements(true)
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusElements(false)
        }}
      >
        <CompactCard
          icon={Beaker}
          label="Elements"
          value={elementsValue}
          ariaLabel={elementsAriaLabel}
          controls={elementCounts.size > 0 ? 'system-data-elements-breakdown' : undefined}
          expanded={elementsExpanded}
          accent={netCharge !== 0}
        />
      </div>

      {elementsExpanded && elementCounts.size > 0 && (
        <ElementBreakdownPopover
          id="system-data-elements-breakdown"
          sortedElements={sortedElements}
          totalAtoms={totalAtoms}
          chargeByElement={chargeSummary?.byElement ?? EMPTY_CHARGE_MAP}
          netCharge={netCharge}
        />
      )}
    </div>
  )
}

/** Fixed-height informational pill. Its value is revealed by its host on hover/focus. */
function CompactCard({
  icon: Icon, label, value, ariaLabel, accent = false, controls, expanded = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  ariaLabel?: string
  accent?: boolean
  controls?: string
  expanded?: boolean
}) {
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={ariaLabel ?? `${label}: ${value}`}
      aria-controls={controls}
      aria-expanded={controls ? expanded : undefined}
      className="modeler-system-data-card"
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') event.currentTarget.focus({ preventScroll: true })
      }}
    >
      <Icon className="modeler-system-data-icon" strokeWidth={1.8} aria-hidden="true" />
      <span className="modeler-system-data-label">{label}</span>
      {accent && <span className="modeler-system-data-accent" aria-hidden="true" />}
      <span className="modeler-system-data-value" aria-hidden="true">{value}</span>
    </div>
  )
}

/** Show each element's atom and mass fractions, plus charge details when non-neutral. */
function ElementBreakdownPopover({
  id, sortedElements, totalAtoms, chargeByElement, netCharge,
}: {
  id: string
  sortedElements: Array<[string, number]>
  totalAtoms: number
  chargeByElement: Map<string, number>
  netCharge: number
}) {
  // Element mass is count times atomic mass; percentages use the resulting total.
  const elementMasses = sortedElements.map(([sym, cnt]) => {
    const m = ELEMENTS[sym]?.mass ?? 0
    return { sym, cnt, mass: cnt * m }
  })
  const totalMass = elementMasses.reduce((s, e) => s + e.mass, 0)

  return (
    <div
      id={id}
      role="region"
      aria-label="Element breakdown"
      className="absolute left-0 top-full mt-1 z-30 rounded-lg shadow-lg overflow-hidden p-1.5"
      style={{
        minWidth: 240,
        backgroundColor: 'var(--panel-bg)',
        border: '1px solid var(--panel-border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      }}
    >
      {/* Compact column labels avoid a second full header row. */}
      <div className="grid grid-cols-[24px_1fr_1fr] gap-2 px-1 pb-1" style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--panel-text-tertiary)' }}>
        <span></span>
        <span>by atom</span>
        <span>by mass</span>
      </div>

      <div className="space-y-1">
        {elementMasses.map(({ sym, cnt, mass }) => {
          const atomPct = totalAtoms > 0 ? (cnt / totalAtoms) * 100 : 0
          const massPct = totalMass > 0 ? (mass / totalMass) * 100 : 0
          // CPK colors match the viewer; near-white colors are darkened for light panels.
          const rawColor = ELEMENTS[sym]?.color || '#0A84FF'
          const barColor = darkenIfTooLight(rawColor)
          return (
            <div key={sym} className="grid grid-cols-[24px_1fr_1fr] gap-2 items-center px-1">
              <span style={{ fontSize: 11, fontWeight: 600, color: barColor, fontVariantNumeric: 'tabular-nums' }}>{sym}</span>
              <PctBar pct={atomPct} caption={`${cnt} · ${atomPct.toFixed(1)}%`} color={barColor} />
              <PctBar pct={massPct} caption={`${massPct.toFixed(1)}%`} color={barColor} />
            </div>
          )
        })}
      </div>

      {/* Charge rows appear only when they explain a nonzero value in the summary pill. */}
      {netCharge !== 0 && (
        <div className="mt-1.5 pt-1.5 px-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
          <div className="flex items-baseline justify-between" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>
            <span style={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>formal charge</span>
            <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-danger)' }}>
              net {formatCharge(netCharge)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {[...chargeByElement.entries()].map(([sym, charge]) => (
              <span key={sym} style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: 'var(--panel-text-secondary)' }}>
                {sym} {formatCharge(charge)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** One percentage bar with its numeric caption. */
function PctBar({ pct, caption, color }: { pct: number; caption: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--panel-elevated)' }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums', color: 'var(--panel-text-secondary)', whiteSpace: 'nowrap' }}>
        {caption}
      </span>
    </div>
  )
}

/** Darken near-white CPK colors enough to remain visible on a light panel. */
function darkenIfTooLight(hex: string): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000 // YIQ perceived brightness.
  if (brightness < 220) return hex
  const f = 0.55
  const toHex = (n: number) => Math.round(n * f).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
