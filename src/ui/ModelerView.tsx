import { useEffect, useLayoutEffect, useState, useRef, lazy, Suspense, type DragEvent } from 'react'
import { SidebarTabs, type SidebarTab } from "./panels/sidebar-tabs"
import { InspectorPanel } from "./panels/inspector-panel"
import { BondSubmodeFlyout, BottomToolbar } from "./panels/bottom-toolbar"
import { Plane2DView } from "./panels/plane-2d-view"
import { UndoRedoButtons } from "./panels/undo-redo-buttons"
import { SymmetryHUDBadge } from "./panels/symmetry-hud-badge"
import { MergePlacementHUD } from "./panels/merge-placement-hud"
import { ElementSelector } from "./panels/element-selector"
import { FloatingBatchPanel } from "./panels/FloatingBatchPanel"
import { StructureProcessingOverlay } from "./panels/structure-processing-overlay"
import { StructureAssetProvider } from "./structure-asset-context"
import { useCrystalStore } from '../orchestration/crystalStore'
import { useModelerBridge } from '../host/modelerBridge'
import { ELEMENTS } from '../lib/crystal/elements'
import { shouldDisableGeometrySelection } from '../lib/performance/adaptive-performance'
import { deriveInterfacePalette, useThemeStore } from '../host'
import { useActiveCrystalStore } from '../orchestration/ViewportContext'
import { ViewportGrid } from './components/viewport-grid'
import { SelectionInfoOverlay } from './components/crystal-viewer'
import { AgentActivityBar } from './components/crystal-viewer/agent-activity-bar'
import { DragAxisLockPills } from './components/crystal-viewer/drag-axis-lock-pills'
import { AgentOperationReview } from './components/crystal-viewer/agent-operation-review'
import { ManualControlBar } from './components/crystal-viewer/manual-control-bar'
import { AgentGuidanceStrip } from './components/crystal-viewer/agent-guidance-strip'
import { AgentProposalCard } from './components/crystal-viewer/agent-proposal-card'
import { AgentAccessRequestCard } from './components/crystal-viewer/agent-access-request-card'
import { ViewportContextMenu } from './components/crystal-viewer/viewport-context-menu'
import { BiomoleculeSequenceStrip } from './components/biomolecule/sequence-strip'
import { useViewportManager } from '../orchestration/viewportManager'
import { atomicNumberToSymbol } from '../chemistry/periodic-table'
import type { WorkspaceFrame } from '../host'

const MODELER_FRAME_MIME = 'application/x-modeler-frame'

const AssemblyViewer = lazy(() =>
  import('./components/assembly-viewer').then(m => ({ default: m.AssemblyViewer }))
)

/** Gate: only mount Plane2DView when show2DPlaneView is true — avoids expensive subscriptions when inactive */
function Plane2DViewGate() {
  const show = useCrystalStore((s) => s.show2DPlaneView)
  if (!show) return null
  return <Plane2DView />
}

interface ModelerViewProps {
  onOpenAbout?: () => void
  showBrandCoachmark?: boolean
  onBrandCoachmarkDismiss?: () => void
}

export function ModelerView({
  onOpenAbout,
  showBrandCoachmark = false,
  onBrandCoachmarkDismiss,
}: ModelerViewProps = {}) {
  // Startup animation lives in StartupScreen; this view keeps only its mount fade-in.
  const [showContent, setShowContent] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('structure')
  const [assetsBlockFloating, setAssetsBlockFloating] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem('zatom:modeler:assetsBlockFloating') === '1' } catch { return false }
  })
  const [isFrameDragOver, setIsFrameDragOver] = useState(false)
  // Start content-first: both side rails remain discoverable, while the
  // scientific viewport receives the full working area until the user asks
  // for a panel.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
  // Match the first rendered rail width so floating viewport chrome does not
  // jump sideways after InspectorPanel's layout effect reports 52px.
  const [inspectorWidth, setInspectorWidth] = useState(52)
  const pendingFileChecked = useRef(false)
  const modelerBoundsRef = useRef<HTMLDivElement>(null)

  const undo = useCrystalStore((s) => s.undo)
  const redo = useCrystalStore((s) => s.redo)
  const canUndo = useCrystalStore((s) => s.canUndo)
  const canRedo = useCrystalStore((s) => s.canRedo)
  const undoAssembly = useCrystalStore((s) => s.undoAssembly)
  const redoAssembly = useCrystalStore((s) => s.redoAssembly)
  const canUndoAssembly = useCrystalStore((s) => s.canUndoAssembly)
  const canRedoAssembly = useCrystalStore((s) => s.canRedoAssembly)
  const builderMode = useCrystalStore((s) => s.builderMode)
  const lastHistoryDomain = useCrystalStore((s) => s.lastHistoryDomain)
  const setToolMode = useCrystalStore((s) => s.setToolMode)
  const setSelectMode = useCrystalStore((s) => s.setSelectMode)
  // Bond selection is a Bond-tool submode; both 2 and B activate it.
  const activateBondSubmode = useCrystalStore((s) => s.activateBondSubmode)
  const activeSceneId = useCrystalStore((s) => s.activeSceneId)
  const theme = useThemeStore((s) => s.theme)
  const appearance = useThemeStore((s) => s.appearance)
  const setViewportTheme = useThemeStore((s) => s.setViewportTheme)
  const activeViewportBackground = useActiveCrystalStore((s) => s.presentationStylePreview?.background ?? s.background)
  const activeViewportId = useViewportManager((s) => s.activeViewportId)
  const isDark = theme === 'dark'
  // Free layout also uses framed center-column cards so its subviewport strip
  // cannot overflow beneath the panels.
  const multiViewport = useViewportManager((s) => s.layout !== '1x1' || s.freeLayout !== null)
  const sidebarWidth = sidebarCollapsed ? 52 : 330
  const viewportChromeLeft = sidebarWidth + 12
  const viewportChromeCenter = `calc(${viewportChromeLeft}px + (100% - ${viewportChromeLeft + inspectorWidth + 12}px) / 2)`

  // Tell viewport overlays how much space the inspector occupies.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--viewport-chrome-right', `${inspectorWidth + 12}px`)
    return () => {
      root.style.removeProperty('--viewport-chrome-right')
    }
  }, [inspectorWidth])

  useLayoutEffect(() => {
    const documentRoot = document.documentElement
    const palette = deriveInterfacePalette(activeViewportBackground)
    const cssVariables = {
      '--viewport-background': palette.background,
      '--auto-theme-text': palette.text,
      '--auto-theme-text-secondary': palette.textSecondary,
      '--auto-theme-text-tertiary': palette.textTertiary,
      '--auto-theme-surface': palette.surface,
      '--auto-theme-elevated': palette.elevated,
      '--auto-theme-hover': palette.hover,
      '--auto-theme-active': palette.active,
      '--auto-theme-border': palette.border,
      '--auto-theme-border-focus': palette.borderFocus,
      '--auto-theme-primary-hover': palette.primaryHover,
      '--auto-theme-status-success': palette.status.success,
      '--auto-theme-status-warning': palette.status.warning,
      '--auto-theme-status-error': palette.status.error,
      '--auto-theme-status-neutral': palette.status.neutral,
    }
    for (const [property, value] of Object.entries(cssVariables)) {
      documentRoot.style.setProperty(property, value)
    }
    setViewportTheme(palette.theme)
    return () => {
      for (const property of Object.keys(cssVariables)) {
        documentRoot.style.removeProperty(property)
      }
    }
  }, [activeViewportBackground, setViewportTheme])

  // Reveal panels on the first frame after mount so their entrance transition runs.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowContent(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const setFloatingAssets = (floating: boolean) => {
    setAssetsBlockFloating(floating)
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem('zatom:modeler:assetsBlockFloating', floating ? '1' : '0') } catch { /* ignore */ }
  }

  const dragHasModelerFrame = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes(MODELER_FRAME_MIME)

  const handleModelerFrameDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasModelerFrame(event)) return
    event.preventDefault()
    event.stopPropagation()
    setIsFrameDragOver(false)

    const raw = event.dataTransfer.getData(MODELER_FRAME_MIME)
    if (!raw) return

    let frame: WorkspaceFrame
    try {
      frame = JSON.parse(raw) as WorkspaceFrame
    } catch {
      return
    }
    if (!frame.atoms?.length) return

    const store = useCrystalStore.getState()

    // An empty viewport can use the standard extended-XYZ loader directly.
    if (store.atoms.length === 0) {
      const hasLattice = frame.latticeMatrix && frame.latticeMatrix.length === 3
      const latticeStr = hasLattice && frame.latticeMatrix
        ? `Lattice="${frame.latticeMatrix.flat().join(' ')}"`
        : ''
      const lines = [
        String(frame.atoms.length),
        `${latticeStr} Label="${frame.label}"`.trim(),
        ...frame.atoms.map(a => `${atomicNumberToSymbol(a.element)} ${a.position[0]} ${a.position[1]} ${a.position[2]}`),
      ]
      store.setPeriodic(!!hasLattice)
      void store.loadFromXYZ(lines.join('\n'))
      return
    }

    // A populated viewport enters interactive merge placement (XY, Z, confirm) and commits a child layer.
    const atomInputs = frame.atoms.map(a => ({
      element: atomicNumberToSymbol(a.element),
      cartesian: a.position as [number, number, number],
    }))
    // Start above the structure bounds; vacuum commonly lies along z.
    let maxZ = Number.NEGATIVE_INFINITY
    let cx = 0
    let cy = 0
    for (const atom of store.atoms) {
      const p = atom.cartesian ?? atom.position
      cx += p[0]
      cy += p[1]
      if (p[2] > maxZ) maxZ = p[2]
    }
    cx /= store.atoms.length
    cy /= store.atoms.length
    store.startMergePlacement(frame.label || 'Structure', atomInputs, [cx, cy, maxZ + 3])
  }

  // Consume a structure queued before this view mounted.
  useEffect(() => {
    if (pendingFileChecked.current) return
    pendingFileChecked.current = true

    const pending = useModelerBridge.getState().consumePendingFile()
    if (!pending) return

    const store = useViewportManager.getState().getActiveStore().getState()
    if (pending.format === 'cif') {
      void store.loadFromCIF(pending.content)
    } else if (pending.format === 'xyz') {
      void store.loadFromXYZ(pending.content)
    }
  }, [])

  // Consume a newly pending file whenever the component becomes visible.
  const pendingFile = useModelerBridge((s) => s.pendingFile)
  useEffect(() => {
    if (!pendingFile || !showContent) return
    const file = useModelerBridge.getState().consumePendingFile()
    if (!file) return

    const store = useViewportManager.getState().getActiveStore().getState()
    if (file.format === 'cif') {
      void store.loadFromCIF(file.content)
    } else if (file.format === 'xyz') {
      void store.loadFromXYZ(file.content)
    }
  }, [pendingFile, showContent])

  // Multi-structure comparison switches layout and distributes files across viewports.
  const pendingMultiFiles = useModelerBridge((s) => s.pendingMultiFiles)
  useEffect(() => {
    if (!pendingMultiFiles || !showContent) return
    const consumed = useModelerBridge.getState().consumePendingMulti()
    if (!consumed) return
    const { files, layout } = consumed
    const vpm = useViewportManager.getState()
    // Switch layout first so viewport instances are created or removed.
    vpm.setLayout(layout)
    // Load in the next microtask after viewport slots have been created.
    queueMicrotask(() => {
      const latest = useViewportManager.getState()
      const vpIds = Object.keys(latest.viewports).sort()  // vp-1, vp-2, ...
      files.forEach((file, idx) => {
        const vpId = vpIds[idx]
        if (!vpId) return
        const storeHook = latest.getViewportStore(vpId)
        if (!storeHook) return
        const storeState = storeHook.getState()
        if (file.format === 'cif') {
          void storeState.loadFromCIF(file.content)
        } else if (file.format === 'xyz') {
          void storeState.loadFromXYZ(file.content)
        }
        latest.setStructureName(vpId, file.name)
      })
      // Activate the first loaded viewport.
      if (vpIds.length > 0) latest.setActive(vpIds[0])
    })
  }, [pendingMultiFiles, showContent])

  // Expose a snapshot of the active structure to runtime integrations.
  useEffect(() => {
    useModelerBridge.getState().setGetStructureSnapshot(() => {
      const state = useViewportManager.getState().getActiveStore().getState()
      if (!state.atoms || state.atoms.length === 0) return null

      return {
        atoms: state.atoms.map(atom => {
          const elData = ELEMENTS[atom.element]
          const z = elData ? elData.atomicNumber : 0
          const pos = atom.cartesian || atom.position
          return {
            element: z,
            position: pos as [number, number, number],
          }
        }),
        latticeMatrix: state.latticeVectors
          ? [state.latticeVectors.a, state.latticeVectors.b, state.latticeVectors.c]
          : null,
        label: 'Modeler snapshot',
      }
    })

    return () => {
      useModelerBridge.getState().setGetStructureSnapshot(() => null)
    }
  }, [])

  // Global keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        if (builderMode === 'assembly' || lastHistoryDomain === 'assembly') {
          if (canRedoAssembly()) redoAssembly()
        } else {
          if (canRedo()) redo()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (builderMode === 'assembly' || lastHistoryDomain === 'assembly') {
          if (canUndoAssembly()) undoAssembly()
        } else {
          if (canUndo()) undo()
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const activeStore = useViewportManager.getState().getActiveStore()
        const s = activeStore.getState()
        if (s.selectedAtomIds.size > 0) s.deleteSelectedAtoms()
        if (s.selectedBondIds.size > 0) s.deleteSelectedBonds()
        return
      }

      // Ctrl+C copies selected atoms and writes XYZ to the system clipboard.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const s = useViewportManager.getState().getActiveStore().getState()
        // With no atom selection, preserve native browser text copying.
        if (s.selectedAtomIds.size === 0) return
        e.preventDefault()
        s.copySelectedAtoms()
        return
      }

      // Handle Ctrl+Shift+V before Ctrl+V because the plain-paste branch
      // does not inspect Shift.
      // Attachment uses the internal clipboard to preserve the fragment's original geometry
      // instead of round-tripping through system-clipboard XYZ text.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const s = useViewportManager.getState().getActiveStore().getState()
        // Without a selection, fall back to ordinary paste.
        if (s.selectedAtomIds.size === 0) s.pasteClipboardAtoms()
        else s.pasteAttachedToSelection()
        return
      }

      // Ctrl+V prefers the system clipboard so external XYZ text works;
      // if permission or secure-context checks reject the read, use the internal copy.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const store = useViewportManager.getState().getActiveStore()
        if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function') {
          void navigator.clipboard
            .readText()
            .then((text) => store.getState().pasteClipboardAtoms(text))
            .catch(() => store.getState().pasteClipboardAtoms())
        } else {
          store.getState().pasteClipboardAtoms()
        }
        return
      }

      const activeStore = useViewportManager.getState().getActiveStore()
      const geometrySelectionDisabled = shouldDisableGeometrySelection(
        activeStore.getState().atoms.length,
      )

      switch (e.key.toLowerCase()) {
        case '1': setSelectMode('atom'); setToolMode('select'); break
        case '2':
          if (geometrySelectionDisabled) {
            setSelectMode('atom')
            setToolMode('select')
            break
          }
          // Bond selection is a Bond-tool submode and must share its activation path.
          activateBondSubmode('select')
          break
        case '3':
          if (geometrySelectionDisabled) {
            setSelectMode('atom')
            setToolMode('select')
            break
          }
          setSelectMode('face')
          setToolMode('select')
          break
        case 'a': setToolMode('add-atom'); break
        // B activates the current bond submode; large scenes fall back to create when selection is unavailable.
        case 'b': {
          const submode = useCrystalStore.getState().bondToolSubmode
          activateBondSubmode(submode === 'select' && geometrySelectionDisabled ? 'create' : submode)
          break
        }
        case 'd': setToolMode('delete'); break
        case 'g': setToolMode('drag-atom'); break
        case 'escape': setToolMode('select'); break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activateBondSubmode, builderMode, canRedo, canRedoAssembly, canUndo, canUndoAssembly, lastHistoryDomain, redo, redoAssembly, setSelectMode, setToolMode, undo, undoAssembly])

  return (
    <StructureAssetProvider
      assetsBlockFloating={assetsBlockFloating}
      onAssetRecorded={() => setSidebarTab('assets')}
    >
      <StructureProcessingOverlay />

      <div
        ref={modelerBoundsRef}
        className="modeler-root h-full w-full overflow-clip flex items-center justify-center font-sans transition-[opacity,transform,background-color] duration-200 ease-out"
        data-appearance={appearance}
        onDragEnter={(event) => {
          if (!dragHasModelerFrame(event)) return
          event.preventDefault()
          setIsFrameDragOver(true)
        }}
        onDragOver={(event) => {
          if (!dragHasModelerFrame(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setIsFrameDragOver(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsFrameDragOver(false)
        }}
        onDrop={handleModelerFrameDrop}
        style={{
          backgroundColor: 'var(--workspace-bg)',
          backgroundImage: theme === 'dark' && appearance !== 'viewport'
            ? `radial-gradient(circle at 50% 40%, rgba(26,26,36,0.52) 0%, rgba(5,5,5,0) 62%),
               linear-gradient(0deg, rgba(10,132,255,0.03) 0%, transparent 100%)`
            : 'none',
          opacity: showContent ? 1 : 0,
          transform: showContent ? 'scale(1)' : 'scale(0.98)',
          position: 'relative',
        }}
      >
        {/* Full-bleed 3D background for a single viewport; viewport cards cover it in multi-pane layouts. */}
        {/* Right-click lives here, not only inside CrystalViewer: the single-view
            modeler renders AssemblyViewer, which never mounts CrystalViewer, so a
            menu attached there alone left this page with no menu at all. Nesting
            is safe -- the primitive listens on bubble and stops propagation, so a
            grid cell's own menu still wins over this one. */}
        <ViewportContextMenu>
        <div
          className="absolute inset-0 overflow-hidden transition-opacity duration-200 ease-out"
          style={{
            opacity: showContent ? 1 : 0,
            zIndex: multiViewport ? -1 : 0,
          }}
        >
          {activeSceneId ? (
            <Suspense fallback={<div className={`w-full h-full ${isDark ? 'bg-black/50' : 'bg-slate-100/50'}`} />}>
              <AssemblyViewer />
            </Suspense>
          ) : !multiViewport ? (
            <ViewportGrid />
          ) : null}
        </div>
        </ViewportContextMenu>

        {/* Visual evidence is captured from the exact active viewport Canvas. Keep no
            second hidden WebGL scene: it can drift from workspace identity and consumes
            a scarce browser WebGL context. */}
        <ElementSelector />

        {isFrameDragOver && (
          <div
            className="absolute inset-4 z-[60] pointer-events-none rounded-2xl border-2 border-dashed flex items-center justify-center"
            style={{ borderColor: 'var(--status-amber)', background: 'var(--status-amber-bg)' }}
          >
            <div
              className="px-4 py-2 rounded-lg text-xs font-medium shadow-xl"
              style={{ background: 'var(--panel-elevated)', color: 'var(--status-amber)' }}
            >
              Drop to merge into structure
            </div>
          </div>
        )}

        {assetsBlockFloating && (
          <FloatingBatchPanel
            constraintsRef={modelerBoundsRef}
            onDock={() => setFloatingAssets(false)}
          />
        )}

        {/* Three-column workspace. Only layout dimensions animate; controls remain immediate. */}
        <div
          className="relative w-full h-full flex pointer-events-none transition-[padding,gap] duration-200 ease-out"
          style={{
            padding: multiViewport ? 8 : 0,
            paddingTop: multiViewport ? 8 : 0,
            gap: multiViewport ? 8 : 0,
          }}
        >
          <div className="relative z-30 shrink-0 pointer-events-auto">
            <SidebarTabs
              activeTab={sidebarTab}
              onActiveTabChange={setSidebarTab}
              assetsBlockFloating={assetsBlockFloating}
              onAssetsBlockFloatingChange={setFloatingAssets}
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
              onOpenAbout={onOpenAbout}
              showBrandCoachmark={showBrandCoachmark}
              onBrandCoachmarkDismiss={onBrandCoachmarkDismiss}
            />
          </div>

          {/* Multi-pane layouts render viewport cards in the center column. */}
          {multiViewport ? (
            <div
              className="relative z-10 flex-1 min-w-0 pointer-events-auto overflow-hidden"
              style={{
                backgroundColor: 'var(--panel-bg)',
                borderRadius: 'var(--panel-radius)',
                border: '1px solid var(--panel-border)',
              }}
            >
              <ViewportGrid />
            </div>
          ) : (
            /* Reserve space for the right sidebar in single-view mode. */
            <div className="flex-1" />
          )}

          <div className="relative z-30 shrink-0 pointer-events-auto">
            <InspectorPanel
              collapsed={inspectorCollapsed}
              onCollapsedChange={setInspectorCollapsed}
              onWidthChange={setInspectorWidth}
            />
          </div>
        </div>

        {/* Undo/Redo — hugs the left sidebar (16px gap), follows its collapse. */}
        <div
          className="absolute z-50 transition-[left,top] duration-200 ease-out"
          style={{ left: viewportChromeLeft + 4, top: 16 }}
        >
          <UndoRedoButtons />
        </div>

        {/* The symmetry badge centers above the viewport and renders from store state. */}
        <div className="absolute z-40 transition-[left,top] duration-200 ease-out" style={{ left: viewportChromeCenter, transform: 'translateX(-50%)', top: 16 }}>
          <SymmetryHUDBadge />
        </div>

        {/* Show merge-placement guidance only while the workflow is active. */}
        <div className="absolute z-50 pointer-events-none" style={{ left: viewportChromeCenter, transform: 'translateX(-50%)', top: 56 }}>
          <MergePlacementHUD />
        </div>

        {/* Agent plan progress, caption, and immediate takeover control. */}
        <div className="absolute z-40 pointer-events-none transition-[left,top] duration-200 ease-out" style={{ left: viewportChromeCenter, transform: 'translateX(-50%)', top: 56 }}>
          <AgentGuidanceStrip />
        </div>

        <div
          data-testid="viewport-bottom-stack"
          className={`pointer-events-none absolute z-20 flex flex-col items-center gap-2 transition-[left,right,bottom] duration-200 ease-out ${isDark ? 'bottom-8' : 'bottom-4'}`}
          style={{ left: viewportChromeLeft, right: inspectorWidth + 12 }}
        >
          <AgentAccessRequestCard />
          {/* Agent activity and skip-animation control keep slow tools visibly responsive. */}
          <AgentActivityBar />
          {/* Structure proposal card for applying or discarding the visible ghost preview. */}
          <AgentProposalCard />
          {/* Post-operation review card for keeping, reverting, or taking over. */}
          <AgentOperationReview />
          {/* Persistent manual-control bar with a clear path to return control. */}
          <ManualControlBar />
          <SelectionInfoOverlay />
          {!activeSceneId && <BiomoleculeSequenceStrip key={activeViewportId} />}
          {/* Bond submode bar stays near the toolbar and outside clipped scroll containers. */}
          <BondSubmodeFlyout />
          {/* Move-axis constraints stay directly above the corresponding toolbar control. */}
          <DragAxisLockPills />
          <div className="modeler-toolbar-scroll max-w-full overflow-x-auto rounded-full pointer-events-auto">
            <BottomToolbar />
          </div>
        </div>

        <Plane2DViewGate />
      </div>
    </StructureAssetProvider>
  )
}
