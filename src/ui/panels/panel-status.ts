export type PanelStatusTone = "success" | "warning" | "error" | "neutral"

export const PANEL_STATUS_TONES: Record<PanelStatusTone, {
  foreground: string
  background: string
  border: string
}> = {
  success: {
    foreground: "var(--status-green)",
    background: "var(--status-green-bg)",
    border: "var(--status-green-border)",
  },
  warning: {
    foreground: "var(--status-amber)",
    background: "var(--status-amber-bg)",
    border: "var(--status-amber-border)",
  },
  error: {
    foreground: "var(--status-red)",
    background: "var(--status-red-bg)",
    border: "var(--status-red-border)",
  },
  neutral: {
    foreground: "var(--status-neutral)",
    background: "var(--status-neutral-bg)",
    border: "var(--status-neutral-border)",
  },
}

export function panelStatusTone(tone: PanelStatusTone) {
  return PANEL_STATUS_TONES[tone]
}
