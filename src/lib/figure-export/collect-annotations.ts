/**
 * Project annotations with the exact camera pose used by capture. Reconstructing
 * projection separately can diverge in camera type or controls target.
 */

import type {
  ViewportTargetGeometry,
  ViewportTargetPlacement,
} from '../../orchestration/viewportCaptureRegistry';
import {
  chooseScaleBarLength,
  type ProjectedAnnotation,
  type ProjectedVector,
  type ScaleBarSpec,
} from './annotation-model';

/**
 * Injection projector, convenient for single testing without the real WebGL viewport.
 */
export type AnnotationProjector = (
  target: ViewportTargetGeometry,
) => Promise<ViewportTargetPlacement | null>;

export interface AnnotationAtom {
  id: string;
  element: string;
  position: [number, number, number];
  label?: string;
}

export interface AnnotationMeasurement {
  id: string;
  type: 'distance' | 'angle' | 'dihedral';
  atomIds: string[];
  value: number;
}

/** Atom-label scope; selection-only is the readable default for large structures. */
export type AtomLabelScope = 'none' | 'selected' | 'all';

/** Cartesian cell basis vectors in Å, drawn from the rendered cell origin. */
export interface AnnotationLatticeVectors {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
}

export interface CollectAnnotationsInput {
  atoms: AnnotationAtom[];
  measurements: AnnotationMeasurement[];
  selectedAtomIds: ReadonlySet<string>;
  atomLabelScope: AtomLabelScope;
  includeMeasurements: boolean;
  includeScaleBar: boolean;
  /**
  * If omitted or given as null, the lattice vector will not be drawn (the molecular system does not have a unit cell).
  */
  latticeVectors?: AnnotationLatticeVectors | null;
  projector: AnnotationProjector;
  /**
  * A hard upper limit on the number of tags to prevent a giant SVG that cannot be opened when "all" is accidentally clicked.
  */
  maxAtomLabels?: number;
}

export interface CollectedAnnotations {
  annotations: ProjectedAnnotation[];
  latticeVectors: ProjectedVector[];
  scaleBar: ScaleBarSpec | null;
  /**
  * The UI needs to truthfully inform the user of the number of tags that have been omitted due to exceeding the upper limit.
  */
  omittedAtomLabels: number;
}

const DEFAULT_MAX_ATOM_LABELS = 200;

function centroid(atoms: AnnotationAtom[]): [number, number, number] {
  if (atoms.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const a of atoms) {
    x += a.position[0];
    y += a.position[1];
    z += a.position[2];
  }
  return [x / atoms.length, y / atoms.length, z / atoms.length];
}

function midpoint(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Format the same Å and degree values shown in the measurement panel. */
function formatMeasurement(m: AnnotationMeasurement): string {
  if (m.type === 'distance') return `${m.value.toFixed(2)} \u00C5`;
  return `${m.value.toFixed(1)}\u00B0`;
}

export async function collectProjectedAnnotations(
  input: CollectAnnotationsInput,
): Promise<CollectedAnnotations> {
  const annotations: ProjectedAnnotation[] = [];
  const maxLabels = input.maxAtomLabels ?? DEFAULT_MAX_ATOM_LABELS;
  let omittedAtomLabels = 0;

  // ---- Atomic tag ----
  let labelTargets: AnnotationAtom[] = [];
  if (input.atomLabelScope === 'all') {
    labelTargets = input.atoms;
  } else if (input.atomLabelScope === 'selected') {
    labelTargets = input.atoms.filter((a) => input.selectedAtomIds.has(a.id));
  }
  if (labelTargets.length > maxLabels) {
    omittedAtomLabels = labelTargets.length - maxLabels;
    labelTargets = labelTargets.slice(0, maxLabels);
  }

  for (const atom of labelTargets) {
    const placement = await input.projector({ center: atom.position, radius: 0 });
    if (!placement) continue;
    annotations.push({
      kind: 'atom-label',
      text: atom.label ?? atom.element,
      x: placement.centerPx[0],
      y: placement.centerPx[1],
      visible: placement.centerVisible,
    });
  }

  // ---- Measurement value ----
  if (input.includeMeasurements && input.measurements.length > 0) {
    const byId = new Map(input.atoms.map((a) => [a.id, a]));
    for (const m of input.measurements) {
      // Distances use the endpoint midpoint; angles use their defining vertex.
      let anchor: [number, number, number] | null = null;
      if (m.type === 'distance' && m.atomIds.length >= 2) {
        const a = byId.get(m.atomIds[0]);
        const b = byId.get(m.atomIds[1]);
        if (a && b) anchor = midpoint(a.position, b.position);
      } else if (m.atomIds.length >= 2) {
        anchor = byId.get(m.atomIds[1])?.position ?? null;
      }
      if (!anchor) continue;

      const placement = await input.projector({ center: anchor, radius: 0 });
      if (!placement) continue;
      annotations.push({
        kind: 'measurement',
        text: formatMeasurement(m),
        x: placement.centerPx[0],
        y: placement.centerPx[1],
        visible: true, // A measurement is a result, not an occlusion-sensitive locator.
      });
    }
  }

  // ---- Lattice vector ----
  const latticeVectors: ProjectedVector[] = [];
  if (input.latticeVectors) {
    const origin = await input.projector({ center: [0, 0, 0], radius: 0 });
    for (const label of ['a', 'b', 'c'] as const) {
      const vector = input.latticeVectors[label];
      // Skip incomplete zero-length lattice vectors.
      if (Math.hypot(vector[0], vector[1], vector[2]) < 1e-9) continue;
      const tip = await input.projector({ center: vector, radius: 0 });
      if (!origin || !tip) continue;
      latticeVectors.push({
        label,
        originPx: [origin.centerPx[0], origin.centerPx[1]],
        tipPx: [tip.centerPx[0], tip.centerPx[1]],
        // Lattice axes describe the coordinate frame and remain useful through
        // occlusion; only reject projections outside the view.
        visible: origin.regionVisible || tip.regionVisible,
      });
    }
  }

  // ---- ruler ----
  let scaleBar: ScaleBarSpec | null = null;
  if (input.includeScaleBar && input.atoms.length > 0) {
    // Measure px/Å at the structure center, the representative perspective depth.
    const probe = await input.projector({ center: centroid(input.atoms), radius: 1 });
    if (probe && probe.projectedRadiusPx > 0) {
      const targetPx = probe.viewportSizePx[0] * 0.2;
      scaleBar = chooseScaleBarLength(probe.projectedRadiusPx, targetPx);
    }
  }

  return { annotations, latticeVectors, scaleBar, omittedAtomLabels };
}
