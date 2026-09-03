export interface LayerTrackMark {
  frame: number
  style: number
  show: number
  hide: number
  layerNames: string[]
}

interface LayerTrackPatchLike {
  visible?: boolean
  [key: string]: unknown
}

interface LayerTrackLike {
  name: string
  styleTrack?: readonly {
    id?: string
    frame: number
    easing?: string
    patch: object
  }[]
}

/**
 * Aggregate bio and crystal semantic-layer tracks into one timeline. A key can
 * carry style and visibility together, so channel counters stay independent.
 */
export function aggregateLayerStyleTrackMarks(
  layers: readonly LayerTrackLike[],
): LayerTrackMark[] {
  const byFrame = new Map<number, LayerTrackMark>()
  for (const layer of layers) {
    for (const keyframe of layer.styleTrack ?? []) {
      const patch = keyframe.patch as LayerTrackPatchLike
      const mark = byFrame.get(keyframe.frame) ?? {
        frame: keyframe.frame,
        style: 0,
        show: 0,
        hide: 0,
        layerNames: [],
      }
      if (Object.keys(patch).some((key) => key !== 'visible')) mark.style += 1
      if (patch.visible === true) mark.show += 1
      if (patch.visible === false) mark.hide += 1
      if (!mark.layerNames.includes(layer.name)) mark.layerNames.push(layer.name)
      byFrame.set(keyframe.frame, mark)
    }
  }
  return [...byFrame.values()].sort((left, right) => left.frame - right.frame)
}
