import type { ReactNode } from "react"

/** Shared panel section primitive with consistent spacing and label hierarchy. */

type Tone = "default" | "active"

const TONE_STYLE: Record<Tone, { background: string; border: string }> = {
        // A subtle surface groups related controls.
  default: {
    background: "var(--glass-bg-hover)",
    border: "1px solid var(--glass-border-subtle)",
  },
        // Only the active section receives an accent outline.
  active: {
    background: "var(--panel-accent-bg)",
    border: "1px solid var(--panel-accent-border)",
  },
}

export function PanelSection({
  label,
  trailing,
  tone = "default",
  children,
}: {
  label?: string
/** Secondary controls for a section label row, never the primary action. */
  trailing?: ReactNode
  tone?: Tone
  children: ReactNode
}) {
  const toneStyle = TONE_STYLE[tone]

  return (
    <section
      className="flex flex-col gap-2 rounded-xl p-3"
      style={{ background: toneStyle.background, border: toneStyle.border }}
    >
      {(label || trailing) && (
        <div className="flex items-center justify-between gap-2">
          {label ? <SectionLabel>{label}</SectionLabel> : <span />}
          {trailing}
        </div>
      )}
      {children}
    </section>
  )
}

/** Shared section label for groups that do not use PanelSection. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
      {children}
    </span>
  )
}
