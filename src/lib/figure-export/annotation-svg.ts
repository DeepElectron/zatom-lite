/**
 * Serialize a rasterized 3D structure with editable SVG annotations. The viewBox
 * uses viewport pixels while physical width/height use millimeters, keeping text
 * and line sizes independent of export DPI. Geometry is shared with PDF output.
 */

import {
  computeArrowGeometry,
  computeScaleBarLayout,
  DEFAULT_ANNOTATION_STYLE,
  ptToViewBoxUnits,
  type AnnotationStyle,
  type ProjectedAnnotation,
  type ProjectedVector,
  type ScaleBarSpec,
} from './annotation-model';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Values converge to 3 decimal places to avoid 17-bit floating point noise in SVG.
 */
function n(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

export interface BuildAnnotationSvgInput {
  /**
  * The logical size of the viewport - also the size of the viewBox.
  */
  viewportWidth: number;
  viewportHeight: number;
  /**
  * The physical size of the image (mm), determines the actual size of the pt font size.
  */
  widthMm: number;
  heightMm: number;
  annotations: ProjectedAnnotation[];
  latticeVectors?: ProjectedVector[];
  scaleBar?: ScaleBarSpec | null;
  /**
  * The data URL of the raster structure basemap; if omitted, a pure annotation layer (transparent background) will be output.
  */
  rasterDataUrl?: string | null;
  style?: Partial<AnnotationStyle>;
}

/**
 * Generate self-contained SVG: underlying embedded structural bitmap, with editable vector annotation above.
 */
export function buildAnnotationSvg(input: BuildAnnotationSvgInput): string {
  const style = { ...DEFAULT_ANNOTATION_STYLE, ...input.style };
  const vw = Math.max(1, input.viewportWidth);
  const vh = Math.max(1, input.viewportHeight);

  const fontSize = ptToViewBoxUnits(style.fontSizePt, input.widthMm, vw);
  const strokeWidth = ptToViewBoxUnits(style.strokeWidthPt, input.widthMm, vw);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` width="${n(input.widthMm)}mm" height="${n(input.heightMm)}mm"` +
      ` viewBox="0 0 ${n(vw)} ${n(vh)}">`,
  );

  if (input.rasterDataUrl) {
    // Exact viewBox sizing avoids seams from one-pixel capture rounding.
    parts.push(
      `<image x="0" y="0" width="${n(vw)}" height="${n(vh)}"` +
        ` preserveAspectRatio="none" xlink:href="${input.rasterDataUrl}"/>`,
    );
  }

  // ---- Lattice vector: draw first, let the text annotation overlap the arrow ----
  for (const vector of input.latticeVectors ?? []) {
    if (vector.visible === false) continue;
    const arrow = computeArrowGeometry(vector.originPx, vector.tipPx, fontSize * 1.1);
    if (!arrow) continue;
    parts.push(
      `<g stroke="${escapeXml(style.color)}" stroke-width="${n(strokeWidth * 1.6)}"` +
        ` fill="${escapeXml(style.color)}" stroke-linecap="round">` +
        `<line x1="${n(arrow.shaftStart[0])}" y1="${n(arrow.shaftStart[1])}"` +
        ` x2="${n(arrow.shaftEnd[0])}" y2="${n(arrow.shaftEnd[1])}"/>` +
        `<polygon stroke="none" points="${n(arrow.headTip[0])},${n(arrow.headTip[1])}` +
        ` ${n(arrow.headLeft[0])},${n(arrow.headLeft[1])}` +
        ` ${n(arrow.headRight[0])},${n(arrow.headRight[1])}"/>` +
        `</g>`,
    );
    // Crystallographic convention: lattice vector labels are italicized.
    parts.push(
      `<text x="${n(arrow.labelAnchor[0])}" y="${n(arrow.labelAnchor[1])}"` +
        ` font-family="${escapeXml(style.fontFamily)}" font-size="${n(fontSize)}"` +
        ` font-style="italic" fill="${escapeXml(style.color)}"` +
        ` text-anchor="middle" dominant-baseline="central">${escapeXml(vector.label)}</text>`,
    );
  }

  const visible = input.annotations.filter((a) => a.visible !== false);
  if (visible.length > 0) {
    parts.push(`<g font-family="${escapeXml(style.fontFamily)}" font-size="${n(fontSize)}">`);
    for (const a of visible) {
      const common =
        `x="${n(a.x)}" y="${n(a.y)}" text-anchor="middle" dominant-baseline="central"`;
      // A stroked underlay creates a portable halo that survives SVG conversion.
      if (style.haloColor) {
        parts.push(
          `<text ${common} fill="none" stroke="${escapeXml(style.haloColor)}"` +
            ` stroke-width="${n(strokeWidth * 3)}" stroke-linejoin="round">${escapeXml(a.text)}</text>`,
        );
      }
      parts.push(`<text ${common} fill="${escapeXml(style.color)}">${escapeXml(a.text)}</text>`);
    }
    parts.push('</g>');
  }

  const bar = input.scaleBar
    ? computeScaleBarLayout({
        viewportWidth: vw,
        viewportHeight: vh,
        bar: input.scaleBar,
        fontSize,
      })
    : null;
  if (bar) {
    parts.push(
      `<g stroke="${escapeXml(style.color)}" stroke-width="${n(strokeWidth * 2)}" stroke-linecap="butt">` +
        `<line x1="${n(bar.x0)}" y1="${n(bar.y)}" x2="${n(bar.x1)}" y2="${n(bar.y)}"/>` +
        `</g>`,
    );
    parts.push(
      `<text x="${n(bar.labelX)}" y="${n(bar.labelY)}"` +
        ` font-family="${escapeXml(style.fontFamily)}" font-size="${n(fontSize)}"` +
        ` fill="${escapeXml(style.color)}" text-anchor="middle">` +
        `${escapeXml(bar.label)}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}
