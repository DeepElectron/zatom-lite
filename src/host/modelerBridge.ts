/** Browser-local structure loading and snapshot bridge. */
import { create } from 'zustand'

interface PendingFile {
  name: string
  content: string
  format: 'cif' | 'xyz'
}

/** Multi-structure comparison with one entry per viewport. */
export interface PendingMultiFile {
  name: string
  content: string
  format: 'cif' | 'xyz'
}

type MultiLayout = '1x1' | '1x2' | '2x2' | '2x3' | '2x4' | '3x4' | '4x4'

interface ModelerBridgeState {
  pendingFile: PendingFile | null
  switchToModeler: (() => void) | null

  setSwitchToModeler: (fn: () => void) => void
  loadFileInModeler: (name: string, content: string, format: 'cif' | 'xyz') => void
  consumePendingFile: () => PendingFile | null

  /** Callback registered by the modeler to read its current structure snapshot. */
  getStructureSnapshot: (() => ModelerStructureSnapshot | null) | null
  setGetStructureSnapshot: (fn: () => ModelerStructureSnapshot | null) => void

  /** Switch grid layout and distribute structures across viewports. */
  pendingMultiFiles: PendingMultiFile[] | null
  pendingMultiLayout: MultiLayout | null
  loadMultipleInModeler: (files: PendingMultiFile[]) => void
  consumePendingMulti: () => { files: PendingMultiFile[]; layout: MultiLayout } | null
}

/** Modeler structure snapshot. */
export interface ModelerStructureSnapshot {
  atoms: Array<{ element: number; position: [number, number, number] }>
  latticeMatrix?: number[][] | null
  label?: string
}

export const useModelerBridge = create<ModelerBridgeState>((set, get) => ({
  pendingFile: null,
  switchToModeler: null,
  getStructureSnapshot: null,

  setGetStructureSnapshot: (fn) => set({ getStructureSnapshot: fn }),
  setSwitchToModeler: (fn) => set({ switchToModeler: fn }),

  loadFileInModeler: (name, content, format) => {
    set({ pendingFile: { name, content, format } })
    get().switchToModeler?.()
  },

  consumePendingFile: () => {
    const { pendingFile } = get()
    if (pendingFile) set({ pendingFile: null })
    return pendingFile
  },

  pendingMultiFiles: null,
  pendingMultiLayout: null,

  loadMultipleInModeler: (files) => {
    if (!files || files.length === 0) return
    // Choose the smallest grid that accommodates every structure.
    const layout: MultiLayout =
      files.length <= 1 ? '1x1'
      : files.length === 2 ? '1x2'
      : files.length <= 4 ? '2x2'
      : files.length <= 6 ? '2x3'
      : files.length <= 8 ? '2x4'
      : files.length <= 12 ? '3x4'
      : '4x4'
    set({ pendingMultiFiles: files, pendingMultiLayout: layout })
    get().switchToModeler?.()
  },

  consumePendingMulti: () => {
    const { pendingMultiFiles, pendingMultiLayout } = get()
    if (!pendingMultiFiles || !pendingMultiLayout) return null
    set({ pendingMultiFiles: null, pendingMultiLayout: null })
    return { files: pendingMultiFiles, layout: pendingMultiLayout }
  },
}))
