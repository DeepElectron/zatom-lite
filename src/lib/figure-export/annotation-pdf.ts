/**
 * Serialize shared annotation geometry to a page-sized PDF. Labels remain real
 * searchable PDF text over a lossless embedded PNG. Input coordinates are
 * y-down viewport pixels; `toPdfY` centralizes PDF's y-up conversion.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  computeArrowGeometry,
  computeScaleBarLayout,
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationStyle,
  type ProjectedAnnotation,
  type ProjectedVector,
  type ScaleBarSpec,
} from './annotation-model';

const PT_PER_MM = 72 / 25.4;

export interface BuildAnnotationPdfInput {
  /**
  * Viewport logical size - the space where the annotation coordinates are located.
  */
  viewportWidth: number;
  viewportHeight: number;
  /**
  * Physical page size (mm) = image frame size, no extra white margin left.
  */
  widthMm: number;
  heightMm: number;
  annotations: ProjectedAnnotation[];
  latticeVectors?: ProjectedVector[];
  scaleBar?: ScaleBarSpec | null;
  /**
  * PNG data URL of the structural basemap; if omitted, a pure annotation layer will be output (the PDF page itself will be transparent).
  */
  rasterDataUrl?: string | null;
  style?: Partial<AnnotationStyle>;
  /**
  * Write PDF metadata to facilitate source identification in the submission system.
  */
  title?: string;
}

/** Convert CSS hex to pdf-lib RGB, falling back to black on invalid input. */
function parseColor(value: string): RGB {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return rgb(0, 0, 0);
  const int = Number.parseInt(full, 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

interface TextPlacement {
  text: string;
  /**
  * Viewport pixel coordinates (y downward).
  */
  x: number;
  y: number;
  /**
  * 'center' vertical center (label/measurement); 'baseline' uses y as the baseline (ruler text).
  */
  anchor: 'center' | 'baseline';
  font: PDFFont;
}

export async function buildAnnotationPdf(input: BuildAnnotationPdfInput): Promise<Uint8Array> {
  const style = { ...DEFAULT_ANNOTATION_STYLE, ...input.style };
  const vw = Math.max(1, input.viewportWidth);
  const vh = Math.max(1, input.viewportHeight);
  const widthPt = Math.max(1, input.widthMm * PT_PER_MM);
  const heightPt = Math.max(1, input.heightMm * PT_PER_MM);

  // Map viewport pixels to PDF points; font sizes are already physical points.
  const k = widthPt / vw;
  const fontSize = style.fontSizePt;
  const strokeWidth = style.strokeWidthPt;

  const doc = await PDFDocument.create();
  doc.setProducer('zatom');
  doc.setCreator('zatom');
  if (input.title) doc.setTitle(input.title);
  const page = doc.addPage([widthPt, heightPt]);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const color = parseColor(style.color);
  const halo = style.haloColor ? parseColor(style.haloColor) : null;

  if (input.rasterDataUrl) {
    const image = await doc.embedPng(input.rasterDataUrl);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  }

  const toPdfY = (y: number) => heightPt - y * k;

  // ---- Lattice vector ----
  const vectorLabels: TextPlacement[] = [];
  for (const vector of input.latticeVectors ?? []) {
    if (vector.visible === false) continue;
    // The arrow size is calculated in viewport pixels (model space), so the font size is first divided by k and returned to the pixel domain.
    const arrow = computeArrowGeometry(vector.originPx, vector.tipPx, (fontSize / k) * 1.1);
    if (!arrow) continue;
    page.drawSvgPath(
      `M ${arrow.shaftStart[0] * k} ${arrow.shaftStart[1] * k} ` +
        `L ${arrow.shaftEnd[0] * k} ${arrow.shaftEnd[1] * k}`,
      { x: 0, y: heightPt, borderColor: color, borderWidth: strokeWidth * 1.6 },
    );
    page.drawSvgPath(
      `M ${arrow.headTip[0] * k} ${arrow.headTip[1] * k} ` +
        `L ${arrow.headLeft[0] * k} ${arrow.headLeft[1] * k} ` +
        `L ${arrow.headRight[0] * k} ${arrow.headRight[1] * k} Z`,
      { x: 0, y: heightPt, color },
    );
    vectorLabels.push({
      text: vector.label,
      x: arrow.labelAnchor[0],
      y: arrow.labelAnchor[1],
      anchor: 'center',
      font: italic,
    });
  }

  // ---- ruler ----
  const bar = input.scaleBar
    ? computeScaleBarLayout({
        viewportWidth: vw,
        viewportHeight: vh,
        bar: input.scaleBar,
        fontSize: fontSize / k,
      })
    : null;
  if (bar) {
    page.drawLine({
      start: { x: bar.x0 * k, y: toPdfY(bar.y) },
      end: { x: bar.x1 * k, y: toPdfY(bar.y) },
      thickness: strokeWidth * 2,
      color,
    });
  }

  const texts: TextPlacement[] = [
    ...vectorLabels,
    ...input.annotations
      .filter((a) => a.visible !== false)
      .map((a) => ({ text: a.text, x: a.x, y: a.y, anchor: 'center' as const, font: regular })),
    ...(bar
      ? [{ text: bar.label, x: bar.labelX, y: bar.labelY, anchor: 'baseline' as const, font: regular }]
      : []),
  ];

  for (const item of texts) {
    drawHaloedText(page, item, { fontSize, color, halo, k, toPdfY });
  }

  return doc.save();
}

function drawHaloedText(
  page: PDFPage,
  item: TextPlacement,
  ctx: {
    fontSize: number;
    color: RGB;
    halo: RGB | null;
    k: number;
    toPdfY: (y: number) => number;
  },
): void {
  const size = ctx.fontSize;
  const width = item.font.widthOfTextAtSize(item.text, size);
  const centerX = item.x * ctx.k;
  const anchorY = ctx.toPdfY(item.y);
  // Approximate Helvetica's visual center to match SVG's central baseline.
  const baselineY = item.anchor === 'center' ? anchorY - size * 0.34 : anchorY;

  if (ctx.halo) {
    const pad = size * 0.14;
    page.drawRectangle({
      x: centerX - width / 2 - pad,
      y: baselineY - size * 0.26 - pad,
      width: width + pad * 2,
      height: size + pad * 2,
      color: ctx.halo,
      opacity: 0.82,
    });
  }
  page.drawText(item.text, {
    x: centerX - width / 2,
    y: baselineY,
    size,
    font: item.font,
    color: ctx.color,
  });
}
