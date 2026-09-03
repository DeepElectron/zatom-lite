export const MAX_ADAPTIVE_PERFORMANCE_LEVEL = 3
export const WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD = 18000
export const WIDE_VIEWPORT_VERY_LARGE_SCENE_ATOM_THRESHOLD = 32000
export const HIGH_END_WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD = 24000
export const HIGH_END_WIDE_VIEWPORT_VERY_LARGE_SCENE_ATOM_THRESHOLD = 42000
export const MOBILE_MASSIVE_SCENE_ATOM_THRESHOLD = 7000
export const MOBILE_VERY_LARGE_SCENE_ATOM_THRESHOLD = 12000


const FAST_THRESHOLD_SCALES = [1, 0.82, 0.62, 0.45] as const
const SOLID_BOX_THRESHOLD_SCALES = [1, 0.9, 0.7, 0.55] as const
const MOBILE_DPR_TARGETS = [1.5, 1.2, 1.0, 0.85] as const
const WIDE_VIEWPORT_DPR_TARGETS = [2, 1.85, 1.6, 1.35] as const
const DETAIL_BOND_SEGMENTS = [16, 14, 10, 8] as const
const DASHED_BOND_SEGMENT_COUNTS = [3, 3, 2, 2] as const
const INSTANCED_BOND_SEGMENTS = [6, 5, 4, 4] as const
const INSTANCED_ATOM_SEGMENTS = [12, 10, 8, 6] as const

export interface AdaptiveBondQualityProfile {
  detailRadialSegments: number
  dashedSegmentCount: number
  instancedRadialSegments: number
}

export interface AdaptiveAtomQualityProfile {
  instancedRadialSegments: number
}

export interface LargeSceneThresholdOptions {
  mobileLike?: boolean
  /** User-customized thresholds override defaults */
  customMassiveThreshold?: number
  customVeryLargeThreshold?: number
}

export interface LargeSceneHiResNeighborTargets {
  massiveSceneHiResNeighborCount: number
  veryLargeSceneHiResNeighborCount: number
}

export function clampAdaptivePerformanceLevel(level: number) {
  return Math.max(0, Math.min(MAX_ADAPTIVE_PERFORMANCE_LEVEL, Math.round(level)))
}

export function getAdaptiveThresholds({
  lodThreshold,
  ultraLowThreshold,
  adaptiveEnabled,
  adaptiveLevel,
}: {
  lodThreshold: number
  ultraLowThreshold: number
  adaptiveEnabled: boolean
  adaptiveLevel: number
}) {
  if (!adaptiveEnabled) {
    return {
      effectiveLodThreshold: lodThreshold,
      effectiveUltraLowThreshold: ultraLowThreshold,
    }
  }

  const clampedLevel = clampAdaptivePerformanceLevel(adaptiveLevel)
  const effectiveLodThreshold = Math.max(
    100,
    Math.round(lodThreshold * FAST_THRESHOLD_SCALES[clampedLevel]),
  )
  const effectiveUltraLowThreshold = Math.max(
    effectiveLodThreshold + 500,
    Math.round(ultraLowThreshold * SOLID_BOX_THRESHOLD_SCALES[clampedLevel]),
  )

  return {
    effectiveLodThreshold,
    effectiveUltraLowThreshold,
  }
}

export function getAdaptiveTargetDpr(
  deviceDpr: number,
  adaptiveLevel: number,
  options: LargeSceneThresholdOptions = {},
) {
  const clampedLevel = clampAdaptivePerformanceLevel(adaptiveLevel)
  const targets = options.mobileLike ? MOBILE_DPR_TARGETS : WIDE_VIEWPORT_DPR_TARGETS
  return Math.max(0.85, Math.min(deviceDpr, targets[clampedLevel]))
}

export function getTransientAdaptivePerformanceLevel(
  adaptiveLevel: number,
  interactionActive: boolean,
) {
  return clampAdaptivePerformanceLevel(adaptiveLevel + (interactionActive ? 1 : 0))
}

export function getAdaptivePerformanceLabel(adaptiveLevel: number) {
  switch (clampAdaptivePerformanceLevel(adaptiveLevel)) {
    case 1:
      return 'Boost'
    case 2:
      return 'Aggressive'
    case 3:
      return 'Emergency'
    default:
      return 'Balanced'
  }
}

export function getAdaptiveBondQualityProfile({
  adaptiveEnabled,
  adaptiveLevel,
  bondCount,
}: {
  adaptiveEnabled: boolean
  adaptiveLevel: number
  bondCount: number
}): AdaptiveBondQualityProfile {
  if (!adaptiveEnabled) {
    return {
      detailRadialSegments: DETAIL_BOND_SEGMENTS[0],
      dashedSegmentCount: DASHED_BOND_SEGMENT_COUNTS[0],
      instancedRadialSegments: INSTANCED_BOND_SEGMENTS[0],
    }
  }

  let effectiveLevel = clampAdaptivePerformanceLevel(adaptiveLevel)
  if (bondCount >= 5000) {
    effectiveLevel = Math.max(effectiveLevel, 3)
  } else if (bondCount >= 2500) {
    effectiveLevel = Math.max(effectiveLevel, 2)
  } else if (bondCount >= 1200) {
    effectiveLevel = Math.max(effectiveLevel, 1)
  }

  return {
    detailRadialSegments: DETAIL_BOND_SEGMENTS[effectiveLevel],
    dashedSegmentCount: DASHED_BOND_SEGMENT_COUNTS[effectiveLevel],
    instancedRadialSegments: INSTANCED_BOND_SEGMENTS[effectiveLevel],
  }
}

export function getAdaptiveAtomQualityProfile({
  adaptiveEnabled,
  adaptiveLevel,
  atomCount,
}: {
  adaptiveEnabled: boolean
  adaptiveLevel: number
  atomCount: number
}): AdaptiveAtomQualityProfile {
  if (!adaptiveEnabled) {
    return {
      instancedRadialSegments: INSTANCED_ATOM_SEGMENTS[0],
    }
  }

  let effectiveLevel = clampAdaptivePerformanceLevel(adaptiveLevel)
  if (atomCount >= 8000) {
    effectiveLevel = Math.max(effectiveLevel, 3)
  } else if (atomCount >= 3500) {
    effectiveLevel = Math.max(effectiveLevel, 2)
  } else if (atomCount >= 1500) {
    effectiveLevel = Math.max(effectiveLevel, 1)
  }

  return {
    instancedRadialSegments: INSTANCED_ATOM_SEGMENTS[effectiveLevel],
  }
}

export function isMobileLikeRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.innerWidth < 768
}

export function isHighEndWideViewportRuntime() {
  if (typeof navigator === 'undefined' || isMobileLikeRuntime()) {
    return false
  }

  const hardwareThreads = navigator.hardwareConcurrency ?? 0
  const deviceMemory = 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0) : 0

  return hardwareThreads >= 12 || deviceMemory >= 16
}

export function getLargeSceneThresholds(options: LargeSceneThresholdOptions = {}) {
  const mobileLike = options.mobileLike ?? false

  // If the user has customized the threshold, it will be used first
  if (options.customMassiveThreshold != null && options.customVeryLargeThreshold != null) {
    return {
      massiveSceneAtomThreshold: options.customMassiveThreshold,
      veryLargeSceneAtomThreshold: Math.max(options.customVeryLargeThreshold, options.customMassiveThreshold + 1000),
    }
  }

  if (mobileLike) {
    return {
      massiveSceneAtomThreshold: MOBILE_MASSIVE_SCENE_ATOM_THRESHOLD,
      veryLargeSceneAtomThreshold: MOBILE_VERY_LARGE_SCENE_ATOM_THRESHOLD,
    }
  }

  if (isHighEndWideViewportRuntime()) {
    return {
      massiveSceneAtomThreshold: HIGH_END_WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD,
      veryLargeSceneAtomThreshold: HIGH_END_WIDE_VIEWPORT_VERY_LARGE_SCENE_ATOM_THRESHOLD,
    }
  }

  return {
    massiveSceneAtomThreshold: WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD,
    veryLargeSceneAtomThreshold: WIDE_VIEWPORT_VERY_LARGE_SCENE_ATOM_THRESHOLD,
  }
}

export function getLargeSceneHiResNeighborTargets(options: LargeSceneThresholdOptions = {}): LargeSceneHiResNeighborTargets {
  const mobileLike = options.mobileLike ?? false

  if (mobileLike) {
    return {
      massiveSceneHiResNeighborCount: 100,
      veryLargeSceneHiResNeighborCount: 60,
    }
  }

  if (isHighEndWideViewportRuntime()) {
    return {
      massiveSceneHiResNeighborCount: 220,
      veryLargeSceneHiResNeighborCount: 140,
    }
  }

  return {
    massiveSceneHiResNeighborCount: 180,
    veryLargeSceneHiResNeighborCount: 110,
  }
}

export function isMassiveScene(atomCount: number, options: LargeSceneThresholdOptions = {}) {
  return atomCount >= getLargeSceneThresholds(options).massiveSceneAtomThreshold
}

export function isVeryLargeScene(atomCount: number, options: LargeSceneThresholdOptions = {}) {
  return atomCount >= getLargeSceneThresholds(options).veryLargeSceneAtomThreshold
}

export function shouldDisableGeometrySelection(
  atomCount: number,
  options: LargeSceneThresholdOptions = {},
) {
  return isMassiveScene(atomCount, options)
}
