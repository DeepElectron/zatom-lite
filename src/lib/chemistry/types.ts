// Core types for the molecular modeling system

export type Vector3 = [number, number, number]

export interface Atom {
  id: string
  element: string
  position: Vector3
  label?: string
}

export interface Bond {
  id: string
  atomId1: string
  atomId2: string
  order: number // 1 = single, 2 = double, 3 = triple
}

export interface MolecularStructure {
  id: string
  name: string
  atoms: Atom[]
  bonds: Bond[]
}

export interface SelectionState {
  selectedAtomIds: Set<string>
  hoveredAtomId: string | null
}

export interface CameraTarget {
  position: Vector3
  lookAt: Vector3
  distance: number
}
