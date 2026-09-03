/**
 * Pure conversion between physical figure size, DPI, and pixels. Hardware limits
 * reduce `effectiveDpi` explicitly rather than overstating export resolution.
 */

export const MM_PER_INCH = 25.4

export interface JournalPreset {
  id: string
  label: string
  widthMm: number
  /**
  * The maximum figure height allowed by the journal; when it is exceeded, the interface will give a prompt. Nature is 247 mm.
  */
  maxHeightMm?: number
  /**
  * Supplementary instructions for display (e.g. the original ACS text is given in inches).
  */
  note?: string
}

/** Common journal column widths; authors must still verify current target guidance. */
export const JOURNAL_PRESETS: readonly JournalPreset[] = [
  { id: 'nature-single', label: 'Nature · 1 column', widthMm: 89, maxHeightMm: 247 },
  { id: 'nature-mid', label: 'Nature · 1.5 column', widthMm: 120, maxHeightMm: 247 },
  { id: 'nature-double', label: 'Nature · 2 column', widthMm: 183, maxHeightMm: 247 },
  { id: 'science-single', label: 'Science · 1 column', widthMm: 84 },
  { id: 'science-double', label: 'Science · 2 column', widthMm: 174 },
  { id: 'acs-single', label: 'ACS · 1 column', widthMm: 84.6, note: '3.33 in' },
  { id: 'acs-double', label: 'ACS · 2 column', widthMm: 177.8, note: '7 in' },
]

/**
 * Common submission DPI. 150 is for a preview manuscript, 300 is the baseline for most journals, and 600 is for line drawings.
 */
export const DPI_CHOICES: readonly number[] = [150, 300, 600]

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH
}

export interface FigurePixelRequest {
  /**
  * Target physical width (mm).
  */
  widthMm: number
  dpi: number
  /**
  * The logical size of the current viewport, which determines the aspect ratio of the image.
  */
  viewportWidthPx: number
  viewportHeightPx: number
  /**
  * The upper limit of long-side pixels that the rendering side can provide (limited by the GPU framebuffer).
  */
  maxDimensionPx: number
}

export interface FigurePixelPlan {
  widthPx: number
  heightPx: number
  /**
  * The number of pixels on the long side passed to the capture layer - the maxDim semantics of the capture layer are long sides.
  */
  longEdgePx: number
  /**
  * The actual physical height converted back by effectiveDpi is convenient for verifying whether the upper limit of the journal's height is exceeded.
  */
  heightMm: number
  /**
  * Actual achieved DPI; lower than requested when truncated by hardware.
  */
  effectiveDpi: number
  /**
  * true means that the upper limit of the long side has been reached and the requested complete DPI cannot be obtained.
  */
  limitedByMaxDimension: boolean
}

/** Compute pixel dimensions while preserving the authored viewport composition. */
export function resolveFigurePixels(request: FigurePixelRequest): FigurePixelPlan {
  const widthMm = Math.max(1, request.widthMm)
  const dpi = Math.max(1, request.dpi)
  const viewportWidth = Math.max(1, request.viewportWidthPx)
  const viewportHeight = Math.max(1, request.viewportHeightPx)
  const maxDimension = Math.max(64, request.maxDimensionPx)

  const aspect = viewportWidth / viewportHeight
  const idealWidth = mmToInch(widthMm) * dpi
  const idealHeight = idealWidth / aspect
  const idealLongEdge = Math.max(idealWidth, idealHeight)

  // When reaching the upper limit, scale down proportionally, keeping the composition unchanged and only losing resolution.
  const scale = idealLongEdge > maxDimension ? maxDimension / idealLongEdge : 1
  const widthPx = Math.max(1, Math.round(idealWidth * scale))
  const heightPx = Math.max(1, Math.round(idealHeight * scale))

  const effectiveDpi = widthPx / mmToInch(widthMm)
  return {
    widthPx,
    heightPx,
    longEdgePx: Math.max(widthPx, heightPx),
    heightMm: inchToMm(heightPx / effectiveDpi),
    effectiveDpi,
    limitedByMaxDimension: scale < 1,
  }
}

/**
 * Return the prompt copy when the upper limit of the journal chart is exceeded, otherwise return null.
 */
export function describeHeightOverflow(plan: FigurePixelPlan, preset?: JournalPreset): string | null {
  if (!preset?.maxHeightMm) return null
  if (plan.heightMm <= preset.maxHeightMm) return null
  return `Height ${plan.heightMm.toFixed(1)} mm exceeds the ${preset.maxHeightMm} mm limit — crop or re-frame the view.`
}
