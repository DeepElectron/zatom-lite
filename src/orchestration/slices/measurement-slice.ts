/**
 * measurement-slice -- Distance, angle, and dihedral measurements with live editing
 * that solves atom positions from dragged values.
 *
 * A Zustand StateCreator slice containing measurement state, label settings, edit state,
 * and the actions that update them.
 *
 * updateMeasurementEditTarget solves new coordinates with axis-angle rotation for angles
 * and dihedrals or vector scaling for distances. In non-periodic molecular mode it moves
 * the entire connected fragment.
 *
 * Cross-slice operations read atoms, bonds, and periodic state, call pushHistory, and write
 * atoms and measurements.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore, Measurement, MeasurementEdit, MeasurementMode } from '../crystal-store-types'
import { computeAngle, computeDihedral, computeDistance } from '../../lib/measurement/measurement-math'

export interface MeasurementSlice {
  measurementMode: MeasurementMode
  measurements: Measurement[]
  pendingMeasurementAtoms: string[]
  measurementLabelOffset: number
  measurementLabelFaceCamera: boolean
  measurementFontSize: number
  measurementLineWidth: number
  measurementColor: string
  activeMeasurementEdit: MeasurementEdit | null

  setMeasurementMode: (mode: MeasurementMode) => void
  addMeasurementAtom: (atomId: string) => void
  clearPendingMeasurement: () => void
  removeMeasurement: (measurementId: string) => void
  clearAllMeasurements: () => void
  setMeasurementLabelOffset: (offset: number) => void
  setMeasurementLabelFaceCamera: (faceCamera: boolean) => void
  setMeasurementFontSize: (size: number) => void
  setMeasurementLineWidth: (width: number) => void
  setMeasurementColor: (color: string) => void
  startMeasurementEdit: (measurementId: string, fixedAtomIndices: number[]) => void
  updateMeasurementEditTarget: (targetValue: number) => void
  applyMeasurementEdit: () => void
  cancelMeasurementEdit: () => void
}

export const createMeasurementSlice: StateCreator<CrystalStore, [], [], MeasurementSlice> = (set, get) => ({
  measurementMode: 'none',
  measurements: [],
  pendingMeasurementAtoms: [],
  measurementLabelOffset: 0.8,
  measurementLabelFaceCamera: true,
  measurementFontSize: 0.25,
  measurementLineWidth: 2,
  // Annotation color is user-controlled rather than keyed to measurement type:
  // the type is already stated by the label unit (A vs degrees) and by geometry,
  // so color is free to serve legibility against the current scene instead.
  measurementColor: '#e5006e',
  activeMeasurementEdit: null,

  // Measurement actions
  setMeasurementMode: (mode: MeasurementMode) => {
    set({
      measurementMode: mode,
      pendingMeasurementAtoms: [],
      ...(mode !== 'none' ? {
        toolMode: 'select',
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        pendingBondAtomId: null,
        translateMode: false,
        translationPreview: null,
        selectionRegionPreview: null,
      } : {}),
    })
  },
  
  addMeasurementAtom: (atomId: string) => {
    const { measurementMode, pendingMeasurementAtoms, measurements, atoms } = get()
    if (measurementMode === 'none' || !atoms.some((atom) => atom.id === atomId)) return
    
    // Don't add duplicates
    if (pendingMeasurementAtoms.includes(atomId)) return
    
    const newPending = [...pendingMeasurementAtoms, atomId]
    
    // Check if we have enough atoms for the measurement type
    const requiredAtoms = measurementMode === 'distance' ? 2 : measurementMode === 'angle' ? 3 : 4
    
    if (newPending.length >= requiredAtoms) {
      // Calculate measurement
      const measurementAtoms = newPending.slice(0, requiredAtoms).map(id => atoms.find(a => a.id === id)!)
      
      let value = 0
      if (measurementMode === 'distance' && measurementAtoms.length >= 2) {
        const [a1, a2] = measurementAtoms
        if (a1?.cartesian && a2?.cartesian) value = computeDistance(a1.cartesian, a2.cartesian)
      } else if (measurementMode === 'angle' && measurementAtoms.length >= 3) {
        const [a1, a2, a3] = measurementAtoms
        if (a1?.cartesian && a2?.cartesian && a3?.cartesian) {
          value = computeAngle(a1.cartesian, a2.cartesian, a3.cartesian)
        }
      } else if (measurementMode === 'dihedral' && measurementAtoms.length >= 4) {
        const [a1, a2, a3, a4] = measurementAtoms
        if (a1?.cartesian && a2?.cartesian && a3?.cartesian && a4?.cartesian) {
          value = computeDihedral(a1.cartesian, a2.cartesian, a3.cartesian, a4.cartesian)
        }
      }
      
      const newMeasurement: Measurement = {
        id: `measurement-${Date.now()}`,
        type: measurementMode as 'distance' | 'angle' | 'dihedral',
        atomIds: newPending.slice(0, requiredAtoms),
        value,
      }
      
      set({
        measurements: [...measurements, newMeasurement],
        pendingMeasurementAtoms: [],
      })
    } else {
      set({ pendingMeasurementAtoms: newPending })
    }
  },
  
  clearPendingMeasurement: () => {
    set({ pendingMeasurementAtoms: [] })
  },
  
  removeMeasurement: (measurementId: string) => {
    const { measurements } = get()
    set({ measurements: measurements.filter(m => m.id !== measurementId) })
  },
  
  clearAllMeasurements: () => {
    set({ measurements: [], pendingMeasurementAtoms: [] })
  },
  
  setMeasurementLabelOffset: (offset: number) => {
    set({ measurementLabelOffset: Math.max(0.1, Math.min(3, offset)) })
  },
  
  setMeasurementLabelFaceCamera: (faceCamera: boolean) => {
    set({ measurementLabelFaceCamera: faceCamera })
  },
  
  setMeasurementFontSize: (size: number) => {
    set({ measurementFontSize: Math.max(0.1, Math.min(0.6, size)) })
  },
  
  setMeasurementLineWidth: (width: number) => {
    set({ measurementLineWidth: Math.max(0.5, Math.min(5, width)) })
  },

  setMeasurementColor: (color: string) => {
    // Reject anything three.js and canvas fillStyle cannot both parse, otherwise
    // a malformed value silently renders annotations black on both surfaces.
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
    set({ measurementColor: color })
  },
  
  // Measurement editing implementations
  startMeasurementEdit: (measurementId: string, fixedAtomIndices: number[]) => {
    const { measurements, atoms } = get()
    const measurement = measurements.find(m => m.id === measurementId)
    if (!measurement) return
    
    // Distance editing may move an entire connected fragment, so cancellation
    // must own every coordinate that the preview can touch.
    const originalPositions = atoms
      .map(atom => atom.cartesian
        ? { atomId: atom.id, position: [...atom.cartesian] as [number, number, number] }
        : null)
      .filter((p): p is { atomId: string; position: [number, number, number] } => p !== null)
    
    set({
      activeMeasurementEdit: {
        measurementId,
        fixedAtomIndices,
        targetValue: measurement.value,
        originalValue: measurement.value,
        originalPositions,
      }
    })
  },
  
  updateMeasurementEditTarget: (targetValue: number) => {
    const { activeMeasurementEdit, measurements, atoms } = get()
    if (!activeMeasurementEdit) return
    
    const measurement = measurements.find(m => m.id === activeMeasurementEdit.measurementId)
    if (!measurement) return
    
    const measurementAtoms = measurement.atomIds.map(id => atoms.find(a => a.id === id))
    if (measurementAtoms.some(a => !a)) return
    
    const { fixedAtomIndices, originalPositions } = activeMeasurementEdit
    let newAtoms = [...atoms]
    let newValue = targetValue
    
    // First restore original positions before calculating new ones
    newAtoms = newAtoms.map(a => {
      const orig = originalPositions.find(op => op.atomId === a.id)
      if (orig) {
        return { ...a, cartesian: [...orig.position] as [number, number, number] }
      }
      return a
    })
    
    // Re-get measurement atoms with restored positions
    const restoredAtoms = measurement.atomIds.map(id => newAtoms.find(a => a.id === id))
    
    if (measurement.type === 'distance' && restoredAtoms.length >= 2) {
      const fixedIdx = fixedAtomIndices[0] || 0
      const movingIdx = fixedIdx === 0 ? 1 : 0
      
      const fixedAtom = restoredAtoms[fixedIdx]!
      const movingAtom = restoredAtoms[movingIdx]!
      
      if (!fixedAtom.cartesian || !movingAtom.cartesian) return
      
      const dx = movingAtom.cartesian[0] - fixedAtom.cartesian[0]
      const dy = movingAtom.cartesian[1] - fixedAtom.cartesian[1]
      const dz = movingAtom.cartesian[2] - fixedAtom.cartesian[2]
      const currentDist = Math.sqrt(dx*dx + dy*dy + dz*dz)
      
      if (currentDist < 0.001) return
      
      const { periodic, bonds } = get()

      if (!periodic) {
        // In molecule mode, move the entire fragment connected to the moving atom
        // Find the fragment by traversing bonds, excluding the bond between fixed and moving atoms
        const findConnectedFragment = (
          startAtomId: string,
          excludeBondAtomIds: [string, string]
        ): Set<string> => {
          const connected = new Set<string>()
          const queue = [startAtomId]
          
          while (queue.length > 0) {
            const currentId = queue.shift()!
            if (connected.has(currentId)) continue
            connected.add(currentId)
            
            for (const bond of bonds) {
              let neighborId: string | null = null
              if (bond.atom1Id === currentId) {
                neighborId = bond.atom2Id
              } else if (bond.atom2Id === currentId) {
                neighborId = bond.atom1Id
              }
              
              if (neighborId && !connected.has(neighborId)) {
                const isExcludedBond = 
                  (bond.atom1Id === excludeBondAtomIds[0] && bond.atom2Id === excludeBondAtomIds[1]) ||
                  (bond.atom1Id === excludeBondAtomIds[1] && bond.atom2Id === excludeBondAtomIds[0])
                
                if (!isExcludedBond) {
                  queue.push(neighborId)
                }
              }
            }
          }
          
          return connected
        }
        
        // Get the fragment containing the moving atom (excluding bond to fixed atom)
        const movingFragment = findConnectedFragment(movingAtom.id, [fixedAtom.id, movingAtom.id])
        
        // Calculate the new position for the moving atom based on target distance
        const scale = targetValue / currentDist
        const newMovingPos: [number, number, number] = [
          fixedAtom.cartesian[0] + dx * scale,
          fixedAtom.cartesian[1] + dy * scale,
          fixedAtom.cartesian[2] + dz * scale
        ]
        
        // Calculate displacement from current moving atom position to new position
        const displacement: [number, number, number] = [
          newMovingPos[0] - movingAtom.cartesian[0],
          newMovingPos[1] - movingAtom.cartesian[1],
          newMovingPos[2] - movingAtom.cartesian[2]
        ]
        
        // Build a map of original positions for all atoms in the fragment
        const originalPositions = new Map<string, [number, number, number]>()
        for (const atom of newAtoms) {
          if (movingFragment.has(atom.id) && atom.cartesian) {
            originalPositions.set(atom.id, [...atom.cartesian] as [number, number, number])
          }
        }
        
        // Move all atoms in the fragment by the same displacement
        newAtoms = newAtoms.map(a => {
          const origPos = originalPositions.get(a.id)
          if (origPos) {
            return {
              ...a,
              cartesian: [
                origPos[0] + displacement[0],
                origPos[1] + displacement[1],
                origPos[2] + displacement[2]
              ] as [number, number, number]
            }
          }
          return a
        })
      } else {
        // Crystal mode: move only the single atom
        const scale = targetValue / currentDist
        const newX = fixedAtom.cartesian[0] + dx * scale
        const newY = fixedAtom.cartesian[1] + dy * scale
        const newZ = fixedAtom.cartesian[2] + dz * scale
        
        newAtoms = newAtoms.map(a => {
          if (a.id === movingAtom.id) {
            return { ...a, cartesian: [newX, newY, newZ] as [number, number, number] }
          }
          return a
        })
      }
      
    } else if (measurement.type === 'angle' && restoredAtoms.length >= 3) {
      const [a1, a2, a3] = restoredAtoms as [typeof restoredAtoms[0], typeof restoredAtoms[0], typeof restoredAtoms[0]]
      if (!a1?.cartesian || !a2?.cartesian || !a3?.cartesian) return
      
      const movingIdx = [0, 1, 2].find(i => !fixedAtomIndices.includes(i))
      if (movingIdx === undefined) return
      
      const vertex = a2
      const movingAtom = restoredAtoms[movingIdx]!
      const fixedEdgeAtom = restoredAtoms[fixedAtomIndices.find(i => i !== 1) || 0]!
      
      if (!movingAtom.cartesian || !vertex.cartesian || !fixedEdgeAtom.cartesian) return
      
      const vFixed = [
        fixedEdgeAtom.cartesian[0] - vertex.cartesian[0],
        fixedEdgeAtom.cartesian[1] - vertex.cartesian[1],
        fixedEdgeAtom.cartesian[2] - vertex.cartesian[2],
      ]
      const vMoving = [
        movingAtom.cartesian[0] - vertex.cartesian[0],
        movingAtom.cartesian[1] - vertex.cartesian[1],
        movingAtom.cartesian[2] - vertex.cartesian[2],
      ]
      
      const axis = [
        vFixed[1]*vMoving[2] - vFixed[2]*vMoving[1],
        vFixed[2]*vMoving[0] - vFixed[0]*vMoving[2],
        vFixed[0]*vMoving[1] - vFixed[1]*vMoving[0],
      ]
      const axisMag = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2])
      
      if (axisMag < 0.001) return
      
      axis[0] /= axisMag
      axis[1] /= axisMag
      axis[2] /= axisMag
      
      // Current angle from original positions
      const dot = vFixed[0]*vMoving[0] + vFixed[1]*vMoving[1] + vFixed[2]*vMoving[2]
      const magF = Math.sqrt(vFixed[0]*vFixed[0] + vFixed[1]*vFixed[1] + vFixed[2]*vFixed[2])
      const magM = Math.sqrt(vMoving[0]*vMoving[0] + vMoving[1]*vMoving[1] + vMoving[2]*vMoving[2])
      const currentAngle = Math.acos(Math.max(-1, Math.min(1, dot / (magF * magM)))) * (180 / Math.PI)
      
      const deltaAngle = (targetValue - currentAngle) * (Math.PI / 180)
      
      const cos = Math.cos(deltaAngle)
      const sin = Math.sin(deltaAngle)
      const dotAxis = axis[0]*vMoving[0] + axis[1]*vMoving[1] + axis[2]*vMoving[2]
      const cross = [
        axis[1]*vMoving[2] - axis[2]*vMoving[1],
        axis[2]*vMoving[0] - axis[0]*vMoving[2],
        axis[0]*vMoving[1] - axis[1]*vMoving[0],
      ]
      
      const newVMoving = [
        vMoving[0]*cos + cross[0]*sin + axis[0]*dotAxis*(1-cos),
        vMoving[1]*cos + cross[1]*sin + axis[1]*dotAxis*(1-cos),
        vMoving[2]*cos + cross[2]*sin + axis[2]*dotAxis*(1-cos),
      ]
      
      const newX = vertex.cartesian[0] + newVMoving[0]
      const newY = vertex.cartesian[1] + newVMoving[1]
      const newZ = vertex.cartesian[2] + newVMoving[2]
      
      newAtoms = newAtoms.map(a => {
        if (a.id === movingAtom.id) {
          return { ...a, cartesian: [newX, newY, newZ] as [number, number, number] }
        }
        return a
      })
      newValue = targetValue
      
    } else if (measurement.type === 'dihedral' && restoredAtoms.length >= 4) {
      const [a1, a2, a3, a4] = restoredAtoms as [typeof restoredAtoms[0], typeof restoredAtoms[0], typeof restoredAtoms[0], typeof restoredAtoms[0]]
      if (!a1?.cartesian || !a2?.cartesian || !a3?.cartesian || !a4?.cartesian) return
      
      const movingIdx = [0, 1, 2, 3].find(i => !fixedAtomIndices.includes(i))
      if (movingIdx === undefined) return
      
      const movingAtom = restoredAtoms[movingIdx]!
      if (!movingAtom.cartesian) return
      
      const axis = [
        a3.cartesian[0] - a2.cartesian[0],
        a3.cartesian[1] - a2.cartesian[1],
        a3.cartesian[2] - a2.cartesian[2],
      ]
      const axisMag = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2])
      if (axisMag < 0.001) return
      
      axis[0] /= axisMag
      axis[1] /= axisMag
      axis[2] /= axisMag
      
      const pivot = a3.cartesian
      const vMoving = [
        movingAtom.cartesian[0] - pivot[0],
        movingAtom.cartesian[1] - pivot[1],
        movingAtom.cartesian[2] - pivot[2],
      ]
      
      const currentAngle = activeMeasurementEdit.originalValue
      const deltaAngle = (targetValue - currentAngle) * (Math.PI / 180)
      
      const cos = Math.cos(deltaAngle)
      const sin = Math.sin(deltaAngle)
      const dotAxis = axis[0]*vMoving[0] + axis[1]*vMoving[1] + axis[2]*vMoving[2]
      const cross = [
        axis[1]*vMoving[2] - axis[2]*vMoving[1],
        axis[2]*vMoving[0] - axis[0]*vMoving[2],
        axis[0]*vMoving[1] - axis[1]*vMoving[0],
      ]
      
      const newVMoving = [
        vMoving[0]*cos + cross[0]*sin + axis[0]*dotAxis*(1-cos),
        vMoving[1]*cos + cross[1]*sin + axis[1]*dotAxis*(1-cos),
        vMoving[2]*cos + cross[2]*sin + axis[2]*dotAxis*(1-cos),
      ]
      
      const newX = pivot[0] + newVMoving[0]
      const newY = pivot[1] + newVMoving[1]
      const newZ = pivot[2] + newVMoving[2]
      
      newAtoms = newAtoms.map(a => {
        if (a.id === movingAtom.id) {
          return { ...a, cartesian: [newX, newY, newZ] as [number, number, number] }
        }
        return a
      })
      newValue = targetValue
    }
    
    // Update measurements value
    const newMeasurements = measurements.map(m => {
      if (m.id === measurement.id) {
        return { ...m, value: newValue }
      }
      return m
    })
    
    set({
      atoms: newAtoms,
      measurements: newMeasurements,
      activeMeasurementEdit: {
        ...activeMeasurementEdit,
        targetValue,
      }
    })
    get().syncBiomoleculeCoordinates(newAtoms)
  },
  
  applyMeasurementEdit: () => {
    const { activeMeasurementEdit, atoms, measurements } = get()
    if (!activeMeasurementEdit) return
    if (Math.abs(activeMeasurementEdit.targetValue - activeMeasurementEdit.originalValue) < 1e-9) {
      set({ activeMeasurementEdit: null })
      return
    }

    const finalAtoms = atoms
    const finalMeasurements = measurements
    const originalById = new Map(activeMeasurementEdit.originalPositions.map(item => [item.atomId, item.position]))
    const originalAtoms = atoms.map(atom => {
      const original = originalById.get(atom.id)
      return original ? { ...atom, cartesian: [...original] as [number, number, number] } : atom
    })
    const originalMeasurements = measurements.map(measurement =>
      measurement.id === activeMeasurementEdit.measurementId
        ? { ...measurement, value: activeMeasurementEdit.originalValue }
        : measurement,
    )

    // Preview stays history-neutral. Apply records exactly one snapshot of the
    // original document, then commits the already-computed final state.
    set({ atoms: originalAtoms, measurements: originalMeasurements })
    get().syncBiomoleculeCoordinates(originalAtoms)
    get().pushHistory()
    set({ atoms: finalAtoms, measurements: finalMeasurements, activeMeasurementEdit: null })
    get().syncBiomoleculeCoordinates(finalAtoms)
  },
  
  cancelMeasurementEdit: () => {
    const { activeMeasurementEdit, atoms, measurements } = get()
    if (!activeMeasurementEdit) {
      set({ activeMeasurementEdit: null })
      return
    }
    
    const { originalPositions, originalValue, measurementId } = activeMeasurementEdit
    
    // Restore original atom positions
    const restoredAtoms = atoms.map(a => {
      const orig = originalPositions.find(op => op.atomId === a.id)
      if (orig) {
        return { ...a, cartesian: [...orig.position] as [number, number, number] }
      }
      return a
    })
    
    // Restore original measurement value
    const restoredMeasurements = measurements.map(m => {
      if (m.id === measurementId) {
        return { ...m, value: originalValue }
      }
      return m
    })
    
    set({ 
      atoms: restoredAtoms, 
      measurements: restoredMeasurements,
      activeMeasurementEdit: null 
    })
    get().syncBiomoleculeCoordinates(restoredAtoms)
  },
})
