"use client"

/**
 * Shared tiny form controls for the structure-builder panels (Moiré / Nanotube /
 * Heterostructure). Mirrors the inline style cluster-builder/wulff-builder use,
 * factored out because three panels share the exact same Row + input + button +
 * status primitives.
 */
import { Sparkles } from "lucide-react"

export function BuilderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[10px]" style={{ color: "var(--panel-text-tertiary)" }}>{label}</span>
      {children}
    </div>
  )
}

export function NumInput({ value, onChange, step }: { value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
    />
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  width = 64,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="zatom-field rounded px-1.5 py-0.5 text-right text-[11px]"
      style={{ width }}
    />
  )
}

export function BuildButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="zatom-primary zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12px] font-medium"
    >
      <Sparkles className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

/** Shared build-result row with neutral text and a theme-aware status dot. */
export function StatusLine({ status }: { status: { ok: boolean; message: string } }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed"
      style={{
        color: "var(--panel-text)",
        backgroundColor: "var(--panel-elevated)",
        border: "1px solid var(--panel-border)",
      }}
    >
      <span
        aria-hidden
        className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: status.ok
            ? "var(--auto-theme-status-success)"
            : "var(--auto-theme-status-error)",
        }}
      />
      <span className="min-w-0 break-words">{status.message}</span>
    </div>
  )
}
