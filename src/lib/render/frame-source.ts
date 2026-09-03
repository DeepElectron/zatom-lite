import type { CompactStructure } from './compact-structure'

/**
 * A trajectory frame producer. Frames are written on demand into a caller-provided
 * buffer — never stored — so frameCount can be arbitrarily large (zero-storage for
 * procedural sources; a future StreamingFrameSource adds an async sliding-window
 * prefetch for real computed trajectories).
 */
export interface FrameSource {
  readonly frameCount: number
  readonly atomCount: number
  /** Write frame i's positions (xyz triplets, length 3*atomCount) into `out`. */
  getFrame(i: number, out: Float32Array): void
}

/**
 * Availability-aware trajectory source — the contract the playback loop actually
 * consumes. Streaming sources (file / HTTP range) decode frames asynchronously into
 * a sliding window; `tryGetFrame` is a synchronous best-effort read from that window
 * (miss → caller holds the playhead and calls `prefetch`). Synchronous sources adapt
 * via `asAsyncFrameSource` (always hits).
 */
export interface AsyncFrameSource {
  readonly frameCount: number
  readonly atomCount: number
  /** Write frame i into `out` if available now. false = not decoded yet. */
  tryGetFrame(i: number, out: Float32Array): boolean
  /** Ensure frame i (and some lookahead) is being decoded. */
  prefetch(i: number): Promise<void>
  dispose?(): void
}

/**
 * Per-frame *species* producer — the appearance analogue of AsyncFrameSource.
 * Positions stay static; this yields per-atom element index (0..255) per frame,
 * decoded from a sliding window so frameCount can be huge with bounded RAM.
 */
export interface AsyncSpeciesSource {
  readonly frameCount: number
  readonly atomCount: number
  /** Write frame i's per-atom element index (length atomCount) into `out` if decoded
  *  now. false = not ready (caller holds the playhead and calls prefetch). */
  tryGetSpecies(i: number, out: Uint8Array): boolean
  prefetch(i: number): Promise<void>
  dispose?(): void
}

/** Adapt a synchronous (procedural) source to the async playback contract. */
export function asAsyncFrameSource(src: FrameSource): AsyncFrameSource {
  return {
    frameCount: src.frameCount,
    atomCount: src.atomCount,
    tryGetFrame(i, out) { src.getFrame(i, out); return true },
    prefetch: () => Promise.resolve(),
  }
}

/** Loop the playhead over [0, frameCount). frameCount<=1 pins to 0. */
export function wrapPlayhead(playhead: number, frameCount: number): number {
  if (frameCount <= 1) return 0
  let p = playhead % frameCount
  if (p < 0) p += frameCount
  return p
}

// Shared sine lookup table — thermal jitter does millions of evaluations per frame; a LUT
// keeps it cheap. Indexed by phase wrapped into [0, 2π); callers keep arguments ≥ 0.
const SIN_LUT_N = 1 << 12 // 4096
const SIN_LUT = (() => {
  const t = new Float32Array(SIN_LUT_N)
  for (let i = 0; i < SIN_LUT_N; i++) t[i] = Math.sin((i / SIN_LUT_N) * Math.PI * 2)
  return t
})()
const SIN_LUT_SCALE = SIN_LUT_N / (Math.PI * 2)

/** Integer → [0,1) hash (murmur3 finalizer): strong avalanche so adjacent atoms decorrelate. */
function hash01(n: number): number {
  let x = n >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4294967296
}

/**
 * Procedural per-atom thermal jitter that reads as random MD motion: every atom-axis is a
 * sum of MODES sinusoids with its OWN hashed frequencies AND phases — so atoms are mutually
 * decorrelated and there is no global oscillation period (the giveaway of a single shared
 * frequency). Pure function of (atom, frame): reproducible, zero storage, any frame count.
 * Used to give a static species trajectory an MD wobble while only the colour steps per frame.
 */
export function createThermalJitterSource(
  base: Float32Array,
  opts: { frameCount: number; amplitude: number },
): FrameSource {
  const atomCount = base.length / 3
  const A = opts.amplitude
  const MODES = 3
  const FREQ_MIN = 0.20, FREQ_MAX = 0.85 // rad/frame → per-atom periods ~7.4–31 frames
  const scale = A / Math.sqrt(MODES)     // keep RMS ≈ A regardless of mode count
  // Precompute per-(atom,axis,mode) frequency + phase once — the per-frame loop is hot.
  const N = atomCount * 3 * MODES
  const freqs = new Float32Array(N)
  const phases = new Float32Array(N)
  for (let j = 0; j < N; j++) {
    freqs[j] = FREQ_MIN + hash01(j * 2 + 1) * (FREQ_MAX - FREQ_MIN)
    phases[j] = hash01(j * 2 + 2) * (Math.PI * 2)
  }
  const MASK = SIN_LUT_N - 1
  return {
    frameCount: opts.frameCount,
    atomCount,
    getFrame(i, out) {
      const t = i
      for (let k = 0; k < atomCount; k++) {
        const b = k * 3 * MODES
        let ox = 0, oy = 0, oz = 0
        for (let m = 0; m < MODES; m++) {
          const jx = b + m, jy = b + MODES + m, jz = b + 2 * MODES + m
          ox += SIN_LUT[((freqs[jx] * t + phases[jx]) * SIN_LUT_SCALE) & MASK]
          oy += SIN_LUT[((freqs[jy] * t + phases[jy]) * SIN_LUT_SCALE) & MASK]
          oz += SIN_LUT[((freqs[jz] * t + phases[jz]) * SIN_LUT_SCALE) & MASK]
        }
        out[k * 3] = base[k * 3] + scale * ox
        out[k * 3 + 1] = base[k * 3 + 1] + scale * oy
        out[k * 3 + 2] = base[k * 3 + 2] + scale * oz
      }
    },
  }
}

export interface SyntheticVibrationOpts {
  frameCount: number
  /** Wave amplitude in Å (dominant, along y). */
  amplitude: number
  /** Traveling-wave wavelength in Å; defaults to a third of the box width. */
  wavelength?: number
  /** Per-atom thermal jitter as a fraction of amplitude (default 0.5). */
  jitterRatio?: number
}

/**
 * Procedural "thermal vibration" trajectory: a traveling wave along x displacing y,
 * plus deterministic per-atom jitter (hashed phases) on all axes. Pure function of
 * (atom, frame) — reproducible, zero storage, any frame count.
 */
export function createSyntheticVibrationSource(
  base: Float32Array,
  bbox: CompactStructure['bbox'],
  opts: SyntheticVibrationOpts,
): FrameSource {
  const atomCount = base.length / 3
  const A = opts.amplitude
  const lambda = opts.wavelength ?? Math.max(1, (bbox.max[0] - bbox.min[0]) / 3)
  const jitter = (opts.jitterRatio ?? 0.5) * A
  const TWO_PI = Math.PI * 2
  return {
    frameCount: opts.frameCount,
    atomCount,
    getFrame(i, out) {
      const t = i * 0.12 // phase step per frame
      for (let k = 0; k < atomCount; k++) {
        const x = base[k * 3], y = base[k * 3 + 1], z = base[k * 3 + 2]
        const wave = Math.sin(TWO_PI * (x / lambda) - t)
        // cheap stable per-atom hash → two phase offsets
        const h = (k * 2654435761) >>> 0
        const p1 = ((h & 0xffff) / 65536) * TWO_PI
        const p2 = (((h >>> 16) & 0xffff) / 65536) * TWO_PI
        out[k * 3] = x + jitter * Math.sin(1.7 * t + p1)
        out[k * 3 + 1] = y + A * wave + jitter * Math.sin(2.3 * t + p2)
        out[k * 3 + 2] = z + jitter * Math.sin(1.3 * t + p1 + p2)
      }
    },
  }
}
