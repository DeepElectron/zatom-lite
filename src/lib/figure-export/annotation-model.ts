/**
 * Shared vector-annotation geometry for SVG and PDF serializers. Coordinates use
 * viewport logical pixels with y downward; the PDF writer performs the final
 * y-axis conversion. Keeping geometry here prevents format-specific drift.
 */

/** Text annotation projected into viewport logical pixels. */
export interface ProjectedAnnotation {
  kind: 'atom-label' | 'measurement' | 'custom';
  text: string;
  x: number;
  y: number;
  /** Whether the referenced point is visible rather than occluded. */
  visible?: boolean;
}

/** Projected lattice vector with explicit endpoints for perspective-correct length. */
export interface ProjectedVector {
  /**
  * 'a' | 'b' | 'c' - Crystallographic convention is to italicize single letters.
  */
  label: string;
  originPx: [number, number];
  tipPx: [number, number];
  visible?: boolean;
}

export interface ScaleBarSpec {
  /**
  * The physical length represented by the ruler in Angstroms.
  */
  lengthAngstrom: number;
  /**
  * The number of screen pixels corresponding to this length - inferred from the camera projection, not an estimate.
  */
  lengthPx: number;
}

export interface AnnotationStyle {
  /**
  * Text size (pt). Nature requires 5–7 pt, ACS recommends ≥4.5 pt.
  */
  fontSizePt: number;
  /**
  * Font family. Default sans serif - journal figure convention.
  */
  fontFamily: string;
  /**
  * Comment color.
  */
  color: string;
  /**
  * Line width (pt). Nature recommends ≥0.25 pt, below which printing will break.
  */
  strokeWidthPt: number;
  /**
  * Stroke halo: Dark text on dark structures requires a light stroke to be read.
  */
  haloColor?: string;
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  fontSizePt: 7,
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#111111',
  strokeWidthPt: 0.75,
  haloColor: '#ffffff',
};

/** Convert print points to resolution-independent SVG viewBox units. */
export function ptToViewBoxUnits(pt: number, widthMm: number, viewBoxWidth: number): number {
  if (widthMm <= 0 || viewBoxWidth <= 0) return pt;
  const unitsPerInch = viewBoxWidth / (widthMm / 25.4);
  return (pt / 72) * unitsPerInch;
}

/**
 * Ruler text. Integers do not have a decimal point, non-integer numbers leave one digit - "5 Å" is cleaner than "5.0 Å".
 */
export function formatScaleBarLabel(lengthAngstrom: number): string {
  const rounded = Math.round(lengthAngstrom * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} \u00C5`;
}

/** Choose a conventional 1/2/5×10ⁿ scale-bar length near the target width. */
export function chooseScaleBarLength(
  pxPerAngstrom: number,
  targetPx: number,
): { lengthAngstrom: number; lengthPx: number } | null {
  if (!Number.isFinite(pxPerAngstrom) || pxPerAngstrom <= 0) return null;
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;

  const rawAngstrom = targetPx / pxPerAngstrom;
  const exponent = Math.floor(Math.log10(rawAngstrom));
  const magnitude = Math.pow(10, exponent);
  const normalized = rawAngstrom / magnitude;

  const step = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  const lengthAngstrom = step * magnitude;
  return { lengthAngstrom, lengthPx: lengthAngstrom * pxPerAngstrom };
}

/**
 * The position of the ruler in the screen (viewport pixels with y downward).
 */
export interface ScaleBarLayout {
  x0: number;
  x1: number;
  y: number;
  labelX: number;
  /**
  * Text centerline - the renderer is then offset according to its respective baseline rules.
  */
  labelY: number;
  label: string;
}

/** Place the scale bar four percent inward from the lower-left corner. */
export function computeScaleBarLayout(input: {
  viewportWidth: number;
  viewportHeight: number;
  bar: ScaleBarSpec;
  /**
  * The font size converted to viewBox units, used to position the text above the ruler.
  */
  fontSize: number;
}): ScaleBarLayout | null {
  if (!(input.bar.lengthPx > 0)) return null;
  const margin = Math.min(input.viewportWidth, input.viewportHeight) * 0.04;
  const y = input.viewportHeight - margin;
  const x0 = margin;
  const x1 = margin + input.bar.lengthPx;
  return {
    x0,
    x1,
    y,
    labelX: (x0 + x1) / 2,
    labelY: y - input.fontSize * 0.7,
    label: formatScaleBarLabel(input.bar.lengthAngstrom),
  };
}

/**
 * All vertices of the arrow (y-down viewport pixels).
 */
export interface ArrowGeometry {
  shaftStart: [number, number];
  /**
  * The rod is collected before the base of the arrow to prevent the end of the line from protruding from the tip of the triangle.
  */
  shaftEnd: [number, number];
  headTip: [number, number];
  headLeft: [number, number];
  headRight: [number, number];
  /**
  * Label anchor point: cross the arrow in the vector direction and cannot press the structure.
  */
  labelAnchor: [number, number];
}

/** Return arrow geometry, or null when projection collapses its direction. */
export function computeArrowGeometry(
  originPx: readonly [number, number],
  tipPx: readonly [number, number],
  headLengthPx: number,
): ArrowGeometry | null {
  const dx = tipPx[0] - originPx[0];
  const dy = tipPx[1] - originPx[1];
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-6) return null;

  // The arrow must not be longer than the rod itself, otherwise the short vector will become a pure triangle.
  const head = Math.max(1e-6, Math.min(headLengthPx, length * 0.5));
  const ux = dx / length;
  const uy = dy / length;
  const halfWidth = head * 0.42;

  const baseX = tipPx[0] - ux * head;
  const baseY = tipPx[1] - uy * head;

  return {
    shaftStart: [originPx[0], originPx[1]],
    shaftEnd: [baseX, baseY],
    headTip: [tipPx[0], tipPx[1]],
    headLeft: [baseX - uy * halfWidth, baseY + ux * halfWidth],
    headRight: [baseX + uy * halfWidth, baseY - ux * halfWidth],
    labelAnchor: [tipPx[0] + ux * head * 0.9, tipPx[1] + uy * head * 0.9],
  };
}
