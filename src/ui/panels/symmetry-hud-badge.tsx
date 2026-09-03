/** Compact viewport HUD for the latest space group, crystal system, and operation count. */
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'

export function SymmetryHUDBadge() {
  const analysis = useCrystalStore((s) => s.symmetryAnalysis)
  const show = useCrystalStore((s) => s.showSymmetryHUD)
  const setShow = useCrystalStore((s) => s.setShowSymmetryHUD)

  if (!show || !analysis) return null

  const sg = analysis.spaceGroup
  return (
    <div
      className={[
        'pointer-events-auto select-none',
        'relative rounded-[10px] px-3 py-2',
        'bg-[var(--panel-bg)]/85 backdrop-blur-sm',
        'border border-[var(--panel-border-focus)]/60',
        'shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_var(--panel-border)]',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="absolute left-0 top-1 bottom-1 w-px rounded-full bg-[var(--panel-accent)] opacity-80"
      />
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--panel-text-tertiary)]">
              Space group
            </span>
            <span className="text-sm font-mono font-semibold text-[var(--panel-text)] tabular-nums">
              {sg.internationalSymbol}
            </span>
            <span className="text-[10px] font-mono text-[var(--panel-text-tertiary)] tabular-nums">
              #{sg.number}
            </span>
          </div>
          <div className="flex items-baseline gap-2 text-[10px] text-[var(--panel-text-secondary)]">
            <span className="font-mono">{sg.crystalSystem}</span>
            <span className="text-[var(--panel-text-tertiary)]">·</span>
            <span className="font-mono">{sg.pointGroup}</span>
            <span className="text-[var(--panel-text-tertiary)]">·</span>
            <span className="font-mono tabular-nums">{analysis.operationCount} ops</span>
          </div>
        </div>
        <button
          onClick={() => setShow(false)}
          aria-label="Dismiss"
          className="ml-1 w-5 h-5 rounded text-[var(--panel-text-tertiary)] hover:text-[var(--panel-text)] hover:bg-[var(--panel-hover)]/40 transition-colors text-xs leading-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}
