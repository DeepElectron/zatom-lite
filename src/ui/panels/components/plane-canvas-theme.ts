/**
 * Semantic palette for the 2D plane canvas: neutral structure geometry,
 * one interaction accent, one committed-anchor color, and one molecule color.
 * CPK colors remain reserved for atom data.
 */

/** Neutral ink shared by lattice, bond, and atom outlines. */
export const CANVAS_INK = "var(--panel-text)"

/** Canvas surface color shared with the surrounding panel. */
export const CANVAS_SURFACE = "var(--panel-elevated)"

/** Interactive snap points, dynamic connections, and hover previews. */
export const CANVAS_ACCENT = "var(--panel-accent)"

/** Committed source atoms used to construct the plane. */
export const CANVAS_ANCHOR = "var(--status-amber)"

/** Fixed molecule-layer identity color with contrast in both themes. */
export const CANVAS_MOLECULE = "#8B5CF6"

/** Structure opacity ladder: solid on-plane and faint off-plane. */
export const STRUCTURE_OPACITY = {
  latticeOnPlane: 0.26,
  latticeOffPlane: 0.1,
  bond: 0.42,
} as const

/** Choose black or white labels from sRGB luminance so bright CPK colors remain legible. */
export function labelColorOn(background: string): string {
  const hex = background.trim().replace("#", "")
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex
  if (full.length !== 6) return "#ffffff"

  const channel = (offset: number) => {
    const srgb = Number.parseInt(full.slice(offset, offset + 2), 16) / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > 0.55 ? "#18181b" : "#ffffff"
}
