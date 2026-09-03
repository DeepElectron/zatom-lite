/**
 * choreographyNarrationStore is the global channel for choreography captions.
 *
 * modelingChoreographer broadcasts its onCaption callback here, and the viewport's
 * ChoreographyCaption subscribes to it. This stays outside the viewport store
 * because only one choreography runs globally and frequent caption updates should
 * not rerender structure subscribers. A null caption hides the bar.
 */

import { create } from 'zustand'

interface ChoreographyNarrationState {
  caption: string | null
  setCaption: (caption: string | null) => void
}

export const useChoreographyNarration = create<ChoreographyNarrationState>((set) => ({
  caption: null,
  setCaption: (caption) => set({ caption }),
}))
