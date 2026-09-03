/**
 * Compose panel bitmaps into a millimeter-sized SVG plate. This layer owns panel
 * placement, labels, clipping, and the shared scale bar; per-panel annotations
 * remain the single-figure exporter's responsibility.
 */

import type { PlateCellBox, PlateLayout } from './plate-layout'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * mm values are rounded to 3 decimal places.
 */
function n(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0'
}

/**
 * pt → mm. The panel size and font size are given in printing pt, and the layout unit is mm.
 */
function ptToMm(pt: number): number {
  return (pt * 25.4) / 72
}

export interface PlateCellContent {
  label: string
  /**
  * The structure bitmap of this grid.
  */
  rasterDataUrl: string
  /** Content scale from `resolveSharedScale`; values below one enlarge and crop. */
  contentScale: number
}

export interface PlateSharedScaleBar {
  /**
  * The length represented by the ruler (Å). Synonymous with the ScaleBarSpec of annotation-model.
  */
  lengthAngstrom: number
  /**
  * The physical length of the ruler on the layout (mm), converted from the shared ratio.
  */
  lengthMm: number
}

export interface BuildPlateSvgInput {
  layout: PlateLayout
  cells: PlateCellContent[]
  /**
  * Panel size font size (pt).
  */
  labelFontSizePt: number
  /**
  * Plate background color; null is transparent.
  */
  backgroundColor: string | null
  /** Draw one scale bar for the entire shared-scale plate. */
  sharedScaleBar?: PlateSharedScaleBar | null
}

/**
 * Generate plate SVG. The panel number is placed outside the upper left corner of each box, which is the most common position in journals.
 */
export function buildPlateSvg(input: BuildPlateSvgInput): string {
  const { layout } = input
  const labelMm = ptToMm(input.labelFontSizePt)
  const byLabel = new Map(input.cells.map((cell) => [cell.label, cell]))

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` width="${n(layout.widthMm)}mm" height="${n(layout.heightMm)}mm"` +
      ` viewBox="0 0 ${n(layout.widthMm)} ${n(layout.heightMm)}">`,
  )

  if (input.backgroundColor) {
    parts.push(
      `<rect x="0" y="0" width="${n(layout.widthMm)}" height="${n(layout.heightMm)}"` +
        ` fill="${escapeXml(input.backgroundColor)}"/>`,
    )
  }

  // Each panel clips enlarged shared-scale content to its own bounds.
  parts.push('<defs>')
  for (const cell of layout.cells) {
    parts.push(
      `<clipPath id="plate-clip-${escapeXml(cell.label)}">` +
        `<rect x="${n(cell.xMm)}" y="${n(cell.yMm)}"` +
        ` width="${n(cell.widthMm)}" height="${n(cell.heightMm)}"/>` +
        `</clipPath>`,
    )
  }
  parts.push('</defs>')

  for (const box of layout.cells) {
    const content = byLabel.get(box.label)
    if (!content) continue
    parts.push(renderCell(box, content, labelMm))
  }

  if (input.sharedScaleBar) {
    parts.push(renderSharedScaleBar(layout, input.sharedScaleBar, labelMm))
  }

  parts.push('</svg>')
  return parts.join('')
}

function renderCell(box: PlateCellBox, content: PlateCellContent, labelMm: number): string {
  // Scales below one enlarge and center the bitmap, exposing a consistent world scale.
  const zoom = content.contentScale > 0 ? 1 / content.contentScale : 1
  const drawWidth = box.widthMm * zoom
  const drawHeight = box.heightMm * zoom
  const offsetX = box.xMm - (drawWidth - box.widthMm) / 2
  const offsetY = box.yMm - (drawHeight - box.heightMm) / 2

  return (
    `<g clip-path="url(#plate-clip-${escapeXml(box.label)})">` +
    `<image x="${n(offsetX)}" y="${n(offsetY)}"` +
    ` width="${n(drawWidth)}" height="${n(drawHeight)}"` +
    ` preserveAspectRatio="none" xlink:href="${content.rasterDataUrl}"/>` +
    `</g>` +
    // Inset panel labels so trim and clipping cannot cut them off.
    `<text x="${n(box.xMm + labelMm * 0.35)}" y="${n(box.yMm + labelMm)}"` +
    ` font-family="Helvetica, Arial, sans-serif" font-size="${n(labelMm)}"` +
    ` font-weight="bold" fill="#000000">${escapeXml(box.label)}</text>`
  )
}

/** Draw the plate-wide scale bar in the lower-right margin. */
function renderSharedScaleBar(
  layout: PlateLayout,
  bar: PlateSharedScaleBar,
  labelMm: number,
): string {
  const last = layout.cells[layout.cells.length - 1]
  if (!last) return ''
  const pad = labelMm * 0.5
  const barHeight = labelMm * 0.18
  const x = last.xMm + last.widthMm - pad - bar.lengthMm
  const y = last.yMm + last.heightMm - pad - barHeight - labelMm * 0.9
  const textSize = labelMm * 0.75

  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(bar.lengthMm)}" height="${n(barHeight)}"` +
    ` fill="#000000"/>` +
    `<text x="${n(x + bar.lengthMm / 2)}" y="${n(y + barHeight + textSize)}"` +
    ` font-family="Helvetica, Arial, sans-serif" font-size="${n(textSize)}"` +
    ` text-anchor="middle" fill="#000000">${bar.lengthAngstrom} \u00C5</text>`
  )
}
