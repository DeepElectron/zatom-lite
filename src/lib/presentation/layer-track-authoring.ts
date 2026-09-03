export interface AuthorableLayerKeyframe {
  id: string
  frame: number
  easing: 'smooth' | 'linear' | 'hold'
  patch: object
  /** Authoring identity only; rendering continues to use the concrete patch. */
  presetId?: string
}

export interface LayerStyleAuthoringMetadata {
  /** Undefined preserves a same-frame value, a string sets it, and null clears it. */
  presetId?: string | null
}

function sorted<Keyframe extends AuthorableLayerKeyframe>(
  track: readonly Keyframe[],
): Keyframe[] {
  return [...track].sort((left, right) => left.frame - right.frame)
}

export function hasLayerStyleKeys(
  track: readonly AuthorableLayerKeyframe[] | undefined,
): boolean {
  return Boolean(track?.some((keyframe) => Object.keys(keyframe.patch).some((field) => field !== 'visible')))
}

/**
 * A marker only proves that a key exists. A visible transition needs at least
 * two distinct style snapshots or two distinct visibility states.
 */
export function layerTrackIsConstant(
  track: readonly AuthorableLayerKeyframe[] | undefined,
): boolean {
  if (!track?.length) return false
  const styleSnapshots = track
    .filter((keyframe) => Object.keys(keyframe.patch).some((field) => field !== 'visible'))
    .map((keyframe) => {
      const { visible: _ignored, ...style } = keyframe.patch as Record<string, unknown> & { visible?: boolean }
      return JSON.stringify(style)
    })
  const visibilityStates = track.flatMap((keyframe) => {
    const visible = (keyframe.patch as { visible?: boolean }).visible
    return visible === undefined ? [] : [visible]
  })
  return new Set(styleSnapshots).size < 2 && new Set(visibilityStates).size < 2
}

/**
 * Once a style track exists, editing a keyframable control records that field
 * at the current playhead. This preserves the source editor's WYSIWYG auto-key
 * contract instead of allowing the old track value to mask a live UI edit.
 */
export function autoKeyLayerStyle<Keyframe extends AuthorableLayerKeyframe>(
  track: readonly Keyframe[] | undefined,
  frame: number,
  patch: Partial<Keyframe['patch']>,
  makeId: () => string,
  metadata: LayerStyleAuthoringMetadata = {},
): Keyframe[] | undefined {
  if (!hasLayerStyleKeys(track)) return track ? [...track] : undefined
  const roundedFrame = Math.round(frame)
  const current = track!.find((keyframe) => keyframe.frame === roundedFrame)
  if (Object.keys(patch).length === 0 && (metadata.presetId === undefined || !current)) {
    return [...track!]
  }
  const next = current
    ? track!.map((keyframe) => keyframe.frame === roundedFrame
      ? withPresetMetadata(
          { ...keyframe, patch: { ...keyframe.patch, ...patch } } as Keyframe,
          metadata,
        )
      : keyframe)
    : [...track!, withPresetMetadata({
        id: makeId(), frame: roundedFrame, easing: 'smooth', patch: { ...patch },
      } as Keyframe, metadata)]
  return sorted(next)
}

/** Record a complete style snapshot without writing the independent visibility channel. */
export function recordLayerStyle<Keyframe extends AuthorableLayerKeyframe>(
  track: readonly Keyframe[] | undefined,
  frame: number,
  patch: Keyframe['patch'],
  makeId: () => string,
  metadata: LayerStyleAuthoringMetadata = {},
): Keyframe[] {
  const roundedFrame = Math.round(frame)
  const prior = track?.find((keyframe) => keyframe.frame === roundedFrame)
  const priorVisibility = (prior?.patch as { visible?: boolean } | undefined)?.visible
  const { visible: _ignored, ...style } = patch as Keyframe['patch'] & { visible?: boolean }
  const merged = {
    ...style,
    ...(priorVisibility === undefined ? {} : { visible: priorVisibility }),
  } as Keyframe['patch']
  const recorded = withPresetMetadata({
    id: makeId(),
    frame: roundedFrame,
    easing: 'smooth',
    patch: merged,
    ...(prior?.presetId === undefined ? {} : { presetId: prior.presetId }),
  } as Keyframe, metadata)
  return sorted([
    ...(track ?? []).filter((keyframe) => keyframe.frame !== roundedFrame),
    recorded,
  ])
}

function withPresetMetadata<Keyframe extends AuthorableLayerKeyframe>(
  keyframe: Keyframe,
  metadata: LayerStyleAuthoringMetadata,
): Keyframe {
  if (metadata.presetId === undefined) return keyframe
  const next = { ...keyframe }
  if (metadata.presetId === null) delete next.presetId
  else next.presetId = metadata.presetId
  return next
}

/** Visibility is a hold/step channel and merges with a same-frame style key. */
export function recordLayerVisibility<Keyframe extends AuthorableLayerKeyframe>(
  track: readonly Keyframe[] | undefined,
  frame: number,
  visible: boolean,
  makeId: () => string,
): Keyframe[] {
  const roundedFrame = Math.round(frame)
  const current = track?.find((keyframe) => keyframe.frame === roundedFrame)
  if (current) return sorted((track ?? []).map((keyframe) => keyframe.frame === roundedFrame
      ? { ...keyframe, patch: { ...keyframe.patch, visible } } as Keyframe
    : keyframe))
  return sorted([...(track ?? []), {
    id: makeId(), frame: roundedFrame, easing: 'hold', patch: { visible },
  } as Keyframe])
}
