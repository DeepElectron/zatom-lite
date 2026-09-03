/** Mutually exclusive empty and populated footer states for plane mode. */


export function PlaneModeNoPlaneWarning() {
  return (
    <div
      className="px-4 py-3"
      style={{ background: "var(--panel-elevated)" }}
    >
      <div className="text-xs text-center" style={{ color: "var(--panel-text-tertiary)" }}>
        Select 3 atoms in 3D view to create a plane
      </div>
    </div>
  )
}

interface PlaneModeStatsActionsProps {
  onPlaneCount: number
  positiveCount: number
  negativeCount: number
  showOffPlaneAtoms: boolean
/** Hide the periodic-image toggle when there are no on-plane images. */
  mirrorCount: number
  showMirrors: boolean
  onToggleMirrors: () => void
  onSelectSide: (side: "positive" | "negative") => void
}

export function PlaneModeStatsActions({
  onPlaneCount,
  positiveCount,
  negativeCount,
  showOffPlaneAtoms,
  mirrorCount,
  showMirrors,
  onToggleMirrors,
  onSelectSide,
}: PlaneModeStatsActionsProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2"
      style={{
        background: "var(--panel-elevated)",
        borderTop: "1px solid var(--panel-border)",
      }}
    >
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ background: "#30D158" }} />
          <span style={{ color: "var(--panel-text-secondary)" }}>On plane: {onPlaneCount}</span>
        </span>
        {showOffPlaneAtoms && (
          <>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "#FF9500" }} />
              <span style={{ color: "var(--panel-text-secondary)" }}>+{positiveCount}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "#0A84FF" }} />
              <span style={{ color: "var(--panel-text-secondary)" }}>-{negativeCount}</span>
            </span>
          </>
        )}
        {mirrorCount > 0 && (
          <button
            onClick={() => {
              onToggleMirrors()
            }}
            aria-pressed={showMirrors}
            title="Show/hide periodic mirror atoms"
            className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
            data-selected={showMirrors}
          >
          {/* Dashed hollow circle matches periodic-image atoms on the canvas. */}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5" />
            </svg>
            <span style={{ color: "var(--panel-text-secondary)" }}>Mirrors: {mirrorCount}</span>
          </button>
        )}
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => {
            onSelectSide("positive")
          }}
          className="zatom-choice zatom-pressable rounded px-2 py-1 text-xs"
        >
          +Side
        </button>
        <button
          onClick={() => {
            onSelectSide("negative")
          }}
          className="zatom-choice zatom-pressable rounded px-2 py-1 text-xs"
        >
          -Side
        </button>
      </div>
    </div>
  )
}
