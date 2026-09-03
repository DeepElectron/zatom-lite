"use client"

import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

export function StructureProcessingOverlay() {
  const processing = useCrystalStore((s) => s.structureProcessing)

  if (!processing.active) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/35 backdrop-blur-sm">
      <div
        className="w-[min(440px,calc(100vw-32px))] rounded-3xl border px-6 py-5"
        style={{
          background: 'var(--panel-bg)',
          borderColor: 'var(--panel-border)',
          boxShadow: '0 24px 72px rgba(0,0,0,0.32)',
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--panel-text-tertiary)]">
              Structure Processing
            </div>
            <div className="mt-2 text-[20px] font-medium text-[var(--panel-text)]">
              {processing.title}
            </div>
          </div>
          <div className="text-sm font-medium tabular-nums text-[var(--panel-text-secondary)]">
            {Math.round(processing.progress)}%
          </div>
        </div>

        <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--panel-elevated)]">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{
              width: `${Math.min(Math.max(processing.progress, 4), 100)}%`,
              background: 'var(--control-primary-bg)',
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 text-sm text-[var(--panel-text-secondary)]">
          <span>{processing.step}</span>
          {processing.detail ? (
            <span className="max-w-[52%] truncate text-right text-[var(--panel-text-tertiary)]">
              {processing.detail}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
