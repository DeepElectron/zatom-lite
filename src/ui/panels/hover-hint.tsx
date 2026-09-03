"use client"

/**
 * Delayed hover guidance. Disabled hints pass children through unchanged;
 * enabled hints parse names and shortcuts from titles and add optional details.
 */

import { useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

const DWELL_MS = 800
const RING_SIZE = 44 // Matches the ToolButton dimensions.

/** Optional descriptions and examples keyed by the exact ToolButton title. */
const HINT_DETAILS: Record<string, { description: string; example?: string }> = {
  "Command (Ctrl+K)": { description: "Open the command palette to search and run any modeling / compute command", example: "Type supercell, press Enter to expand the cell" },
  "Select Atoms (1)": { description: "Atom selection mode: click to select single atoms, multi-select supported. Ctrl+drag rotates the selection, Shift+Ctrl+drag moves it", example: "Click an atom to highlight; Shift+click to add" },
  "Select Edges/Bonds (2)": { description: "Bond / edge selection mode", example: "Click a bond to highlight it for measuring or deleting" },
  "Select Faces (3)": { description: "Crystal face selection mode", example: "Click a face to lock or slice along it" },
  "Box Select Mode (Shift+B) - Right-click for options": { description: "Box select: drag a rectangle to select atoms in bulk", example: "Drag a box over atoms; right-click for more options" },
  "Drag Atom (G)": { description: "Drag atoms to a new position. With a selection, Ctrl+drag rotates it about its centroid and Shift+Ctrl+drag slides it in the view plane", example: "Select a fragment, hold Ctrl and drag to twist its orientation" },
  "Transform Object (G)": { description: "Drag / transform the selected object", example: "Select an object, then drag to translate" },
  "Add Atom (A)": { description: "Place a new atom in the structure (works on an empty scene too)", example: "Pick an element, then click in the viewport" },
  "Bond Tool (B)": { description: "Create a chemical bond between two atoms", example: "Click two atoms in turn to bond them" },
  "Delete (D)": { description: "Click to delete an atom or bond", example: "Switch to the delete tool, then click the target" },
  "Toggle Bonds": { description: "Show / hide chemical bonds" },
  "Toggle Lattice Grid": { description: "Show / hide the lattice cage" },
  "Focus on Selection (F)": { description: "Zoom the camera to the selected atoms", example: "Select an atom, then press F to focus" },
  "Reset View (H)": { description: "Return the camera to its initial angle", example: "Lost your bearings? Press H to reset" },
  "Clear All Locked Cells": { description: "Release every locked cell / face" },
  "Call Agent": { description: "Summon the global AI assistant to drive modeling in plain language", example: 'Say "load diamond and expand to 2x2x2"' },
}

/** Parse a trailing shortcut such as `Add Atom (A)`; keep other parentheses in the name. */
function splitTitle(title: string): { name: string; shortcut?: string } {
  const m = title.match(/^(.*?)\s*\(([^()]+)\)/)
  if (m) {
    const inner = m[2].trim()
    const looksLikeShortcut = inner.length <= 14 && !/\s-\s/.test(inner) && !inner.includes("→")
    return { name: m[1].trim(), shortcut: looksLikeShortcut ? inner : undefined }
  }
  return { name: title }
}

function RingOverlay({ progress }: { progress: number }) {
  const stroke = 2.5
  const r = (RING_SIZE - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="pointer-events-none absolute inset-0"
      style={{ transform: "rotate(-90deg)" }}
      aria-hidden
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={r}
        fill="none"
        stroke="var(--panel-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        style={{ transition: `stroke-dashoffset ${DWELL_MS}ms linear`, opacity: 0.95 }}
      />
    </svg>
  )
}

export function HoverHint({ title, children }: { title: string; children: React.ReactNode }) {
  const enabled = useCrystalStore((s) => s.hoverHintsEnabled)
  const [dwelling, setDwelling] = useState(false)
  const [progress, setProgress] = useState(0)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setDwelling(false)
    setProgress(0)
    setOpen(false)
  }, [])

  const start = useCallback(() => {
    setDwelling(true)
    setProgress(0)
    // Set progress on the next frame so CSS fills the ring across DWELL_MS.
    rafRef.current = requestAnimationFrame(() => setProgress(1))
    timerRef.current = window.setTimeout(() => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (rect) setPos({ left: rect.left + rect.width / 2, top: rect.top })
      setOpen(true)
    }, DWELL_MS)
  }, [])

  // Bypass all hover behavior while hints are disabled.
  if (!enabled) return <>{children}</>

  const { name, shortcut } = splitTitle(title)
  const detail = HINT_DETAILS[title]

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={start}
      onMouseLeave={reset}
      onMouseDown={reset}
    >
      {children}
      {dwelling && !open && <RingOverlay progress={progress} />}
      {open && pos &&
        createPortal(
          <div
            className="zatom-hover-hint fixed z-[9999] pointer-events-none"
            style={{
              left: pos.left,
              top: pos.top,
              transform: "translate(-50%, calc(-100% - 12px))",
              transformOrigin: 'bottom center',
            }}
          >
            <div
              className="rounded-xl px-3 py-2 shadow-xl max-w-[260px]"
              style={{
                background: "var(--glass-bg, rgba(28,28,30,0.92))",
                border: "1px solid var(--glass-border-subtle, rgba(255,255,255,0.12))",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold" style={{ color: "var(--panel-text, #fff)" }}>{name}</span>
                {shortcut && (
                  <kbd
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "var(--glass-bg-active, rgba(255,255,255,0.12))", color: "var(--text-secondary, #bbb)" }}
                  >
                    {shortcut}
                  </kbd>
                )}
              </div>
              {detail?.description && (
                <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-secondary, #bbb)" }}>
                  {detail.description}
                </div>
              )}
              {detail?.example && (
                <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--control-selected-text)" }}>
                  e.g. {detail.example}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}
