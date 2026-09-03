/**
 * Viewport capture callback registry for the visual modeling loop.
 *
 * The WebGL renderer and gl.domElement are reachable only inside the R3F tree.
 * Each Canvas registers its capture closure under its viewport store identity and
 * removes only its own entry on unmount. viewer_capture passes the active store
 * identity from outside R3F to select the exact canvas, keeping image and textual
 * summary sourced from the same viewport. During initial mounting, capture may
 * briefly wait for that same store to register but never falls back to another canvas.
 *
 * Store-keyed entries prevent the last-mounted viewport from replacing the active
 * one and prevent one canvas from unregistering another canvas's capture callback.
 */

export interface ViewportCaptureOptions {
  /** Maximum long edge in pixels; defaults to 768 to limit WS frames and model tokens. */
  maxDim?: number;
  /** 'jpeg' by default (~100–300 KB, white background), or larger lossless 'png' with alpha. */
  format?: 'jpeg' | 'png';
  /**
   * Background fill. Omission preserves format defaults: transparent PNG and white JPEG.
   * An explicit CSS color can give PNG a publication-safe opaque background.
   * JPEG cannot encode alpha, so 'transparent' falls back to white.
   */
  background?: 'transparent' | string;
}

/**
 * Upper bound for user-facing lossless captures; agent callers request less.
 *
 * 8192 supports a 183 mm double-column figure at 600 DPI (4323 px). This is only
 * the request ceiling; resolveViewportCapturePixelRatio still caps resolution to
 * GPU framebuffer limits so weaker hardware does not allocate an invalid buffer.
 */
export const VIEWPORT_CAPTURE_MAX_DIMENSION = 8192;

export function clampViewportCaptureMaxDimension(value?: number): number {
  return Math.max(
    64,
    Math.min(VIEWPORT_CAPTURE_MAX_DIMENSION, Math.round(value ?? 768)),
  );
}

/**
 * A rendered frame is empty only when every probe pixel is exactly identical.
 * Alpha is part of the comparison so transparent captures still detect atoms.
 */
export function isUniformViewportCapturePixels(pixels: Uint8ClampedArray): boolean {
  if (pixels.length < 8) return true;
  const r = pixels[0];
  const g = pixels[1];
  const b = pixels[2];
  const a = pixels[3];
  for (let offset = 4; offset + 3 < pixels.length; offset += 4) {
    if (
      pixels[offset] !== r
      || pixels[offset + 1] !== g
      || pixels[offset + 2] !== b
      || pixels[offset + 3] !== a
    ) return false;
  }
  return true;
}

export interface ViewportCapturePixelRatioInput {
  logicalWidth: number;
  logicalHeight: number;
  currentPixelRatio: number;
  maxDim: number;
  maxFramebufferWidth: number;
  maxFramebufferHeight: number;
}

/**
 * Preserve the live renderer's resolution for small/agent captures, but allow
 * a user export to render real additional pixels up to the requested and GPU
 * framebuffer limits. This is not post-capture bitmap upscaling.
 */
export function resolveViewportCapturePixelRatio(input: ViewportCapturePixelRatioInput): number {
  const width = Math.max(1, input.logicalWidth);
  const height = Math.max(1, input.logicalHeight);
  const current = Number.isFinite(input.currentPixelRatio) && input.currentPixelRatio > 0
    ? input.currentPixelRatio
    : 1;
  const requested = Math.max(1, input.maxDim) / Math.max(width, height);
  const supported = Math.min(
    Math.max(1, input.maxFramebufferWidth) / width,
    Math.max(1, input.maxFramebufferHeight) / height,
  );
  return Math.max(1e-6, Math.min(Math.max(current, requested), supported));
}

export interface ViewportCaptureResult {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

type CaptureFn = (opts?: ViewportCaptureOptions) => Promise<ViewportCaptureResult | null>;

export interface ViewportPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  /** Camera world-up. Optional because recorded poses predate it; readers default to +Y. */
  up?: [number, number, number];
  /** Present for an orthographic camera so a recorded live pose is lossless. */
  zoom?: number;
}

export interface ViewportTargetPlacement {
  centerNdc: [number, number, number];
  centerPx: [number, number];
  viewportSizePx: [number, number];
  projectedRadiusPx: number;
  centerVisible: boolean;
  regionVisible: boolean;
}

export interface ViewportTargetGeometry {
  center: [number, number, number];
  radius: number;
}

export interface ViewportLogicalSize {
  width: number;
  height: number;
}

/**
 * Movie session that yields each newly rendered current frame.
 *
 * Uses inversion of control instead of begin/end because the renderer pixelRatio
 * changes temporarily for export. The registrar wraps run in try/finally so errors
 * and cancellation always restore the interactive canvas resolution.
 */
export type ViewportFrameSequenceOptions = {
  /** Maximum long edge; the session temporarily raises render resolution to match. */
  maxDim?: number;
  /** Transparent movie background; WebM VP9/VP8 supports alpha, while MP4 should pass false. */
  transparent?: boolean;
};

/** Renders and returns the completed frame, or null when no frame was produced. */
export type ViewportFrameDrawer = () => Promise<CanvasImageSource | null>;

interface CaptureEntry {
  capture: CaptureFn;
  /** Continuous movie session that returns run's result. */
  renderFrameSequence?: <T>(
    opts: ViewportFrameSequenceOptions,
    run: (drawFrame: ViewportFrameDrawer) => Promise<T>,
  ) => Promise<T>;
  /** Current camera pose; registrars should prefer the actual controls target. */
  getPose?: () => ViewportPose | null;
  /** Project one world-space inspection target through the exact capture camera. */
  measureTarget?: (target: ViewportTargetGeometry) => ViewportTargetPlacement | null;
  /** Logical CSS canvas size used to preserve aspect ratio during export. */
  getViewportSize?: () => ViewportLogicalSize | null;
}

/** Keyed by viewport store API identity from useViewportStoreApi(). */
const entries = new Map<unknown, CaptureEntry>();
const registrationWaiters = new Map<unknown, Set<(entry: CaptureEntry) => void>>();

export function registerViewportCapture(key: unknown, entry: CaptureEntry): () => void {
  entries.set(key, entry);
  const waiters = registrationWaiters.get(key);
  if (waiters) {
    registrationWaiters.delete(key);
    for (const resolve of waiters) resolve(entry);
  }
  return () => {
    // Remove only this entry; stale cleanup must not remove a newer registrar for the same key.
    if (entries.get(key) === entry) entries.delete(key);
  };
}

function resolveEntry(preferredKey?: unknown): CaptureEntry | undefined {
  if (preferredKey != null) return entries.get(preferredKey);
  if (entries.size !== 1) return undefined;
  return entries.values().next().value;
}

function waitForExactEntry(key: unknown): Promise<CaptureEntry | undefined> {
  const existing = entries.get(key);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let waiters = registrationWaiters.get(key);
    if (!waiters) {
      waiters = new Set();
      registrationWaiters.set(key, waiters);
    }
    let timer: ReturnType<typeof setTimeout>;
    const finish = (entry: CaptureEntry) => {
      clearTimeout(timer);
      resolve(entry);
    };
    waiters.add(finish);
    timer = setTimeout(() => {
      const current = registrationWaiters.get(key);
      current?.delete(finish);
      if (current?.size === 0) registrationWaiters.delete(key);
      resolve(undefined);
    }, 5_000);
  });
}

/** Fail fast for a UI action that can only run while its Canvas is mounted. */
export function hasRegisteredViewportCapture(preferredKey: unknown): boolean {
  return entries.has(preferredKey);
}

/**
 * preferredKey is the active viewport store API and restricts capture to that canvas.
 * Initial Canvas creation waits for the same key and returns null on timeout. Omitting
 * the key is valid only with exactly one registered canvas to avoid cross-viewport evidence.
 */
export async function captureViewport(
  opts?: ViewportCaptureOptions,
  preferredKey?: unknown,
): Promise<ViewportCaptureResult | null> {
  const entry = resolveEntry(preferredKey)
    ?? (preferredKey != null ? await waitForExactEntry(preferredKey) : undefined);
  return entry ? entry.capture(opts) : null;
}

/** Current camera pose, snapshotted before a plate and restored afterward. */
export function getViewportPose(preferredKey?: unknown): ViewportPose | null {
  const entry = resolveEntry(preferredKey);
  return entry?.getPose ? entry.getPose() : null;
}

/** Reads logical canvas size to convert physical width into long-edge pixels. */
export function getViewportLogicalSize(preferredKey?: unknown): ViewportLogicalSize | null {
  const entry = resolveEntry(preferredKey);
  return entry?.getViewportSize?.() ?? null;
}

/**
 * Opens a movie session on the active canvas. Returns null when it is not mounted;
 * user-initiated video export should not wait five seconds like agent capture.
 */
export async function runViewportFrameSequence<T>(
  opts: ViewportFrameSequenceOptions,
  run: (drawFrame: ViewportFrameDrawer) => Promise<T>,
  preferredKey?: unknown,
): Promise<T | null> {
  const entry = resolveEntry(preferredKey);
  if (!entry?.renderFrameSequence) return null;
  return entry.renderFrameSequence(opts, run);
}

/** Screen-space proof from the same registered viewport/camera used for capture. */
export async function measureViewportTarget(
  target: ViewportTargetGeometry,
  preferredKey?: unknown,
): Promise<ViewportTargetPlacement | null> {
  const entry = resolveEntry(preferredKey);
  return entry?.measureTarget?.(target) ?? null;
}
