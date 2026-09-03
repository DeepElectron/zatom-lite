/**
 * mode-slice -- Top-level builder mode (structure/assembly), periodicity, and
 * multi-scene management (CRUD plus enter/exit).
 *
 * A scene groups an independent sceneObjects collection in assembly mode. enterScene loads
 * the target collection into sceneObjects; exitScene writes the current collection back.
 *
 * deleteScene, enterScene, and exitScene write assembly-slice fields across slices.
 */

import type { StateCreator } from 'zustand'
import type { AssemblyScene, BuilderMode, CrystalStore } from '../crystal-store-types'

export interface ModeSlice {
  builderMode: BuilderMode
  setBuilderMode: (mode: BuilderMode) => void
  periodic: boolean
  setPeriodic: (periodic: boolean) => void
  assemblyScenes: AssemblyScene[]
  activeSceneId: string | null
  createScene: (name: string) => void
  deleteScene: (sceneId: string) => void
  renameScene: (sceneId: string, name: string) => void
  enterScene: (sceneId: string) => void
  exitScene: () => void
}

export const createModeSlice: StateCreator<CrystalStore, [], [], ModeSlice> = (set, get) => ({
  builderMode: 'structure',
  setBuilderMode: (mode) => set({ builderMode: mode }),
  periodic: true,
  setPeriodic: (periodic) => set({ periodic }),
  assemblyScenes: [],
  activeSceneId: null,

  createScene: (name) => {
    const newScene: AssemblyScene = { id: `scene-${Date.now()}`, name, objects: [], createdAt: Date.now() }
    set({ assemblyScenes: [...get().assemblyScenes, newScene] })
  },

  deleteScene: (sceneId) => {
    const deletingActiveScene = get().activeSceneId === sceneId
    get().pushAssemblyHistory()
    set({
      assemblyScenes: get().assemblyScenes.filter(s => s.id !== sceneId),
      activeSceneId: deletingActiveScene ? null : get().activeSceneId,
      ...(deletingActiveScene ? { builderMode: 'structure' as const } : {}),
      // Deleting the active scene also clears assembly-slice objects.
      ...(deletingActiveScene ? { sceneObjects: [], selectedSceneObjectId: null } : {}),
    })
  },

  renameScene: (sceneId, name) => {
    set({ assemblyScenes: get().assemblyScenes.map(s => s.id === sceneId ? { ...s, name } : s) })
  },

  enterScene: (sceneId) => {
    const scene = get().assemblyScenes.find(s => s.id === sceneId)
    if (!scene) return
    // Entering a scene is the only way into assembly editing; browsing Assets does not change mode.
    set({ builderMode: 'assembly', activeSceneId: sceneId, sceneObjects: scene.objects.map(o => ({ ...o })) })
  },

  exitScene: () => {
    const { activeSceneId, sceneObjects, assemblyScenes } = get()
    if (activeSceneId) {
      // Save the current sceneObjects back to the scene.
      set({
        assemblyScenes: assemblyScenes.map(s =>
          s.id === activeSceneId ? { ...s, objects: sceneObjects.map(o => ({ ...o })) } : s
        ),
      })
    }
    set({ builderMode: 'structure', activeSceneId: null, sceneObjects: [], selectedSceneObjectId: null })
  },
})
