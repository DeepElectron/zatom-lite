/**
 * Custom Fragment Library
 * Allows users to save and manage their own molecular fragments/templates
 */

export interface CustomFragment {
  id: string
  name: string
  smiles?: string
  formula?: string
  createdAt: number
  // 3D structure data
  atoms?: Array<{ element: string; position: [number, number, number] }>
  bonds?: Array<{ from: number; to: number; type: string }>
  // Index of the atom that serves as the attachment/connection point (default: 0)
  attachmentIndex?: number
  /**
  * Unit cell, when the saved structure is periodic.
  *
  * This store began as a molecular fragment library, where "no lattice" was a
  * safe assumption. It is now also the destination for crystals captured from
  * the 3D editor, and dropping their cell silently reinterpreted them as
  * isolated molecules: the atoms survived but periodicity, the defining
  * property of the structure, did not. The cell is the structure's identity
  * here, not decoration, so it is stored alongside the coordinates.
  *
  * Rows are the a/b/c vectors in Angstroms. Absent means genuinely aperiodic
  * (a sketch, a fragment) — not "unknown", so a reader can trust the absence.
  */
  latticeMatrix?: [number, number, number][]
  periodicity?: 'periodic' | 'molecular'
}

const STORAGE_KEY = 'crystal-custom-fragments'

/**
 * Change notification so React surfaces (the catalog's user section) can re-render
 * the moment something is saved, instead of only picking it up on remount.
 *
 * `getCustomFragments` parses localStorage on every call and so returns a fresh
 * array identity each time. That breaks `useSyncExternalStore`, which bails with
 * an infinite-loop error when getSnapshot is not referentially stable. The cached
 * snapshot below is therefore not an optimisation — it is what makes the store
 * subscribable at all. It is invalidated on every mutation.
 */
type Listener = () => void
const listeners = new Set<Listener>()
let snapshot: CustomFragment[] | null = null

function invalidate(): void {
  snapshot = null
  for (const listener of listeners) listener()
}

export function subscribeCustomFragments(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Stable-identity read for `useSyncExternalStore`; same data as `getCustomFragments`. */
export function getCustomFragmentsSnapshot(): CustomFragment[] {
  if (snapshot === null) snapshot = getCustomFragments()
  return snapshot
}

/**
 * Get all custom fragments from localStorage
 */
export function getCustomFragments(): CustomFragment[] {
  if (typeof window === 'undefined') return []
  
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

/**
 * Save a new custom fragment
 */
export function saveCustomFragment(fragment: Omit<CustomFragment, 'id' | 'createdAt'>): CustomFragment {
  const fragments = getCustomFragments()
  
  const newFragment: CustomFragment = {
    ...fragment,
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now(),
  }
  
  fragments.push(newFragment)
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fragments))
  }
  invalidate()
  
  return newFragment
}

/**
 * Delete a custom fragment by ID
 */
export function deleteCustomFragment(id: string): boolean {
  const fragments = getCustomFragments()
  const index = fragments.findIndex(f => f.id === id)
  
  if (index === -1) return false
  
  fragments.splice(index, 1)
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fragments))
  }
  invalidate()
  
  return true
}

/**
 * Update an existing custom fragment
 */
export function updateCustomFragment(id: string, updates: Partial<Omit<CustomFragment, 'id' | 'createdAt'>>): CustomFragment | null {
  const fragments = getCustomFragments()
  const index = fragments.findIndex(f => f.id === id)
  
  if (index === -1) return null
  
  fragments[index] = { ...fragments[index], ...updates }
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fragments))
  }
  invalidate()
  
  return fragments[index]
}

/**
 * Check if a fragment name already exists
 */
export function fragmentNameExists(name: string): boolean {
  const fragments = getCustomFragments()
  return fragments.some(f => f.name.toLowerCase() === name.toLowerCase())
}

/**
 * Export all custom fragments as JSON
 */
export function exportCustomFragments(): string {
  const fragments = getCustomFragments()
  return JSON.stringify(fragments, null, 2)
}

/**
 * Import custom fragments from JSON
 */
export function importCustomFragments(json: string): number {
  try {
    const imported = JSON.parse(json) as CustomFragment[]
    if (!Array.isArray(imported)) return 0
    
    const existing = getCustomFragments()
    const existingNames = new Set(existing.map(f => f.name.toLowerCase()))
    
    let added = 0
    for (const fragment of imported) {
      // Need either smiles or atoms data
      if (!fragment.name || (!fragment.smiles && !fragment.atoms)) continue
      if (existingNames.has(fragment.name.toLowerCase())) continue
      
      saveCustomFragment({
        name: fragment.name,
        smiles: fragment.smiles,
        formula: fragment.formula,
        atoms: fragment.atoms,
        bonds: fragment.bonds,
        attachmentIndex: fragment.attachmentIndex,
      })
      added++
    }
    
    return added
  } catch {
    return 0
  }
}

/**
 * Clear all custom fragments
 */
export function clearCustomFragments(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
  invalidate()
}
