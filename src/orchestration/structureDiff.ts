export interface DiffAtom {
  element: string;
  position: [number, number, number]; // cartesian
}
export interface StructureDiff {
  added: DiffAtom[];
  removed: DiffAtom[];
  moved: Array<{ from: [number, number, number]; to: [number, number, number]; element: string }>;
  unchangedCount: number;
  /** Center and radius of changed-atom bounds for camera focus; null means no changes. */
  changedRegion: { center: [number, number, number]; radius: number } | null;
}
export interface DiffOptions {
  /** Position tolerance for matching the same atom, in Å. */
  posTol?: number;
  /** Displacements above this threshold count as moved, in Å. */
  moveTol?: number;
}

function dist2(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Greedily matches prior and next atoms by element and nearest position because
 * backend atom IDs may change. For each next atom, the nearest unmatched prior
 * atom of the same element matches when distance <= posTol and counts as moved
 * when displacement > moveTol. Other next atoms are added; unmatched prior atoms are removed.
 */
export function diffStructures(
  prior: DiffAtom[],
  next: DiffAtom[],
  opts: DiffOptions = {},
): StructureDiff {
  const posTol = opts.posTol ?? 0.3;
  const moveTol = opts.moveTol ?? 0.3;
  const posTol2 = posTol * posTol;
  const moveTol2 = moveTol * moveTol;

  const priorUsed = new Array(prior.length).fill(false);
  const added: DiffAtom[] = [];
  const moved: StructureDiff["moved"] = [];
  let unchangedCount = 0;

  for (const n of next) {
    let bestIdx = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < prior.length; i++) {
      if (priorUsed[i] || prior[i].element !== n.element) continue;
      const d2 = dist2(prior[i].position, n.position);
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestD2 <= posTol2) {
      priorUsed[bestIdx] = true;
      if (bestD2 > moveTol2) {
        moved.push({ from: prior[bestIdx].position, to: n.position, element: n.element });
      } else {
        unchangedCount++;
      }
    } else {
      added.push(n);
    }
  }
  const removed: DiffAtom[] = [];
  for (let i = 0; i < prior.length; i++) if (!priorUsed[i]) removed.push(prior[i]);

  // Bounds of the changed region.
  const pts: [number, number, number][] = [
    ...added.map((a) => a.position),
    ...removed.map((a) => a.position),
    ...moved.flatMap((m) => [m.from, m.to]),
  ];
  let changedRegion: StructureDiff["changedRegion"] = null;
  if (pts.length > 0) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = 0.5 * Math.sqrt(dist2(min, max)) + 1;
    changedRegion = { center, radius };
  }
  return { added, removed, moved, unchangedCount, changedRegion };
}
