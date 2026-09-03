/**
 * Mutable side-channel from the trajectory playback loop (CompactAtoms) to other
 * scene components (RegionSolids). Owned by the compact branch of crystal-scene,
 * passed to both as a ref — fields are mutated per frame, never replaced, so no
 * React re-renders are involved.
 */
export interface PlaybackChannel {
  /** frame i positions (the playback front buffer), null when no trajectory */
  front: Float32Array | null
  /** frame i+1 positions */
  back: Float32Array | null
  /** lerp factor between front and back */
  mix: number
  /** bumped on every playback tick — cheap change detection for readers */
  version: number
}

export function createPlaybackChannel(): PlaybackChannel {
  return { front: null, back: null, mix: 0, version: 0 }
}
