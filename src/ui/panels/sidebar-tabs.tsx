"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Atom, Box, ChevronLeft, ChevronRight } from "lucide-react"
import { StructurePanel } from "./structure-panel"
import { AssemblyPanel } from "./assembly-panel"
import { SlidingSegmented } from "./panel-ui"
import { CELL_OVERFLOW_OPTIONS } from "./cell-overflow-options"
import { useProximityReveal } from "./use-proximity-reveal"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { ZatomBrandButton } from "../components/zatom-brand-button"

/**
 * The third tab, "Tasks", is gone along with `extensions-panel.tsx` and
 * `ComputePresetsSection.tsx`.
 *
 * It was a compute surface: a host function catalog, preset calculators and a job
 * submitter, none of which belong to the standalone modeling product.
 * zatom wires neither, and the panel's own accessor threw on a missing client
 * ("BackendService unavailable for Modeler extensions"), so the tab rendered, invited
 * a click, and failed. A visible control that cannot work is worse than an absent
 * one — it costs the user the time to find that out.
 */
export type SidebarTab = "structure" | "assets"

/**
 * Assets shows this workspace's own material; Store browses the bundled model
 * library; Folder browses a directory bound from the user's disk. All three are
 * sources for the same panel, not modes of one view — the axis is "where does
 * this material come from", and a bound folder is a fourth-wall answer to
 * exactly that question.
 *
 * Folder used to sit in Structure ▸ Import as a fourth segment beside
 * Materials / Molecules / Macromolecules. It never fit there: those three are
 * one-shot "search a database, pull one structure into the viewport" actions,
 * while a bound directory is durable, re-browsable material. Here it shares an
 * axis with Assets and Store, all of which answer the same question.
 */
export type AssetsMode = "assets" | "store" | "folder"

const ASSETS_MODE_OPTIONS = [
  { value: 'assets', label: 'Assets' },
  { value: 'store', label: 'Store' },
  { value: 'folder', label: 'Folder' },
] as const satisfies readonly { value: AssetsMode; label: string }[]

interface SidebarTabsProps {
  activeTab?: SidebarTab
  onActiveTabChange?: (tab: SidebarTab) => void
  assetsBlockFloating?: boolean
  onAssetsBlockFloatingChange?: (floating: boolean) => void
  /** Controlled collapse (so overlays like the undo/redo bar can follow it). */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onOpenAbout?: () => void
  showBrandCoachmark?: boolean
  onBrandCoachmarkDismiss?: () => void
}

export function SidebarTabs({
  activeTab: controlledActiveTab,
  onActiveTabChange,
  assetsBlockFloating = false,
  onAssetsBlockFloatingChange,
  collapsed,
  onCollapsedChange,
  onOpenAbout = () => {},
  showBrandCoachmark = false,
  onBrandCoachmarkDismiss,
}: SidebarTabsProps = {}) {
  const [localCollapsed, setLocalCollapsed] = useState(true)
  /**
   * Which tab's hover disclosure is open. Structure reveals Boundary
   * (periodic vs molecule); Assets reveals the Assets/Store switch. One piece
   * of state and one timer pair serve both, so the two can never be open at
   * once and hovering across the tab row hands the strip over cleanly.
   */
  const [disclosureTab, setDisclosureTab] = useState<SidebarTab | null>(null)
  const [assetsMode, setAssetsMode] = useState<AssetsMode>('assets')
  const reduceMotion = useReducedMotion()
  const disclosureOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disclosureCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCollapsed = collapsed ?? localCollapsed
  const setIsCollapsed = (v: boolean) => { setLocalCollapsed(v); onCollapsedChange?.(v) }
  const [localActiveTab, setLocalActiveTab] = useState<SidebarTab>("structure")
  const activeTab = controlledActiveTab ?? localActiveTab
  const activeSceneId = useCrystalStore((s) => s.activeSceneId)
  const periodic = useCrystalStore((s) => s.periodic)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)
  const cellOverflowMode = useCrystalStore((s) => s.cellOverflowMode)
  const setCellOverflowMode = useCrystalStore((s) => s.setCellOverflowMode)

  /**
   * Reveal outside-cell options only while Periodic is hovered or focused;
   * close them immediately when the parent disclosure closes or mode changes.
   */
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearOverflowOpenTimer = () => {
    if (overflowOpenTimer.current) clearTimeout(overflowOpenTimer.current)
    overflowOpenTimer.current = null
  }
  const scheduleOverflowOpen = () => {
    if (overflowOpen || overflowOpenTimer.current) return
    overflowOpenTimer.current = setTimeout(() => {
      overflowOpenTimer.current = null
      setOverflowOpen(true)
    }, 160)
  }
  const openOverflowNow = () => {
    clearOverflowOpenTimer()
    setOverflowOpen(true)
  }
  const closeOverflowNow = () => {
    clearOverflowOpenTimer()
    setOverflowOpen(false)
  }

  const clearDisclosureOpenTimer = () => {
    if (disclosureOpenTimer.current) clearTimeout(disclosureOpenTimer.current)
    disclosureOpenTimer.current = null
  }
  const clearDisclosureCloseTimer = () => {
    if (disclosureCloseTimer.current) clearTimeout(disclosureCloseTimer.current)
    disclosureCloseTimer.current = null
  }
  const scheduleDisclosureOpen = (tab: SidebarTab) => {
    clearDisclosureCloseTimer()
    if (disclosureTab === tab || disclosureOpenTimer.current) return
    disclosureOpenTimer.current = setTimeout(() => {
      disclosureOpenTimer.current = null
      setDisclosureTab(tab)
    }, 180)
  }
  const openDisclosureNow = (tab: SidebarTab) => {
    clearDisclosureOpenTimer()
    clearDisclosureCloseTimer()
    setDisclosureTab(tab)
  }
  const scheduleDisclosureClose = () => {
    clearDisclosureOpenTimer()
    if (disclosureTab === null || disclosureCloseTimer.current) return
    disclosureCloseTimer.current = setTimeout(() => {
      disclosureCloseTimer.current = null
      setDisclosureTab(null)
      closeOverflowNow()
    }, 420)
  }
  const closeDisclosureNow = () => {
    clearDisclosureOpenTimer()
    clearDisclosureCloseTimer()
    setDisclosureTab(null)
    closeOverflowNow()
  }

  useEffect(() => () => {
    clearDisclosureOpenTimer()
    clearDisclosureCloseTimer()
    clearOverflowOpenTimer()
  }, [])

  const setActiveTab = (tab: SidebarTab) => {
    setLocalActiveTab(tab)
    onActiveTabChange?.(tab)
  }

  // Assets is navigation; assembly mode belongs only to an entered Scene. While a
  // Scene is active the Assets panel stays visible until its explicit exit action.
  const inScene = !!activeSceneId
  const effectiveTab: SidebarTab = inScene ? 'assets' : activeTab

  /**
   * Assets only has a disclosure outside a Scene: inside one the panel is the
   * scene editor, where an Assets/Store switch would point at nothing.
   */
  const hasDisclosure = (tab: SidebarTab) => tab === 'structure' || !inScene
  const disclosureOpen = disclosureTab === effectiveTab && hasDisclosure(effectiveTab)

  // Fade the collapsed rail in as the pointer approaches its right edge.
  const proximityRef = useProximityReveal<HTMLElement>('left', isCollapsed)

  return (
    <div className="flex flex-col h-full pointer-events-auto relative">
      <aside
        ref={proximityRef}
        className="modeler-side-panel flex h-full flex-col overflow-hidden transition-[width,background-color,border-color,box-shadow] duration-200 ease-out"
        data-collapsed={isCollapsed}
        style={{
          width: isCollapsed ? 52 : 330,
        }}
      >
      {/* Collapsed icon rail and expand control. */}
        <div
          aria-hidden={!isCollapsed}
          ref={(element) => element?.toggleAttribute('inert', !isCollapsed)}
          className={`absolute inset-0 flex flex-col items-center py-5 gap-2 transition-opacity duration-200 ${isCollapsed ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}
        >
          <ZatomBrandButton
            className="mb-1 h-7 w-7"
            showCoachmark={isCollapsed && showBrandCoachmark}
            onCoachmarkDismiss={onBrandCoachmarkDismiss}
            onOpenAbout={onOpenAbout}
          />
          {([
            { id: 'structure' as const, label: 'Structure', icon: <Atom className="w-4 h-4" /> },
            { id: 'assets' as const, label: 'Assets', icon: <Box className="w-4 h-4" /> },
          ]).map(t => (
            <button
              key={t.id}
              type="button"
              aria-label={`Open ${t.label}`}
              aria-pressed={effectiveTab === t.id}
              onClick={() => { setActiveTab(t.id); setIsCollapsed(false);  }}
              className="zatom-pressable w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: effectiveTab === t.id ? 'var(--panel-elevated)' : 'transparent',
                color: effectiveTab === t.id ? 'var(--panel-text)' : 'var(--panel-text-secondary)',
              }}
            >
              {t.icon}
            </button>
          ))}
          <button
            type="button"
            aria-label="Expand Structure panel"
            onClick={() => { setIsCollapsed(false);  }}
            className="zatom-pressable mt-auto w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--panel-text-secondary)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Expanded content. */}
        <div
          aria-hidden={isCollapsed}
          ref={(element) => element?.toggleAttribute('inert', isCollapsed)}
          className={`flex flex-col h-full min-w-[330px] transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div
            className="px-4 pt-3 pb-3 shrink-0"
            style={{ borderBottom: '1px solid var(--panel-border)' }}
            onPointerEnter={clearDisclosureCloseTimer}
            onPointerLeave={scheduleDisclosureClose}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleDisclosureClose()
            }}
          >
            <div className="flex items-center gap-1">
              <ZatomBrandButton
                className="mr-1 h-7 w-7"
                showCoachmark={!isCollapsed && showBrandCoachmark}
                onCoachmarkDismiss={onBrandCoachmarkDismiss}
                onOpenAbout={onOpenAbout}
              />
              {([
                { id: 'structure' as const, icon: <Atom className="w-3.5 h-3.5" />, label: 'Structure' },
                { id: 'assets' as const, icon: <Box className="w-3.5 h-3.5" />, label: 'Assets' },
              ]).map(t => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={effectiveTab === t.id}
                  onPointerEnter={() => hasDisclosure(t.id) ? scheduleDisclosureOpen(t.id) : closeDisclosureNow()}
                  onFocus={() => hasDisclosure(t.id) ? openDisclosureNow(t.id) : closeDisclosureNow()}
                  onClick={() => setActiveTab(t.id)}
                  className="zatom-pressable relative flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap"
                  style={{
                    color: effectiveTab === t.id ? 'var(--panel-text)' : 'var(--panel-text-secondary)',
                  }}
                >
                  {t.icon}
                  {t.label}
                  {effectiveTab === t.id && (
                    <motion.span
                      layoutId="sidebar-active-tab-indicator"
                      aria-hidden="true"
                      className="absolute -bottom-[3px] left-2 right-2 h-px rounded-full"
                      style={{ backgroundColor: 'var(--panel-accent)', willChange: 'transform' }}
                      transition={reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', duration: 0.42, bounce: 0 }}
                    />
                  )}
                </button>
              ))}
              <button
                type="button"
                aria-label="Collapse Structure panel"
                onPointerEnter={closeDisclosureNow}
                onClick={() => { setIsCollapsed(true);  }}
                className="zatom-pressable ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ color: 'var(--panel-text-secondary)' }}
                title="Collapse"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div
              aria-hidden={!disclosureOpen}
              className={`grid transition-[grid-template-rows,opacity] duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${disclosureOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex items-center justify-between pt-3">
                  <span style={{ fontSize: 10, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--panel-text-secondary)' }}>
                    {effectiveTab === 'structure' ? 'Boundary' : 'Source'}
                  </span>
                  {effectiveTab === 'structure' ? (
                    /* Delegate pointer events through data-sliding-segment-option to reveal Periodic details. */
                    <div
                      onPointerOver={(event) => {
                        const btn = (event.target as HTMLElement).closest('[data-sliding-segment-option]')
                        if (!btn) return
                        if (btn.textContent?.trim() === 'Periodic' && periodic) scheduleOverflowOpen()
                        else if (btn.textContent?.trim() === 'Molecule') { clearOverflowOpenTimer() }
                      }}
                      onFocusCapture={(event) => {
                        const btn = (event.target as HTMLElement).closest('[data-sliding-segment-option]')
                        if (btn?.textContent?.trim() === 'Periodic' && periodic) openOverflowNow()
                      }}
                    >
                      <SlidingSegmented
                        options={[
                          { value: 'periodic', label: 'Periodic' },
                          { value: 'molecule', label: 'Molecule' },
                        ] as const}
                        value={periodic ? 'periodic' : 'molecule'}
                        onChange={(value) => {
                          const next = value === 'periodic'
                          setPeriodic(next)
                          // Selecting Periodic opens the secondary disclosure; Molecule closes it.
                          if (next) openOverflowNow()
                          else closeOverflowNow()
                        }}
                        ariaLabel="Boundary type"
                        tabbable={disclosureOpen}
                        className="min-w-[164px]"
                      />
                    </div>
                  ) : (
                    <SlidingSegmented
                      options={ASSETS_MODE_OPTIONS}
                      value={assetsMode}
                      onChange={(value) => {
                        if (value === assetsMode) return
                        setAssetsMode(value)
                      }}
                      ariaLabel="Assets source"
                      tabbable={disclosureOpen}
                      className="min-w-[164px]"
                    />
                  )}
                </div>
                {/* Mirror the outside-cell store field and reveal it only for active Periodic interaction. */}
                {effectiveTab === 'structure' && (
                  <div
                    aria-hidden={!(periodic && overflowOpen)}
                    onPointerEnter={clearOverflowOpenTimer}
                    className={`grid transition-[grid-template-rows,opacity] duration-[420ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${periodic && overflowOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <span
                          title="What happens when an atom is moved outside the cell — same setting as in View settings"
                          style={{ fontSize: 10, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--panel-text-secondary)', whiteSpace: 'nowrap' }}
                        >
                          Outside cell
                        </span>
                        <SlidingSegmented
                          options={CELL_OVERFLOW_OPTIONS.map((o) => ({ value: o.mode, label: o.label }))}
                          value={cellOverflowMode}
                          onChange={(mode) => {
                            if (mode === cellOverflowMode) return
                            setCellOverflowMode(mode)
                          }}
                          ariaLabel="Cell overflow mode"
                          tabbable={disclosureOpen && periodic && overflowOpen}
                          className="min-w-[164px]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="relative w-[330px] h-full">
              <AnimatePresence initial={false}>
                <motion.div
                  key={effectiveTab}
                  initial={{
                    opacity: 0,
                    transform: reduceMotion
                      ? 'translateX(0px)'
                      : `translateX(${effectiveTab === 'structure' ? -8 : 8}px)`,
                  }}
                  animate={{ opacity: 1, transform: 'translateX(0px)' }}
                  exit={{
                    opacity: 0,
                    transform: reduceMotion
                      ? 'translateX(0px)'
                      : `translateX(${effectiveTab === 'structure' ? -8 : 8}px)`,
                  }}
                  transition={reduceMotion
                    ? { duration: 0.16, ease: 'linear' }
                    : { duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                  className="absolute inset-0"
                  style={{ willChange: 'transform, opacity' }}
                >
                  {effectiveTab === "structure" ? (
                    <StructurePanel />
                  ) : (
                    <AssemblyPanel
                      assetsBlockFloating={assetsBlockFloating}
                      onAssetsBlockFloatingChange={onAssetsBlockFloatingChange}
                      assetsMode={assetsMode}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

        </div>
      </aside>
    </div>
  )
}
