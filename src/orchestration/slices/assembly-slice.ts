/**
 * assembly-slice — Assembly mode: a building-block library, sceneObject composition,
 * and a guided workflow for placing new objects.
 *
 * BuildingBlock: an atoms/bonds snapshot plus type, lattice, and default-supercell metadata.
 * SceneObject: a block reference with position, rotation, and supercell.
 * Placement workflow: idle → position-xy → position-z → confirm. useOrthographic
 * temporarily switches to top view, and minDistance prevents overlap with existing objects.
 *
 * syncAssemblyToAtoms expands every sceneObject into combined atoms/bonds arrays and
 * exits crystal mode. It sets supercellParams=1×1×1 because expansion is already explicit.
 *
 * Cross-slice: assembly and crystal are mutually exclusive builder modes.
 * syncAssemblyToAtoms writes atoms, bonds, unitCellAtoms, supercellParams, and related
 * state across slices. Every mutation calls pushAssemblyHistory first.
 */

import type { StateCreator } from 'zustand'
import type {
  AssemblyTransformMode,
  Atom,
  Bond,
  BuildingBlock,
  CrystalStore,
  PlacementState,
  SceneObject,
} from '../crystal-store-types'

export interface AssemblySlice {
  buildingBlocks: BuildingBlock[]
  sceneObjects: SceneObject[]
  selectedSceneObjectId: string | null
  assemblyTransformMode: AssemblyTransformMode
  placementState: PlacementState

  addBuildingBlock: (name: string) => void
  duplicateBuildingBlock: (blockId: string) => void
  removeBuildingBlock: (blockId: string) => void
  addSceneObject: (blockId: string, position?: [number, number, number], supercell?: { a: number; b: number; c: number }) => void
  removeSceneObject: (objectId: string) => void
  updateSceneObjectPosition: (objectId: string, position: [number, number, number]) => void
  updateSceneObjectRotation: (objectId: string, rotation: [number, number, number]) => void
  expandSceneObjectSupercell: (objectId: string, axis: 'a' | 'b' | 'c', delta: number) => void
  selectSceneObject: (objectId: string | null) => void
  syncAssemblyToAtoms: () => void
  setAssemblyTransformMode: (mode: AssemblyTransformMode) => void
  startPlacement: (blockId: string) => void
  updatePlacementPosition: (position: [number, number, number]) => void
  updatePlacementRotation: (rotation: [number, number, number]) => void
  updatePlacementDistance: (distance: number) => void
  togglePlacementOrthographic: () => void
  nextPlacementStep: () => void
  cancelPlacement: () => void
  confirmPlacement: () => void
  duplicateSceneObject: (objectId: string) => void
}

export const createAssemblySlice: StateCreator<CrystalStore, [], [], AssemblySlice> = (set, get) => ({
  buildingBlocks: [],
  sceneObjects: [],
  selectedSceneObjectId: null,
  assemblyTransformMode: 'select',
  placementState: {
    step: 'idle',
    blockId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    useOrthographic: true,
    minDistance: -1,
  },

  // Assembly mode actions
  addBuildingBlock: (name) => {
    get().pushAssemblyHistory()
    const { atoms, bonds, unitCellAtoms, periodic, buildingBlocks, latticeVectors, showLattice } = get()
    if (atoms.length === 0) return

    const isCrystal = periodic

    // Crystal mode stores unit-cell atoms for the assembly viewer to expand.
    // Molecule mode stores every atom.
    const blockAtoms = isCrystal && unitCellAtoms.length > 0
      ? unitCellAtoms.map(a => ({ ...a }))
      : atoms.map(a => ({ ...a }))

    // Compute missing Cartesian coordinates for unit-cell atoms.
    if (isCrystal) {
      for (const atom of blockAtoms) {
        if (!atom.cartesian) {
          const [fx, fy, fz] = atom.position
          atom.cartesian = [
            fx * latticeVectors.a[0] + fy * latticeVectors.b[0] + fz * latticeVectors.c[0],
            fx * latticeVectors.a[1] + fy * latticeVectors.b[1] + fz * latticeVectors.c[1],
            fx * latticeVectors.a[2] + fy * latticeVectors.b[2] + fz * latticeVectors.c[2],
          ] as [number, number, number]
        }
      }
    }

    // Keep only bonds between unit-cell atoms.
    const blockAtomIds = new Set(blockAtoms.map(a => a.id))
    const blockBonds = bonds
      .filter(b => blockAtomIds.has(b.atom1Id) && blockAtomIds.has(b.atom2Id))
      .map(b => ({ ...b }))

    const sp = get().supercellParams
    const newBlock: BuildingBlock = {
      id: `block-${Date.now()}`,
      name,
      type: isCrystal ? 'crystal' : 'molecule',
      atoms: blockAtoms,
      bonds: blockBonds,
      createdAt: Date.now(),
      latticeVectors: isCrystal ? { ...latticeVectors } : undefined,
      showLattice: isCrystal ? showLattice : undefined,
      defaultSupercell: isCrystal ? { a: sp.nx, b: sp.ny, c: sp.nz } : undefined,
    }

    set({ buildingBlocks: [...buildingBlocks, newBlock] })
  },

  duplicateBuildingBlock: (blockId) => {
    const { buildingBlocks } = get()
    const block = buildingBlocks.find(b => b.id === blockId)
    if (!block) return
    
    const newBlock: BuildingBlock = {
      ...block,
      id: `block-${Date.now()}`,
      name: `${block.name} (Copy)`,
      atoms: block.atoms.map(a => ({ ...a })),  // Deep copy
      bonds: block.bonds.map(b => ({ ...b })),
      createdAt: Date.now(),
      latticeVectors: block.latticeVectors ? { ...block.latticeVectors } : undefined,
    }
    
    set({ buildingBlocks: [...buildingBlocks, newBlock] })
  },
  
  removeBuildingBlock: (blockId) => {
    get().pushAssemblyHistory()
    const { buildingBlocks, sceneObjects } = get()
    set({ 
      buildingBlocks: buildingBlocks.filter(b => b.id !== blockId),
      // Also remove scene objects using this block
      sceneObjects: sceneObjects.filter(o => o.blockId !== blockId),
    })
  },
  
  addSceneObject: (blockId, position = [0, 0, 0], supercell) => {
    get().pushAssemblyHistory()
    const { sceneObjects, buildingBlocks } = get()
    const block = buildingBlocks.find(b => b.id === blockId)
    if (!block) return

    // Offset position if there are existing objects
    const offset = sceneObjects.length * 8
    const newObj: SceneObject = {
      id: `scene-obj-${Date.now()}`,
      blockId,
      position: [position[0] + offset, position[1], position[2]],
      rotation: [0, 0, 0],
      supercell: supercell ?? block.defaultSupercell ?? { a: 1, b: 1, c: 1 },
    }
    
    set({ sceneObjects: [...sceneObjects, newObj] })
  },

  removeSceneObject: (objectId) => {
    get().pushAssemblyHistory()
    const { sceneObjects, selectedSceneObjectId } = get()
    set({
      sceneObjects: sceneObjects.filter(o => o.id !== objectId),
      selectedSceneObjectId: selectedSceneObjectId === objectId ? null : selectedSceneObjectId,
    })
  },
  
  updateSceneObjectPosition: (objectId, position) => {
    const { sceneObjects } = get()
    set({
      sceneObjects: sceneObjects.map((o: SceneObject) =>
        o.id === objectId ? { ...o, position } : o
      ),
    })
  },

  updateSceneObjectRotation: (objectId, rotation) => {
    const { sceneObjects } = get()
    set({
      sceneObjects: sceneObjects.map(o =>
        o.id === objectId ? { ...o, rotation } : o
      ),
    })
  },

  expandSceneObjectSupercell: (objectId, axis, delta) => {
    get().pushAssemblyHistory()
    const { sceneObjects } = get()
    set({
      sceneObjects: sceneObjects.map(o => {
        if (o.id !== objectId) return o
        const newValue = Math.max(1, (o.supercell[axis] || 1) + delta)
        return {
          ...o,
          supercell: { ...o.supercell, [axis]: newValue },
        }
      }),
    })
  },
  
  selectSceneObject: (objectId) => {
    set({ selectedSceneObjectId: objectId })
  },

  syncAssemblyToAtoms: () => {
    // Assembly expansion creates a new atom-id/topology namespace. Semantic
    // layers from the previous structure must not silently target it.
    get().clearBiomolecule()
    get().clearCrystalLayers()
    get().clearTrajectory()
    const { sceneObjects, buildingBlocks } = get()
    const allAtoms: Atom[] = []
    const allBonds: Bond[] = []

    for (const obj of sceneObjects) {
      const block = buildingBlocks.find(b => b.id === obj.blockId)
      if (!block) continue

      const lv = block.latticeVectors
      const sa = obj.supercell?.a ?? 1
      const sb = obj.supercell?.b ?? 1
      const sc = obj.supercell?.c ?? 1

      // Compute the block center for centering offsets.
      let cx = 0, cy = 0, cz = 0
      for (const a of block.atoms) {
        const p = a.cartesian ?? a.position
        cx += p[0]; cy += p[1]; cz += p[2]
      }
      if (block.atoms.length > 0) {
        cx /= block.atoms.length; cy /= block.atoms.length; cz /= block.atoms.length
      }

      // Euler XYZ rotation matrix.
      const [rx, ry, rz] = obj.rotation
      const cosX = Math.cos(rx), sinX = Math.sin(rx)
      const cosY = Math.cos(ry), sinY = Math.sin(ry)
      const cosZ = Math.cos(rz), sinZ = Math.sin(rz)

      const rotatePoint = (x: number, y: number, z: number): [number, number, number] => {
        // Euler XYZ rotation
        const y1 = cosX * y - sinX * z, z1 = sinX * y + cosX * z
        const x2 = cosY * x + sinY * z1, z2 = -sinY * x + cosY * z1
        const x3 = cosZ * x2 - sinZ * y1, y3 = sinZ * x2 + cosZ * y1
        return [x3, y3, z2]
      }

      // Atom ID map for remapping bonds.
      const idMap = new Map<string, string>()

      // Traverse the supercell.
      for (let ia = 0; ia < sa; ia++) {
        for (let ib = 0; ib < sb; ib++) {
          for (let ic = 0; ic < sc; ic++) {
            // Supercell offset.
            let offX = 0, offY = 0, offZ = 0
            if (lv && block.type === 'crystal') {
              offX = ia * lv.a[0] + ib * lv.b[0] + ic * lv.c[0]
              offY = ia * lv.a[1] + ib * lv.b[1] + ic * lv.c[1]
              offZ = ia * lv.a[2] + ib * lv.b[2] + ic * lv.c[2]
            }

            for (const atom of block.atoms) {
              const p = atom.cartesian ?? atom.position
              // Position relative to the center plus the supercell offset.
              const lx = p[0] - cx + offX
              const ly = p[1] - cy + offY
              const lz = p[2] - cz + offZ
              // Rotate.
              const [rx2, ry2, rz2] = rotatePoint(lx, ly, lz)
              // World coordinates.
              const wx = rx2 + obj.position[0]
              const wy = ry2 + obj.position[1]
              const wz = rz2 + obj.position[2]

              const newId = `${obj.id}-${atom.id}-${ia}-${ib}-${ic}`
              idMap.set(`${atom.id}-${ia}-${ib}-${ic}`, newId)

              allAtoms.push({
                ...atom,
                id: newId,
                cartesian: [wx, wy, wz],
                position: [wx, wy, wz], // Store world coordinates in position.
              })
            }

            // Bonds.
            for (const bond of block.bonds) {
              const a1Key = `${bond.atom1Id}-${ia}-${ib}-${ic}`
              const a2Key = `${bond.atom2Id}-${ia}-${ib}-${ic}`
              const newA1 = idMap.get(a1Key)
              const newA2 = idMap.get(a2Key)
              if (newA1 && newA2) {
                allBonds.push({
                  ...bond,
                  id: `${obj.id}-${bond.id || 'b'}-${ia}-${ib}-${ic}`,
                  atom1Id: newA1,
                  atom2Id: newA2,
                })
              }
            }
          }
        }
      }
    }

    // Keep the lattice visible if the scene contains any periodic structure.
    const crystalBlock = sceneObjects
      .map(o => buildingBlocks.find(b => b.id === o.blockId))
      .find(b => b && b.type === 'crystal' && b.latticeVectors)

    if (crystalBlock?.latticeVectors) {
      // Read supercell parameters from the corresponding sceneObject.
      const crystalObj = sceneObjects.find(o => o.blockId === crystalBlock.id)
      const sa = crystalObj?.supercell?.a ?? 1
      const sb = crystalObj?.supercell?.b ?? 1
      const sc = crystalObj?.supercell?.c ?? 1
      const lv = crystalBlock.latticeVectors
      set({
        atoms: allAtoms,
        bonds: allBonds,
        periodic: true,
        showLattice: true,
        latticeVectors: {
          a: [lv.a[0] * sa, lv.a[1] * sa, lv.a[2] * sa],
          b: [lv.b[0] * sb, lv.b[1] * sb, lv.b[2] * sb],
          c: [lv.c[0] * sc, lv.c[1] * sc, lv.c[2] * sc],
        },
        supercellParams: { nx: 1, ny: 1, nz: 1 }, // Already expanded in syncAssemblyToAtoms.
      })
    } else {
      set({ atoms: allAtoms, bonds: allBonds, periodic: false, showLattice: false })
    }
  },
  
  setAssemblyTransformMode: (mode) => {
    set({ assemblyTransformMode: mode })
  },
  
  // Placement workflow actions
  startPlacement: (blockId) => {
    const { sceneObjects } = get()
    // If scene is empty, add directly
    if (sceneObjects.length === 0) {
      get().addSceneObject(blockId, [0, 0, 0])
    } else {
      // Start placement workflow
      set({
        placementState: {
          step: 'position-xy',
          blockId,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          useOrthographic: true,
          minDistance: -1,
        },
      })
    }
  },
  
  updatePlacementPosition: (position) => {
    set(state => ({
      placementState: {
        ...state.placementState,
        position,
      },
    }))
  },
  
  updatePlacementRotation: (rotation) => {
    set(state => ({
      placementState: {
        ...state.placementState,
        rotation,
      },
    }))
  },
  
  updatePlacementDistance: (distance) => {
    set(state => ({
      placementState: {
        ...state.placementState,
        minDistance: distance,
      },
    }))
  },
  
  togglePlacementOrthographic: () => {
    set(state => ({
      placementState: {
        ...state.placementState,
        useOrthographic: !state.placementState.useOrthographic,
      },
    }))
  },
  
  nextPlacementStep: () => {
    set(state => {
      const { step } = state.placementState
      if (step === 'position-xy') {
        return { placementState: { ...state.placementState, step: 'position-z' } }
      }
      if (step === 'position-z') {
        return { placementState: { ...state.placementState, step: 'confirm' } }
      }
      return state
    })
  },
  
  cancelPlacement: () => {
    set({
      placementState: {
        step: 'idle',
        blockId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        useOrthographic: true,
        minDistance: -1,
      },
    })
  },
  
  confirmPlacement: () => {
    const { placementState, sceneObjects, buildingBlocks } = get()
    if (placementState.blockId) {
      const block = buildingBlocks.find(b => b.id === placementState.blockId)
      const newObj = {
        id: `scene-obj-${Date.now()}`,
        blockId: placementState.blockId,
        position: placementState.position,
        rotation: placementState.rotation,
        supercell: block?.defaultSupercell ?? { a: 1, b: 1, c: 1 },
      }
      set({ sceneObjects: [...sceneObjects, newObj] })
    }
    set({
      placementState: {
        step: 'idle',
        blockId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        useOrthographic: true,
        minDistance: -1,
      },
    })
  },

  duplicateSceneObject: (objectId) => {
    const { sceneObjects } = get()
    const obj = sceneObjects.find(o => o.id === objectId)
    if (!obj) return
    
    const newObj: SceneObject = {
      ...obj,
      id: `scene-obj-${Date.now()}`,
      position: [obj.position[0] + 2, obj.position[1], obj.position[2]],
      supercell: { ...obj.supercell },
    }
    
    set({ sceneObjects: [...sceneObjects, newObj] })
  },
})
