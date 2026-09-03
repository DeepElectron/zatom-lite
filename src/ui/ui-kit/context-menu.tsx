"use client"

/**
 * Shared right-click menu primitive (Radix menu internals + zatom glass tokens).
 *
 * Why this owns the gesture instead of using Radix's ContextMenu.Trigger:
 * three-stdlib's OrbitControls registers its own `contextmenu` listener on the
 * WebGL canvas and calls preventDefault() there. Radix composes trigger handlers
 * with `checkForDefaultPrevented`, so by the time React's synthetic handler runs
 * the event is already defaultPrevented and Radix silently declines to open. The
 * result was a right-click in the 3D viewport that produced no menu at all --
 * neither ours nor the browser's. Any fix that depends on which listener runs
 * first is a fix that breaks again the next time a control is added, so this
 * primitive listens natively and drives the menu in controlled mode. Radix still
 * supplies collision handling, keyboard navigation, focus restore and typeahead.
 *
 * Listener phase is deliberate: BUBBLE, not capture. Bubble runs innermost-first,
 * so a row's menu wins over an enclosing container's menu. Capture would invert
 * that and let the outer container swallow every row.
 *
 * Visual rules, deliberately narrow:
 *   - one surface treatment, taken from the existing floating-chrome tokens
 *   - icons are monochrome and inherit text color; color is reserved for
 *     destructive intent only. Per-item accent colors (the old menu used
 *     #30D158 / #FF9F0A / accent blue side by side) read as decoration and
 *     destroy the scan line down the label column.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu"
import { Check } from "lucide-react"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

type Point = { x: number; y: number }

const MenuCtx = createContext<{ openAt: (x: number, y: number) => void } | null>(null)

/**
 * Owns open state and the pointer anchor. Radix's ContextMenu.Root cannot be
 * driven from outside (it has no `open` prop, the trigger decides), which is why
 * this builds on the dropdown primitive plus a zero-size anchor parked at the
 * click point.
 */
export function ContextMenuRoot({ children }: { children: ReactNode }) {
  const [point, setPoint] = useState<Point | null>(null)
  const ctx = useMemo(
    () => ({ openAt: (x: number, y: number) => setPoint({ x, y }) }),
    [],
  )

  return (
    <MenuCtx.Provider value={ctx}>
      <RadixMenu.Root
        open={point !== null}
        onOpenChange={(next) => {
          if (!next) setPoint(null)
        }}
      >
        <RadixMenu.Trigger asChild>
          {/* Positioning anchor only. Zero-size and inert so it can never
              intercept a click meant for the canvas or the row underneath. */}
          <span
            aria-hidden
            style={{
              position: "fixed",
              left: point?.x ?? 0,
              top: point?.y ?? 0,
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
          />
        </RadixMenu.Trigger>
        {children}
      </RadixMenu.Root>
    </MenuCtx.Provider>
  )
}

/**
 * Wraps the element that should answer right-clicks. `display: contents` keeps
 * the wrapper out of layout entirely while still sitting in the DOM tree, which
 * is all that event propagation needs.
 *
 * `asChild` is accepted and ignored: call sites already pass it and the wrapper
 * is layout-neutral, so honouring it would only add a cloneElement/ref dance.
 */
export function ContextMenuTrigger({
  children,
}: {
  children: ReactNode
  asChild?: boolean
}) {
  const ctx = useContext(MenuCtx)
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const openAt = ctx?.openAt

  useEffect(() => {
    const host = hostRef.current
    if (!host || !openAt) return

    const onContextMenu = (event: MouseEvent) => {
      // Suppress the native menu here rather than relying on a descendant to
      // have done it: on plain DOM rows nothing else calls preventDefault, and
      // that is exactly where the browser menu used to leak through.
      event.preventDefault()
      // Innermost menu wins; see the phase note in the file header.
      event.stopPropagation()
      openAt(event.clientX, event.clientY)
    }

    host.addEventListener("contextmenu", onContextMenu)
    return () => host.removeEventListener("contextmenu", onContextMenu)
  }, [openAt])

  return (
    <span ref={hostRef} style={{ display: "contents" }}>
      {children}
    </span>
  )
}

export const ContextMenuSub = RadixMenu.Sub

const SURFACE: React.CSSProperties = {
  background: "var(--glass-bg)",
  backdropFilter: "var(--glass-blur)",
  WebkitBackdropFilter: "blur(48px)",
  border: "1px solid var(--glass-border)",
  boxShadow: "var(--shadow-float)",
  color: "var(--text-primary)",
}

const SURFACE_CLASS =
  "zatom-context-menu z-[9999] min-w-[184px] rounded-xl p-1"

/**
 * Height cap so a tall menu can never be clipped by the top or bottom edge.
 *
 * `collisionPadding` alone only flips and shifts the surface, which does nothing
 * once the menu is taller than the viewport — the overflowing rows (Placement,
 * Undo/Redo, the view toggles) were simply cut off with no way to reach them.
 * Radix measures the space actually available at the chosen side and publishes
 * it as this CSS var, so capping against it and scrolling the remainder keeps
 * every row reachable at any window height.
 *
 * `overscrollBehavior: contain` stops a wheel gesture that hits the end of the
 * list from continuing into the 3D viewport behind it and spinning the camera.
 */
const SCROLL_CAP: React.CSSProperties = {
  maxHeight: "var(--radix-dropdown-menu-content-available-height)",
  overflowY: "auto",
  overscrollBehavior: "contain",
}

/**
 * Menu surface. Anchored top-left to the pointer, matching platform context
 * menus; `collisionPadding` pulls it back inside the window near edges.
 */
export function ContextMenuContent({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        className={SURFACE_CLASS}
        style={{ ...SURFACE, ...SCROLL_CAP }}
        side="bottom"
        align="start"
        sideOffset={0}
        alignOffset={0}
        collisionPadding={8}
        // Required for the available-height var above to track the real gap
        // between the pointer and the viewport edge.
        avoidCollisions
        // Right-clicking inside the 3D viewport must not permanently park focus
        // on an invisible anchor; let the canvas keep it.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  )
}

export function ContextMenuSubContent({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.SubContent
        className={SURFACE_CLASS}
        style={{ ...SURFACE, ...SCROLL_CAP }}
        collisionPadding={8}
        avoidCollisions
      >
        {children}
      </RadixMenu.SubContent>
    </RadixMenu.Portal>
  )
}

const ITEM_CLASS =
  "group relative flex select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 " +
  "text-[12px] leading-none outline-none cursor-default " +
  "data-[highlighted]:bg-[var(--glass-bg-hover)] " +
  "data-[disabled]:opacity-35 data-[disabled]:pointer-events-none"

export function ContextMenuItem({
  children,
  onSelect,
  disabled,
  icon,
  shortcut,
  destructive,
}: {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  icon?: ReactNode
  /** Reminder of an existing keybinding. Never invent one that isn't bound. */
  shortcut?: string
  destructive?: boolean
}) {
  return (
    <RadixMenu.Item
      className={ITEM_CLASS}
      disabled={disabled}
      onSelect={onSelect}
      style={destructive ? { color: "var(--status-red, #FF453A)" } : undefined}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{icon}</span>
      ) : null}
      <span className="flex-1 whitespace-nowrap">{children}</span>
      {shortcut ? (
        <span className="ml-3 shrink-0 font-mono text-[10px] tracking-tight opacity-45">{shortcut}</span>
      ) : null}
    </RadixMenu.Item>
  )
}

/**
 * Stateful toggle. Use this instead of an Item whose label flips between
 * "Show X" and "Hide X": a flipping label describes the action, so the current
 * state can only be inferred from the verb, and it moves under the cursor the
 * instant it is clicked. A checkmark against a stable label reads as state.
 */
export function ContextMenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
  disabled,
  shortcut,
}: {
  children: ReactNode
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  shortcut?: string
}) {
  return (
    <RadixMenu.CheckboxItem
      className={ITEM_CLASS}
      checked={checked}
      disabled={disabled}
      // Toggles are compared and flipped in runs, so keep the menu open.
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={onCheckedChange}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <RadixMenu.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </RadixMenu.ItemIndicator>
      </span>
      <span className="flex-1 whitespace-nowrap">{children}</span>
      {shortcut ? (
        <span className="ml-3 shrink-0 font-mono text-[10px] tracking-tight opacity-45">{shortcut}</span>
      ) : null}
    </RadixMenu.CheckboxItem>
  )
}

export function ContextMenuSubTrigger({ children, icon, disabled }: {
  children: ReactNode
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <RadixMenu.SubTrigger className={ITEM_CLASS} disabled={disabled}>
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-70">{icon}</span>
      ) : null}
      <span className="flex-1 whitespace-nowrap">{children}</span>
      <span className="ml-3 shrink-0 text-[10px] opacity-45">{"\u203A"}</span>
    </RadixMenu.SubTrigger>
  )
}

export function ContextMenuSeparator() {
  return (
    <RadixMenu.Separator
      className="my-1 h-px"
      style={{ background: "var(--glass-border-subtle)" }}
    />
  )
}

/**
 * Non-interactive context line, e.g. "3 atoms selected". Tells the user what the
 * menu's verbs will act on — without it, "Delete" in a viewport menu is a guess.
 */
export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label
      className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider"
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </RadixMenu.Label>
  )
}
