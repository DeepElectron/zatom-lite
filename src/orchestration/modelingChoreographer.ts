import { getActiveViewportStoreApi } from "./ViewportContext";
import { useAgentActivity } from "./agentActivityStore";
import { ENTRANCE_MS, scheduleExit, clearExit, EXIT_MS } from "./atomEntranceSchedule";
import type { Bond, HistoryState } from "./crystal-store-types";
import { diffStructures, type DiffAtom } from "./structureDiff";

type CaptionFn = (text: string | null) => void;
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    resolve();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Choreography wait was cancelled');
}

let activeRun: ActiveChoreographyClaim | null = null;
export function abortChoreography(): void {
  activeRun?.controller.abort(new Error('Animation skipped by the user'));
}

// Single-flight guard: prevents concurrent replays from racing each other.
let running = false;
let nextRunId = 1;

export interface ChoreographyClaim {
  readonly id: number;
  readonly signal: AbortSignal;
  release: () => void;
}

interface ActiveChoreographyClaim extends ChoreographyClaim {
  readonly controller: AbortController;
}

// Waiters for the next idle point. Calls rejected by the single-flight guard use
// this so follow-up work, such as showing a review card, cannot interrupt a replay.
let idleWaiters: Array<() => void> = [];
function releaseRun(runId: number): void {
  // A stale/double finally must never release a newer run.
  if (!activeRun || activeRun.id !== runId) return;
  running = false;
  activeRun = null;
  const waiters = idleWaiters;
  idleWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function beginRun(): ActiveChoreographyClaim | null {
  if (running) return null;
  running = true;
  const controller = new AbortController();
  const id = nextRunId++;
  let released = false;
  const claim: ActiveChoreographyClaim = {
    id,
    signal: controller.signal,
    controller,
    release: () => {
      if (released) return;
      released = true;
      releaseRun(id);
    },
  };
  activeRun = claim;
  return claim;
}

/** Resolves at the next idle point, or immediately when no replay is running. */
export function awaitChoreographyIdle(signal?: AbortSignal): Promise<void> {
  if (!running) {
    return signal?.aborted ? Promise.reject(cancellationError(signal)) : Promise.resolve();
  }
  if (signal?.aborted) return Promise.reject(cancellationError(signal));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const index = idleWaiters.indexOf(finish);
      if (index >= 0) idleWaiters.splice(index, 1);
      reject(cancellationError(signal!));
    };
    idleWaiters.push(finish);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Synchronously reserves the replay before the write promise resolves, making
 * the imminent atom rollback visible to callers.
 *
 * performAppliedResultReveal starts asynchronously, so without this reservation
 * the write could resolve before running becomes true. awaitChoreographyIdle()
 * would then resolve inside the interval between restoring priorAtoms and
 * committing next, exposing the rolled-back structure to readback.
 *
 * Candidate fingerprint verification relies on that readback; observing the old
 * structure would falsely mark a successful write as blocked.
 *
 * Reservation must therefore be synchronous so running is already set when the
 * caller resumes after awaiting the write.
 */
export function claimChoreographySlot(): ChoreographyClaim | null {
  return beginRun();
}

export interface PerformBuildOptions {
  onCaption?: CaptionFn;
  /** Atoms per batch; defaults to roughly 12 batches based on the total. */
  batchSize?: number;
  /** Delay between batches in ms; defaults to at least the entrance duration. */
  stepMs?: number;
  /** Number of batches between camera moves; defaults to 3. */
  focusEveryBatches?: number;
  /** Camera beat in ms; defaults to 950 and must exceed the roughly 600 ms flight. */
  cameraSettleMs?: number;
  /** Skip per-atom replay above this count; use one camera move and entrance instead. */
  maxAtomsForPerAtom?: number;
}

/**
 * Replays the current viewer structure as a visible per-atom build:
 * snapshot → clear → restore in batches with periodic camera focus → exact
 * setAtomsDirectly(snapshot) restoration and overview. abortChoreography() restores
 * the snapshot immediately so cancellation never leaves a partial structure.
 *
 * Uses setAtomsDirectly for exact final restoration.
 */
export async function performStructureBuild(opts: PerformBuildOptions = {}): Promise<void> {
  // M5: single-flight guard — prevent concurrent replays from racing.
  const run = beginRun();
  if (!run) return;

  // Push only after the single-flight guard; rejected calls have no animation
  // for the Skip button to target.
  const endActivity = useAgentActivity.getState().begin({
    label: 'Replaying the build',
    tier: 'mutate',
    interruptible: true,
  });

  try {
    const api = getActiveViewportStoreApi();
    if (!api) return;
    const store0 = api.getState();
    const snapshot = [...(store0.atoms ?? [])];
    // I1: snapshot bonds alongside atoms so manual/custom bonds survive replay.
    const bondSnapshot: Bond[] = [...((store0.bonds ?? []) as Bond[])];
    if (snapshot.length === 0) return;

    // I2: snapshot the undo/redo history stacks so we can restore them after
    // replay, leaving the undo history exactly as it was before choreography.
    // addAtomToSupercell, setAtomsDirectly, and setBondsDirectly all call
    // pushHistory internally; without this restore a 300-atom replay would
    // leave ~302 junk undo entries on the stack.
    const historySnapshot: HistoryState[] = [...(store0.history ?? [])];
    const historyIndexSnapshot: number = store0.historyIndex ?? -1;

    const maxPerAtom = opts.maxAtomsForPerAtom ?? 300;
    // For large structures, keep atoms intact and apply one overview entrance.
    if (snapshot.length > maxPerAtom) {
      opts.onCaption?.("Building structure…");
      store0.focusOnAtoms?.(snapshot.slice(0, 60).map((a: any) => a.id));
      await wait(1200, run.signal);
      store0.resetCameraToInitial?.();
      opts.onCaption?.(null);
      return;
    }

    const total = snapshot.length;
    const batch = opts.batchSize ?? Math.max(1, Math.ceil(total / 12));
    // Keep each batch visible for at least its entrance duration before adding the next.
    const stepMs = opts.stepMs ?? Math.max(ENTRANCE_MS, 320);
    const focusEvery = opts.focusEveryBatches ?? 3;
    // The camera beat must exceed the roughly 600 ms flight and leave time to dwell.
    const cameraSettleMs = opts.cameraSettleMs ?? 950;

    // Clear the scene and establish the opening overview.
    store0.clearSelection?.();
    store0.deleteAtomsByIds(snapshot.map((a: any) => a.id));
    opts.onCaption?.("Starting build…");
    store0.resetCameraToInitial?.();
    await wait(600, run.signal);

    // Restore batches through addAtomToSupercell to trigger entrance animation.
    // Await each focusEvery camera flight and dwell so the next batch cannot interrupt it.
    let batchIndex = 0;
    for (let i = 0; i < total; i += batch) {
      if (run.signal.aborted) break;
      const s = getActiveViewportStoreApi()?.getState();
      if (!s) break;
      const slice = snapshot.slice(i, i + batch);
      slice.forEach((a: any) =>
        s.addAtomToSupercell(a.element, (a.cartesian ?? a.position ?? [0, 0, 0]) as [number, number, number]),
      );
      batchIndex += 1;
      opts.onCaption?.(`Building… ${Math.min(i + batch, total)}/${total}`);
      await wait(stepMs, run.signal); // Let this batch finish appearing.
      if (run.signal.aborted) break;
      // Move the camera on cadence, except for the final batch reserved for the overview.
      if (batchIndex % focusEvery === 0 && i + batch < total) {
        const cur = getActiveViewportStoreApi()?.getState();
        const recent = (cur?.atoms ?? [])
          .slice(-Math.min(40, batch * focusEvery))
          .map((a: any) => a.id);
        if (recent.length) {
          cur?.focusOnAtoms?.(recent);
          await wait(cameraSettleMs, run.signal); // Wait for the flight and its dwell.
        }
      }
    }

    // Restore the exact final IDs, bonds, and selection before the closing overview.
    // Uses setAtomsDirectly / setBondsDirectly (real store actions).
    // Reached on both normal completion AND abort (aborted breaks the loop and
    // falls through here), so abort also restores cleanly.
    const sFinal = getActiveViewportStoreApi()?.getState();
    sFinal?.setAtomsDirectly?.(snapshot);
    // I1: restore original bonds (including manual/custom bonds) after replay.
    sFinal?.setBondsDirectly?.(bondSnapshot);
    sFinal?.clearSelection?.();
    // I2: restore undo/redo stacks — replay must be history-neutral.
    api.setState({ history: historySnapshot, historyIndex: historyIndexSnapshot });
    // Return to the overview and dwell on the finished result.
    opts.onCaption?.("Done");
    sFinal?.resetCameraToInitial?.();
    await wait(1100, run.signal);
    opts.onCaption?.(null);
  } finally {
    // M5: always release the single-flight lock, even on throw/abort.
    endActivity();
    run.release();
  }
}

export interface TransitionOptions {
  onCaption?: (t: string | null) => void;
  posTol?: number;
  moveTol?: number;
  /** Above this total delta, skip per-atom animation and focus the committed result. */
  maxDeltaForPerAtom?: number;
  stepMs?: number;
}

/**
 * Transition from prior to next by exiting removed atoms, entering added atoms,
 * focusing the changed region, then committing next exactly. Moved atoms are
 * treated as remove-plus-add and inputs use Cartesian coordinates.
 *
 * Per-atom scheduling is visible only in the full-detail AtomMesh path; instanced
 * and massive-scene renderers commit directly. Cancellation still commits
 * `nextAtomsForCommit` after breaking the loop so no partial result remains.
 */
export async function performStructureTransition(
  prior: DiffAtom[],
  next: DiffAtom[],
  nextAtomsForCommit: any[],      // Canonical Atom[] with real IDs and Cartesian positions.
  nextBondsForCommit: any[],      // Canonical Bond[].
  opts: TransitionOptions = {},
): Promise<void> {
  const run = beginRun();
  if (!run) return;
  const endActivity = useAgentActivity.getState().begin({
    label: 'Showing what changed',
    tier: 'mutate',
    interruptible: true,
  });
  let api: ReturnType<typeof getActiveViewportStoreApi> | null = null;
  let historySnapshot: HistoryState[] = [];
  let historyIndexSnapshot = -1;
  try {
    api = getActiveViewportStoreApi();
    if (!api) return;
    const store0 = api.getState();
    historySnapshot = [...(store0.history ?? [])];
    historyIndexSnapshot = store0.historyIndex ?? -1;
    const diff = diffStructures(prior, next, { posTol: opts.posTol, moveTol: opts.moveTol });
    if (!diff.changedRegion) { // No visible change.
      return;
    }
    const deltaCount = diff.added.length + diff.removed.length + diff.moved.length * 2;
    const maxDelta = opts.maxDeltaForPerAtom ?? 300;

    // Focus the changed region.
    store0.focusOnPoint?.(diff.changedRegion.center, diff.changedRegion.radius);
    opts.onCaption?.("Applying operation…");
    await wait(700, run.signal);

    if (deltaCount > maxDelta) {
      // Degrade to a direct commit with one entrance.
      api.getState().setAtomsDirectly?.(nextAtomsForCommit);
      api.getState().setBondsDirectly?.(nextBondsForCommit);
      api.setState({ history: historySnapshot, historyIndex: historyIndexSnapshot });
      opts.onCaption?.("Done"); await wait(150, run.signal); opts.onCaption?.(null);
      return;
    }

    const stepMs = opts.stepMs ?? Math.max(EXIT_MS, 280);
    // Treat a move as removal at the old position plus addition at the new one.
    const removed = [...diff.removed, ...diff.moved.map((m) => ({ element: m.element, position: m.from }))];
    const added = [...diff.added, ...diff.moved.map((m) => ({ element: m.element, position: m.to }))];

    // Exit removed atoms by nearest element/position match, then delete after the animation.
    if (removed.length && !run.signal.aborted) {
      const cur = api.getState();
      const exitingIds: string[] = [];
      for (const r of removed) {
        const posTol = opts.posTol ?? 0.3;
        const posTol2 = posTol * posTol;
        const hit = (cur.atoms ?? []).find(
          (a: any) => {
            if (a.element !== r.element || exitingIds.includes(a.id)) return false;
            const c = a.cartesian ?? a.position ?? [0, 0, 0];
            const dx = c[0] - r.position[0], dy = c[1] - r.position[1], dz = c[2] - r.position[2];
            return dx * dx + dy * dy + dz * dz <= posTol2;
          },
        );
        if (hit) { scheduleExit(hit.id, performance.now()); exitingIds.push(hit.id); }
      }
      if (exitingIds.length) {
        opts.onCaption?.(`Removing ${exitingIds.length} atoms…`);
        await wait(EXIT_MS + 80, run.signal);
        api.getState().deleteAtomsByIds?.(exitingIds);
        exitingIds.forEach(clearExit);
        await wait(120, run.signal);
      }
    }

    // Enter added atoms in batches through addAtomToSupercell.
    const batch = Math.max(1, Math.ceil(added.length / 10));
    for (let i = 0; i < added.length; i += batch) {
      if (run.signal.aborted) break;
      const s = api.getState();
      added.slice(i, i + batch).forEach((a) =>
        s.addAtomToSupercell?.(a.element, a.position as [number, number, number]),
      );
      opts.onCaption?.(`Adding ${Math.min(i + batch, added.length)}/${added.length} atoms…`);
      await wait(stepMs, run.signal);
    }

    // Commit exact next IDs and bonds, restore history, and return to the overview.
    const sFinal = api.getState();
    sFinal.setAtomsDirectly?.(nextAtomsForCommit);
    sFinal.setBondsDirectly?.(nextBondsForCommit);
    sFinal.clearSelection?.();
    api.setState({ history: historySnapshot, historyIndex: historyIndexSnapshot });
    opts.onCaption?.("Done");
    sFinal.resetCameraToInitial?.();
    await wait(1000, run.signal);
    opts.onCaption?.(null);
  } catch {
    // Fail-safe: never leave the structure rewound to prior — land on the real result.
    try {
      const s = api?.getState();
      s?.setAtomsDirectly?.(nextAtomsForCommit);
      s?.setBondsDirectly?.(nextBondsForCommit);
      api?.setState({ history: historySnapshot, historyIndex: historyIndexSnapshot });
    } catch { /* swallow */ }
    opts.onCaption?.(null);
  } finally {
    endActivity();
    run.release();
  }
}

/**
 * `played` means presentation completed or no visible animation was needed.
 * `skipped` means another replay owned the single-flight slot; callers that
 * depend on presentation completion must wait for idle themselves.
 */
export type AppliedRevealOutcome = 'played' | 'skipped';

export interface AppliedRevealOptions {
  onCaption?: CaptionFn;
  posTol?: number;
  moveTol?: number;
  /** Above this total delta, commit next directly and focus it without per-atom animation. */
  maxDeltaForPerAtom?: number;
  stepMs?: number;
  /**
   * A slot synchronously reserved by the caller. Its existing `running` state
   * belongs to this operation and must not be read as `skipped`. This function's
   * finally block owns release; callers must not release it again.
   */
  claimedSlot?: ChoreographyClaim;
  /**
   * Viewport that received the commit. A delayed reveal must never look up the
   * then-active viewport: the user may switch panes before this async work
   * starts, and presentation work must stay bound to its original target.
   */
  viewportApi?: ReturnType<typeof getActiveViewportStoreApi>;
}

/**
 * Reveal an ALREADY-APPLIED result without ever rewinding authoritative state.
 *
 * The old replay temporarily replaced the live store with `prior`, rebuilt
 * atoms, then forced `next` back. During that window reads observed stale data,
 * a user edit was overwritten at the end, and a delayed replay could even land
 * in a different active viewport. The structure is now immutable throughout
 * presentation: changed atoms get a bounded entrance emphasis and the pinned
 * viewport flies to the changed region. Chat, reads and manual edits remain
 * live while the explanation runs.
 */
export async function performAppliedResultReveal(
  priorAtoms: any[],
  _priorBonds: any[],
  nextAtoms: any[],
  _nextBonds: any[],
  opts: AppliedRevealOptions = {},
): Promise<AppliedRevealOutcome> {
  // Expose `skipped`: another replay is active, so follow-up work such as a
  // review card must wait instead of interrupting that presentation.
  //
  // A claimed slot made `running` true synchronously to close the readback race.
  // Do not mistake that caller-owned state for another replay and reject its owner.
  const run = opts.claimedSlot ?? beginRun();
  if (!run) return 'skipped';
  const endActivity = useAgentActivity.getState().begin({
    label: 'Showing what changed',
    tier: 'mutate',
    interruptible: true,
  });
  const api = opts.viewportApi ?? getActiveViewportStoreApi();
  try {
    if (!api) return 'played';
    const toDiff = (atoms: any[]): DiffAtom[] =>
      atoms.map((a) => ({
        element: a.element,
        position: (a.cartesian ?? a.position ?? [0, 0, 0]) as [number, number, number],
      }));
    const prior = toDiff(priorAtoms);
    const next = toDiff(nextAtoms);
    const diff = diffStructures(prior, next, { posTol: opts.posTol, moveTol: opts.moveTol });
    if (!diff.changedRegion) return 'played';

    const deltaCount = diff.added.length + diff.removed.length + diff.moved.length * 2;
    const maxDelta = opts.maxDeltaForPerAtom ?? 300;

    // Emphasize only atoms whose canonical identity is new or whose final
    // position changed. Focus state belongs to this pinned viewport store;
    // unlike the module-global atom entrance map it cannot bleed into another
    // pane that happens to reuse the same canonical atom IDs.
    const priorById = new Map(priorAtoms.map((atom) => [atom.id, atom]));
    const moveTolerance = opts.moveTol ?? 0.12;
    const emphasized = nextAtoms.filter((atom) => {
      const before = priorById.get(atom.id);
      if (!before || before.element !== atom.element) return true;
      const p = before.cartesian ?? before.position ?? [0, 0, 0];
      const n = atom.cartesian ?? atom.position ?? [0, 0, 0];
      return Math.hypot(n[0] - p[0], n[1] - p[1], n[2] - p[2]) > moveTolerance;
    });
    const emphasizedIds = new Set(emphasized.slice(0, maxDelta).map((atom) => atom.id));
    if (emphasizedIds.size) {
      api.setState({
        focusedAtomIds: emphasizedIds,
        massiveSceneVisualFocusAtomIds: new Set<string>(),
        massiveSceneVisualFocusCenter: null,
        massiveSceneVisualFocusDistance: null,
      });
    }

    api.getState().focusOnPoint?.(diff.changedRegion.center, Math.max(1, diff.changedRegion.radius));
    const parts = [
      diff.added.length ? `${diff.added.length} added` : '',
      diff.removed.length ? `${diff.removed.length} removed` : '',
      diff.moved.length ? `${diff.moved.length} moved` : '',
    ].filter(Boolean);
    opts.onCaption?.(parts.length ? `Showing change · ${parts.join(', ')}` : 'Showing what changed');

    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const revealMs = reducedMotion ? 80 : opts.stepMs ?? (deltaCount > maxDelta ? 260 : 720);
    for (let elapsed = 0; elapsed < revealMs && !run.signal.aborted; elapsed += 40) {
      await wait(40, run.signal);
    }
    if (!run.signal.aborted) {
      opts.onCaption?.('Ready for review');
      await wait(reducedMotion ? 40 : 180, run.signal);
    }
    return 'played';
  } finally {
    opts.onCaption?.(null);
    endActivity();
    run.release();
  }
}
