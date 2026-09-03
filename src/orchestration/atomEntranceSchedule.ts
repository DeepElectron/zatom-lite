// Atom entrance timestamps: the renderer computes progress and choreography can stagger births.
// Uses performance.now() milliseconds. birth=0 means "not yet visible."
const births = new Map<string, number>();

/** Presets an atom's birth time for staggered choreography. */
export function scheduleEntrance(id: string, atMs: number): void {
  births.set(id, atMs);
}
/** Gets a birth time, registering now if absent so first appearance starts immediately. */
export function ensureBirth(id: string, nowMs: number): number {
  const b = births.get(id);
  if (b != null) return b;
  births.set(id, nowMs);
  return nowMs;
}
export function forgetEntrance(id: string): void {
  births.delete(id);
}
/** Entrance duration in milliseconds. */
export const ENTRANCE_MS = 350;
/** easeOutBack with a slight overshoot near the end. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
/** Returns entrance progress in [0, 1] for scale and opacity. */
export function entranceProgress(id: string, nowMs: number): number {
  const birth = ensureBirth(id, nowMs);
  if (nowMs <= birth) return 0;
  const t = (nowMs - birth) / ENTRANCE_MS;
  return t >= 1 ? 1 : t;
}

// ── Scale-out scheduling: choreography marks exits and the renderer computes progress ──
const exits = new Map<string, number>(); // id -> exit start time in ms
export const EXIT_MS = 300;
export function scheduleExit(id: string, atMs: number): void { exits.set(id, atMs); }
export function isExiting(id: string): boolean { return exits.has(id); }
export function clearExit(id: string): void { exits.delete(id); }
/** Returns exit progress in [0, 1], where 1 is fully gone; returns 0 if not exiting. */
export function exitProgress(id: string, nowMs: number): number {
  const t0 = exits.get(id);
  if (t0 == null) return 0;
  const t = (nowMs - t0) / EXIT_MS;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}
