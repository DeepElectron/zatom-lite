// SMILES parser utility using smiles-drawer library
// This converts SMILES strings to 2D molecular structures

// Types for parsed molecule data
export interface Atom2D {
  id: string
  element: string
  x: number
  y: number
  charge?: number
  hydrogenCount?: number
}

export interface Bond2D {
  id: string
  atom1Id: string
  atom2Id: string
  type: 'single' | 'double' | 'triple' | 'aromatic'
}

export interface Molecule2D {
  atoms: Atom2D[]
  bonds: Bond2D[]
  width: number
  height: number
}

type SmilesDrawerGraph = {
  vertices: Iterable<[number, {
    value?: { atomicNumber?: number; charge?: number; hydrogenCount?: number }
    position?: { x?: number; y?: number }
  }]>
  edges: Iterable<[number, {
    sourceId: number
    targetId: number
    bondType?: string | number
  }]>
}

// Element mapping from atomic number
const ELEMENT_MAP: Record<number, string> = {
  1: 'H', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 15: 'P', 16: 'S', 17: 'Cl', 35: 'Br', 53: 'I'
}

// Pre-optimized molecular templates with correct 2D coordinates (in Angstroms)
// These are chemically accurate representations
const MOLECULE_TEMPLATES: Record<string, Molecule2D> = {
  // Methane - CH4 (tetrahedral, but 2D projection)
  'C': {
    atoms: [
      { id: 'a0', element: 'C', x: 0, y: 0 },
    ],
    bonds: [],
    width: 1, height: 1
  },
  
  // Ethanol - C2H5OH
  'CCO': {
    atoms: [
      { id: 'a0', element: 'C', x: -1.2, y: 0 },
      { id: 'a1', element: 'C', x: 0, y: 0 },
      { id: 'a2', element: 'O', x: 1.2, y: 0 },
    ],
    bonds: [
      { id: 'b0', atom1Id: 'a0', atom2Id: 'a1', type: 'single' },
      { id: 'b1', atom1Id: 'a1', atom2Id: 'a2', type: 'single' },
    ],
    width: 2.4, height: 1
  },
  
  // Acetic acid - CH3COOH
  'CC(=O)O': {
    atoms: [
      { id: 'a0', element: 'C', x: -1.2, y: 0 },
      { id: 'a1', element: 'C', x: 0, y: 0 },
      { id: 'a2', element: 'O', x: 0.6, y: 1.0 },
      { id: 'a3', element: 'O', x: 1.0, y: -0.6 },
    ],
    bonds: [
      { id: 'b0', atom1Id: 'a0', atom2Id: 'a1', type: 'single' },
      { id: 'b1', atom1Id: 'a1', atom2Id: 'a2', type: 'double' },
      { id: 'b2', atom1Id: 'a1', atom2Id: 'a3', type: 'single' },
    ],
    width: 2.2, height: 1.6
  },
  
  // Benzene - regular hexagon
  'c1ccccc1': {
    atoms: [
      { id: 'a0', element: 'C', x: 1.4, y: 0 },
      { id: 'a1', element: 'C', x: 0.7, y: 1.21 },
      { id: 'a2', element: 'C', x: -0.7, y: 1.21 },
      { id: 'a3', element: 'C', x: -1.4, y: 0 },
      { id: 'a4', element: 'C', x: -0.7, y: -1.21 },
      { id: 'a5', element: 'C', x: 0.7, y: -1.21 },
    ],
    bonds: [
      { id: 'b0', atom1Id: 'a0', atom2Id: 'a1', type: 'aromatic' },
      { id: 'b1', atom1Id: 'a1', atom2Id: 'a2', type: 'aromatic' },
      { id: 'b2', atom1Id: 'a2', atom2Id: 'a3', type: 'aromatic' },
      { id: 'b3', atom1Id: 'a3', atom2Id: 'a4', type: 'aromatic' },
      { id: 'b4', atom1Id: 'a4', atom2Id: 'a5', type: 'aromatic' },
      { id: 'b5', atom1Id: 'a5', atom2Id: 'a0', type: 'aromatic' },
    ],
    width: 2.8, height: 2.42
  },
  
  // Aspirin - acetylsalicylic acid
  'CC(=O)Oc1ccccc1C(=O)O': {
    atoms: [
      // Acetyl group
      { id: 'a0', element: 'C', x: -3.5, y: 0.5 },
      { id: 'a1', element: 'C', x: -2.5, y: 0 },
      { id: 'a2', element: 'O', x: -2.5, y: -1.2 },
      { id: 'a3', element: 'O', x: -1.5, y: 0.6 },
      // Benzene ring
      { id: 'a4', element: 'C', x: -0.3, y: 0 },
      { id: 'a5', element: 'C', x: 0.7, y: 0.7 },
      { id: 'a6', element: 'C', x: 1.9, y: 0.35 },
      { id: 'a7', element: 'C', x: 2.1, y: -0.7 },
      { id: 'a8', element: 'C', x: 1.1, y: -1.4 },
      { id: 'a9', element: 'C', x: -0.1, y: -1.05 },
      // Carboxyl group
      { id: 'a10', element: 'C', x: 0.5, y: 1.9 },
      { id: 'a11', element: 'O', x: -0.3, y: 2.7 },
      { id: 'a12', element: 'O', x: 1.5, y: 2.3 },
    ],
    bonds: [
      { id: 'b0', atom1Id: 'a0', atom2Id: 'a1', type: 'single' },
      { id: 'b1', atom1Id: 'a1', atom2Id: 'a2', type: 'double' },
      { id: 'b2', atom1Id: 'a1', atom2Id: 'a3', type: 'single' },
      { id: 'b3', atom1Id: 'a3', atom2Id: 'a4', type: 'single' },
      { id: 'b4', atom1Id: 'a4', atom2Id: 'a5', type: 'aromatic' },
      { id: 'b5', atom1Id: 'a5', atom2Id: 'a6', type: 'aromatic' },
      { id: 'b6', atom1Id: 'a6', atom2Id: 'a7', type: 'aromatic' },
      { id: 'b7', atom1Id: 'a7', atom2Id: 'a8', type: 'aromatic' },
      { id: 'b8', atom1Id: 'a8', atom2Id: 'a9', type: 'aromatic' },
      { id: 'b9', atom1Id: 'a9', atom2Id: 'a4', type: 'aromatic' },
      { id: 'b10', atom1Id: 'a5', atom2Id: 'a10', type: 'single' },
      { id: 'b11', atom1Id: 'a10', atom2Id: 'a11', type: 'double' },
      { id: 'b12', atom1Id: 'a10', atom2Id: 'a12', type: 'single' },
    ],
    width: 5.6, height: 4.0
  },
  
  // Caffeine - 1,3,7-trimethylxanthine (fused purine rings)
  'Cn1cnc2c1c(=O)n(c(=O)n2C)C': {
    atoms: [
      // Imidazole ring (5-membered)
      { id: 'a0', element: 'C', x: -1.8, y: 1.0 },   // N1-methyl
      { id: 'a1', element: 'N', x: -0.8, y: 0.3 },   // N1
      { id: 'a2', element: 'C', x: -0.8, y: -0.9 },  // C2
      { id: 'a3', element: 'N', x: 0.3, y: -1.4 },   // N3
      { id: 'a4', element: 'C', x: 1.1, y: -0.4 },   // C4
      // Pyrimidine ring (6-membered) fused
      { id: 'a5', element: 'C', x: 0.5, y: 0.8 },    // C5
      { id: 'a6', element: 'C', x: 1.2, y: 2.0 },    // C6 (C=O)
      { id: 'a7', element: 'O', x: 0.6, y: 3.1 },    // O6
      { id: 'a8', element: 'N', x: 2.5, y: 2.0 },    // N7
      { id: 'a9', element: 'C', x: 3.3, y: 3.1 },    // N7-methyl
      { id: 'a10', element: 'C', x: 3.1, y: 0.8 },   // C8 (C=O)
      { id: 'a11', element: 'O', x: 4.2, y: 0.5 },   // O8
      { id: 'a12', element: 'N', x: 2.4, y: -0.3 },  // N9
      { id: 'a13', element: 'C', x: 2.9, y: -1.5 },  // N9-methyl
    ],
    bonds: [
      { id: 'b0', atom1Id: 'a0', atom2Id: 'a1', type: 'single' },  // N1-methyl
      { id: 'b1', atom1Id: 'a1', atom2Id: 'a2', type: 'single' },
      { id: 'b2', atom1Id: 'a2', atom2Id: 'a3', type: 'double' },
      { id: 'b3', atom1Id: 'a3', atom2Id: 'a4', type: 'single' },
      { id: 'b4', atom1Id: 'a4', atom2Id: 'a5', type: 'double' },
      { id: 'b5', atom1Id: 'a5', atom2Id: 'a1', type: 'single' },  // Close imidazole
      { id: 'b6', atom1Id: 'a5', atom2Id: 'a6', type: 'single' },
      { id: 'b7', atom1Id: 'a6', atom2Id: 'a7', type: 'double' },  // C=O
      { id: 'b8', atom1Id: 'a6', atom2Id: 'a8', type: 'single' },
      { id: 'b9', atom1Id: 'a8', atom2Id: 'a9', type: 'single' },  // N7-methyl
      { id: 'b10', atom1Id: 'a8', atom2Id: 'a10', type: 'single' },
      { id: 'b11', atom1Id: 'a10', atom2Id: 'a11', type: 'double' }, // C=O
      { id: 'b12', atom1Id: 'a10', atom2Id: 'a12', type: 'single' },
      { id: 'b13', atom1Id: 'a12', atom2Id: 'a13', type: 'single' }, // N9-methyl
      { id: 'b14', atom1Id: 'a12', atom2Id: 'a4', type: 'single' },  // Close pyrimidine
    ],
    width: 6.0, height: 4.6
  },
}

// Function to get template or null
function getMoleculeTemplate(smiles: string): Molecule2D | null {
  // Normalize SMILES for comparison (remove whitespace)
  const normalized = smiles.trim()
  
  // Check exact match
  if (MOLECULE_TEMPLATES[normalized]) {
    // Deep clone the template
    const template = MOLECULE_TEMPLATES[normalized]
    return {
      atoms: template.atoms.map(a => ({ ...a, id: `atom-${a.id}` })),
      bonds: template.bonds.map(b => ({ 
        ...b, 
        id: `bond-${b.id}`,
        atom1Id: `atom-${b.atom1Id}`,
        atom2Id: `atom-${b.atom2Id}`
      })),
      width: template.width,
      height: template.height
    }
  }
  
  return null
}

// Parse SMILES using smiles-drawer
export async function parseSMILES(smiles: string): Promise<Molecule2D | null> {
  // First, check if we have a pre-optimized template
  const template = getMoleculeTemplate(smiles)
  if (template) {
    return template
  }
  
  try {
    // Dynamically import smiles-drawer (it's a browser library)
    const SmilesDrawer = (await import('smiles-drawer')).default
    
    // Parse the SMILES string
    const tree = SmilesDrawer.Parser.parse(smiles)
    
    if (!tree) {
      console.error('[zatom] Failed to parse SMILES:', smiles)
      return null
    }

    // Get the processed molecule data
    const drawer = new SmilesDrawer.Drawer({ width: 400, height: 400 })
    drawer.draw(tree, 'temp-canvas', 'light', false)
    
    // Extract atoms and bonds from the drawer's graph
    const graph = (drawer as unknown as { graph?: SmilesDrawerGraph }).graph
    if (!graph) {
      return null
    }

    const atoms: Atom2D[] = []
    const bonds: Bond2D[] = []
    const vertexIdMap = new Map<number, string>()

    // Process vertices (atoms)
    for (const [id, vertex] of graph.vertices) {
      const atomId = `atom-${id}`
      vertexIdMap.set(id, atomId)
      
      const element = ELEMENT_MAP[vertex.value?.atomicNumber || 6] || 'C'
      
      atoms.push({
        id: atomId,
        element,
        x: vertex.position?.x || 0,
        y: vertex.position?.y || 0,
        charge: vertex.value?.charge,
        hydrogenCount: vertex.value?.hydrogenCount
      })
    }

    // Process edges (bonds)
    let bondIdx = 0
    for (const [, edge] of graph.edges) {
      const atom1Id = vertexIdMap.get(edge.sourceId)
      const atom2Id = vertexIdMap.get(edge.targetId)
      
      if (atom1Id && atom2Id) {
        let bondType: Bond2D['type'] = 'single'
        if (edge.bondType === '=' || edge.bondType === 2) bondType = 'double'
        else if (edge.bondType === '#' || edge.bondType === 3) bondType = 'triple'
        else if (edge.bondType === ':') bondType = 'aromatic'
        
        bonds.push({
          id: `bond-${bondIdx++}`,
          atom1Id,
          atom2Id,
          type: bondType
        })
      }
    }

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const atom of atoms) {
      minX = Math.min(minX, atom.x)
      maxX = Math.max(maxX, atom.x)
      minY = Math.min(minY, atom.y)
      maxY = Math.max(maxY, atom.y)
    }

    // Normalize coordinates to center around origin
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    for (const atom of atoms) {
      atom.x -= centerX
      atom.y -= centerY
    }

    return {
      atoms,
      bonds,
      width: maxX - minX,
      height: maxY - minY
    }
  } catch (error) {
    console.error('[zatom] Error parsing SMILES:', error)
    return null
  }
}

// Simple SMILES parser fallback (for basic molecules)
// This is a simplified parser that handles basic SMILES without the full library
export function parseSimpleSMILES(smiles: string): Molecule2D | null {
  // First, check if we have a pre-optimized template
  const template = getMoleculeTemplate(smiles)
  if (template) {
    return template
  }
  
  const atoms: Atom2D[] = []
  const bonds: Bond2D[] = []
  
  // Stack for handling branches
  const branchStack: number[] = []
  let currentAtomIdx = -1
  let i = 0
  let bondType: Bond2D['type'] = 'single'
  
  // Ring closures map
  const ringClosures = new Map<string, number>()
  
  while (i < smiles.length) {
    const char = smiles[i]
    
    // Handle bond types
    if (char === '=') {
      bondType = 'double'
      i++
      continue
    }
    if (char === '#') {
      bondType = 'triple'
      i++
      continue
    }
    
    // Handle branches
    if (char === '(') {
      branchStack.push(currentAtomIdx)
      i++
      continue
    }
    if (char === ')') {
      currentAtomIdx = branchStack.pop() ?? -1
      i++
      continue
    }
    
    // Handle ring closures
    if (/\d/.test(char)) {
      const ringNum = char
      if (ringClosures.has(ringNum)) {
        const otherIdx = ringClosures.get(ringNum)!
        bonds.push({
          id: `bond-${bonds.length}`,
          atom1Id: atoms[currentAtomIdx].id,
          atom2Id: atoms[otherIdx].id,
          type: 'single'
        })
        ringClosures.delete(ringNum)
      } else {
        ringClosures.set(ringNum, currentAtomIdx)
      }
      i++
      continue
    }
    
    // Handle atoms
    let element = ''
    if (char === '[') {
      // Bracketed atom
      const endBracket = smiles.indexOf(']', i)
      const bracketContent = smiles.slice(i + 1, endBracket)
      // Extract element (simplified)
      const elemMatch = bracketContent.match(/^([A-Z][a-z]?)/)
      element = elemMatch ? elemMatch[1] : 'C'
      i = endBracket + 1
    } else if (/[A-Z]/.test(char)) {
      // Organic subset - check for two-letter elements (Cl, Br, etc.)
      // BUT not aromatic atoms (c, n, o, s, p) which are lowercase single letters
      const nextChar = i + 1 < smiles.length ? smiles[i + 1] : ''
      const aromaticAtoms = ['c', 'n', 'o', 's', 'p']
      if (nextChar && /[a-z]/.test(nextChar) && !aromaticAtoms.includes(nextChar)) {
        // Two-letter element like Cl, Br, Si, etc.
        element = char + nextChar
        i += 2
      } else {
        element = char
        i++
      }
    } else if (/[a-z]/.test(char)) {
      // Aromatic atoms (c, n, o, s, p)
      element = char.toUpperCase()
      i++
    } else {
      i++
      continue
    }
    
    // Map common elements
    const elementMap: Record<string, string> = {
      'c': 'C', 'n': 'N', 'o': 'O', 's': 'S'
    }
    element = elementMap[element.toLowerCase()] || element
    
    // Create atom with simple linear positioning (will be laid out later)
    const atomId = `atom-${atoms.length}`
    const newAtomIdx = atoms.length
    
    atoms.push({
      id: atomId,
      element,
      x: atoms.length * 1.5,  // Angstroms, will be relaid by layoutMolecule2D
      y: 0
    })
    
    // Create bond to previous atom
    if (currentAtomIdx >= 0) {
      bonds.push({
        id: `bond-${bonds.length}`,
        atom1Id: atoms[currentAtomIdx].id,
        atom2Id: atomId,
        type: bondType
      })
    }
    
    currentAtomIdx = newAtomIdx
    bondType = 'single' // Reset bond type
  }
  
  if (atoms.length === 0) return null
  
  // Apply simple 2D layout
  layoutMolecule2D(atoms, bonds)
  
  return {
    atoms,
    bonds,
    width: Math.max(...atoms.map(a => a.x)) - Math.min(...atoms.map(a => a.x)),
    height: Math.max(...atoms.map(a => a.y)) - Math.min(...atoms.map(a => a.y))
  }
}

// 2D layout using spring-embedder force-directed algorithm
// All coordinates are in Angstroms for direct use in 3D insertion
function layoutMolecule2D(atoms: Atom2D[], bonds: Bond2D[]): void {
  if (atoms.length === 0) return
  if (atoms.length === 1) {
    atoms[0].x = 0
    atoms[0].y = 0
    return
  }
  
  const BOND_LENGTH = 1.4  // Angstroms - target bond length
  
  // Build adjacency list
  const adjacency = new Map<string, Set<string>>()
  for (const atom of atoms) {
    adjacency.set(atom.id, new Set())
  }
  for (const bond of bonds) {
    adjacency.get(bond.atom1Id)?.add(bond.atom2Id)
    adjacency.get(bond.atom2Id)?.add(bond.atom1Id)
  }
  
  const atomMap = new Map<string, Atom2D>()
  const atomIndex = new Map<string, number>()
  atoms.forEach((atom, i) => {
    atomMap.set(atom.id, atom)
    atomIndex.set(atom.id, i)
  })
  
  // Find smallest rings using BFS from each edge
  const rings: string[][] = []
  const foundRingSigs = new Set<string>()
  
  for (const bond of bonds) {
    // Try to find a ring that includes this bond
    const start = bond.atom1Id
    const end = bond.atom2Id
    
    // BFS to find shortest path from end back to start (not using this edge)
    const queue: { node: string; path: string[] }[] = [{ node: end, path: [end] }]
    const visited = new Set<string>([end])
    
    while (queue.length > 0) {
      const { node, path } = queue.shift()!
      if (path.length > 7) continue // Limit ring size
      
      const neighbors = adjacency.get(node) || new Set()
      for (const neighbor of neighbors) {
        if (neighbor === start && path.length >= 2) {
          // Found a ring
          const ring = [start, ...path]
          const sig = [...ring].sort().join(',')
          if (!foundRingSigs.has(sig)) {
            foundRingSigs.add(sig)
            rings.push(ring)
          }
          continue
        }
        if (visited.has(neighbor)) continue
        if (neighbor === start && path.length < 2) continue // Too short
        
        visited.add(neighbor)
        queue.push({ node: neighbor, path: [...path, neighbor] })
      }
    }
  }
  
  // Sort rings by size
  rings.sort((a, b) => a.length - b.length)
  
  // Mark atoms that belong to rings
  const ringAtomSet = new Set<string>()
  const atomRings = new Map<string, number[]>()
  rings.forEach((ring, ri) => {
    ring.forEach(atomId => {
      ringAtomSet.add(atomId)
      if (!atomRings.has(atomId)) atomRings.set(atomId, [])
      atomRings.get(atomId)!.push(ri)
    })
  })
  
  // Initial layout: circular for single component
  const n = atoms.length
  const initRadius = BOND_LENGTH * n / (2 * Math.PI)
  atoms.forEach((atom, i) => {
    const angle = (2 * Math.PI * i) / n
    atom.x = initRadius * Math.cos(angle)
    atom.y = initRadius * Math.sin(angle)
  })
  
  // Force-directed layout
  const iterations = 300
  const coolingFactor = 0.95
  let temperature = BOND_LENGTH * 2
  
  for (let iter = 0; iter < iterations; iter++) {
    const forces: { fx: number; fy: number }[] = atoms.map(() => ({ fx: 0, fy: 0 }))
    
    // Repulsive forces between all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = atoms[j].x - atoms[i].x
        const dy = atoms[j].y - atoms[i].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        
        // Coulomb-like repulsion
        const repulsion = (BOND_LENGTH * BOND_LENGTH) / dist
        const fx = (dx / dist) * repulsion
        const fy = (dy / dist) * repulsion
        
        forces[i].fx -= fx
        forces[i].fy -= fy
        forces[j].fx += fx
        forces[j].fy += fy
      }
    }
    
    // Attractive forces along bonds (spring)
    for (const bond of bonds) {
      const i = atomIndex.get(bond.atom1Id)!
      const j = atomIndex.get(bond.atom2Id)!
      
      const dx = atoms[j].x - atoms[i].x
      const dy = atoms[j].y - atoms[i].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      
      // Hooke's law - pull towards ideal length
      const displacement = dist - BOND_LENGTH
      const attraction = displacement * 0.5
      const fx = (dx / dist) * attraction
      const fy = (dy / dist) * attraction
      
      forces[i].fx += fx
      forces[i].fy += fy
      forces[j].fx -= fx
      forces[j].fy -= fy
    }
    
    // Ring planarity constraint - keep ring atoms coplanar with regular angles
    for (const ring of rings) {
      const ringN = ring.length
      // Calculate ring centroid
      let cx = 0, cy = 0
      for (const atomId of ring) {
        const atom = atomMap.get(atomId)!
        cx += atom.x
        cy += atom.y
      }
      cx /= ringN
      cy /= ringN
      
      // Target radius for regular polygon
      const targetRadius = BOND_LENGTH / (2 * Math.sin(Math.PI / ringN))
      
      // Pull each ring atom towards its ideal position
      ring.forEach((atomId) => {
        const atom = atomMap.get(atomId)!
        const i = atomIndex.get(atomId)!
        
        // Current angle from center
        const currentAngle = Math.atan2(atom.y - cy, atom.x - cx)
        
        // Ideal position at this angle but at correct radius
        const idealX = cx + targetRadius * Math.cos(currentAngle)
        const idealY = cy + targetRadius * Math.sin(currentAngle)
        
        // Pull towards ideal
        forces[i].fx += (idealX - atom.x) * 0.3
        forces[i].fy += (idealY - atom.y) * 0.3
      })
    }
    
    // Apply forces with temperature limit
    for (let i = 0; i < n; i++) {
      const fx = forces[i].fx
      const fy = forces[i].fy
      const len = Math.sqrt(fx * fx + fy * fy) || 1
      
      // Limit displacement by temperature
      const scale = Math.min(len, temperature) / len
      atoms[i].x += fx * scale
      atoms[i].y += fy * scale
    }
    
    temperature *= coolingFactor
  }
  
  // Final pass: enforce exact bond lengths
  for (let pass = 0; pass < 50; pass++) {
    for (const bond of bonds) {
      const a1 = atomMap.get(bond.atom1Id)!
      const a2 = atomMap.get(bond.atom2Id)!
      
      const dx = a2.x - a1.x
      const dy = a2.y - a1.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      
      const error = (dist - BOND_LENGTH) / 2
      const nx = dx / dist
      const ny = dy / dist
      
      a1.x += nx * error * 0.5
      a1.y += ny * error * 0.5
      a2.x -= nx * error * 0.5
      a2.y -= ny * error * 0.5
    }
  }
  
  // Center the molecule
  const centerX = atoms.reduce((sum, a) => sum + a.x, 0) / n
  const centerY = atoms.reduce((sum, a) => sum + a.y, 0) / n
  for (const atom of atoms) {
    atom.x -= centerX
    atom.y -= centerY
  }
}

// Standard valences for common elements
const STANDARD_VALENCE: Record<string, number> = {
  'H': 1, 'C': 4, 'N': 3, 'O': 2, 'F': 1, 'P': 3, 'S': 2, 'Cl': 1, 'Br': 1, 'I': 1, 'Si': 4
}

// Bond order mapping
const BOND_ORDER: Record<string, number> = {
  'single': 1, 'double': 2, 'triple': 3, 'aromatic': 1.5
}

// Add hydrogen atoms to a molecule based on standard valences
export function addHydrogensToMolecule(molecule: Molecule2D): Molecule2D {
  const atoms = [...molecule.atoms]
  const bonds = [...molecule.bonds]
  
  // Calculate current bond count for each atom
  const bondCounts = new Map<string, number>()
  for (const atom of atoms) {
    bondCounts.set(atom.id, 0)
  }
  
  for (const bond of bonds) {
    const order = BOND_ORDER[bond.type] || 1
    bondCounts.set(bond.atom1Id, (bondCounts.get(bond.atom1Id) || 0) + order)
    bondCounts.set(bond.atom2Id, (bondCounts.get(bond.atom2Id) || 0) + order)
  }
  
  // For aromatic rings, adjust valence (each aromatic C has 1.5*2=3 bonds + 1H)
  let hydrogenIndex = 0
  const H_BOND_LENGTH = 1.0  // Angstroms
  
  for (const atom of molecule.atoms) {
    // Skip if already hydrogen
    if (atom.element === 'H') continue
    
    const standardValence = STANDARD_VALENCE[atom.element]
    if (!standardValence) continue
    
    const currentBonds = Math.round(bondCounts.get(atom.id) || 0)
    const hydrogenCount = standardValence - currentBonds - (atom.charge || 0)
    
    if (hydrogenCount <= 0) continue
    
    // Find neighboring atoms to determine placement
    const neighbors: { x: number; y: number }[] = []
    for (const bond of bonds) {
      if (bond.atom1Id === atom.id) {
        const neighbor = molecule.atoms.find(a => a.id === bond.atom2Id)
        if (neighbor) neighbors.push({ x: neighbor.x, y: neighbor.y })
      } else if (bond.atom2Id === atom.id) {
        const neighbor = molecule.atoms.find(a => a.id === bond.atom1Id)
        if (neighbor) neighbors.push({ x: neighbor.x, y: neighbor.y })
      }
    }
    
    // Calculate average direction away from neighbors
    let avgDx = 0, avgDy = 0
    if (neighbors.length > 0) {
      for (const n of neighbors) {
        avgDx += atom.x - n.x
        avgDy += atom.y - n.y
      }
      avgDx /= neighbors.length
      avgDy /= neighbors.length
    } else {
      // No neighbors, place hydrogens around
      avgDx = 1
      avgDy = 0
    }
    
    // Normalize
    const len = Math.sqrt(avgDx * avgDx + avgDy * avgDy) || 1
    avgDx /= len
    avgDy /= len
    
    // Place hydrogens
    for (let h = 0; h < hydrogenCount; h++) {
      // Spread hydrogens evenly if multiple
      const angleOffset = ((h - (hydrogenCount - 1) / 2) * Math.PI / 4)
      const baseAngle = Math.atan2(avgDy, avgDx)
      const angle = baseAngle + angleOffset
      
      const hx = atom.x + H_BOND_LENGTH * Math.cos(angle)
      const hy = atom.y + H_BOND_LENGTH * Math.sin(angle)
      
      const hId = `atom-h${hydrogenIndex++}`
      atoms.push({
        id: hId,
        element: 'H',
        x: hx,
        y: hy
      })
      
      bonds.push({
        id: `bond-h${bonds.length}`,
        atom1Id: atom.id,
        atom2Id: hId,
        type: 'single'
      })
    }
  }
  
  // Recalculate bounds
  const minX = Math.min(...atoms.map(a => a.x))
  const maxX = Math.max(...atoms.map(a => a.x))
  const minY = Math.min(...atoms.map(a => a.y))
  const maxY = Math.max(...atoms.map(a => a.y))
  
  return {
    atoms,
    bonds,
    width: maxX - minX,
    height: maxY - minY
  }
}

// Convert 2D molecule to 3D coordinates
export function convert2Dto3D(molecule: Molecule2D, scale: number = 0.05): {
  atoms: { id: string; element: string; position: [number, number, number] }[]
  bonds: { atom1Id: string; atom2Id: string; type: string }[]
} {
  // Scale 2D coordinates and place in XY plane (z = 0)
  const atoms = molecule.atoms.map(atom => ({
    id: atom.id,
    element: atom.element,
    position: [atom.x * scale, -atom.y * scale, 0] as [number, number, number]
  }))
  
  const bonds = molecule.bonds.map(bond => ({
    atom1Id: bond.atom1Id,
    atom2Id: bond.atom2Id,
    type: bond.type === 'aromatic' ? 'single' : bond.type
  }))
  
  return { atoms, bonds }
}

// Shared exports used by the 2D structure inspector.
// ——————————————————————————————————————————————————————————
// Keep existing parser and 2D-to-3D entry-point signatures stable.

/** Standard element valence exposed to the structure-inspection UI. */
export const ELEMENT_STANDARD_VALENCE: Record<string, number> = { ...STANDARD_VALENCE }

/** Bond-order mapping: single 1, double 2, triple 3, aromatic 1.5. */
export function bondOrderOf(type: Bond2D['type']): number {
  return BOND_ORDER[type] ?? 1
}

/** Calculate a molecular formula in Hill order. */
export function computeMolecularFormula(atoms: Pick<Atom2D, 'element'>[]): string {
  const counts = new Map<string, number>()
  for (const a of atoms) {
    counts.set(a.element, (counts.get(a.element) || 0) + 1)
  }
  if (counts.size === 0) return ''
  // Hill system: first C, then H, and the rest in alphabetical order
  const ordered: string[] = []
  if (counts.has('C')) ordered.push('C')
  if (counts.has('H')) ordered.push('H')
  for (const el of Array.from(counts.keys()).sort()) {
    if (el !== 'C' && el !== 'H') ordered.push(el)
  }
  return ordered
    .map((el) => {
      const n = counts.get(el)!
      return n > 1 ? `${el}${n}` : el
    })
    .join('')
}

/** Valence plausibility result for one atom. */
export interface ValenceIssue {
  atomId: string
  element: string
  /** Current bond-order sum; aromatic bonds contribute 1.5. */
  current: number
  /** Standard valence for this element. */
  expected: number
  /** Overbonded, underbonded, or unavailable standard-valence data. */
  kind: 'over' | 'under' | 'unknown'
}

/**
 * Compare each nonhydrogen atom's bond-order sum with its standard valence.
 * Unknown elements, including many metals, are reported but not treated as errors.
 */
export function checkValence(molecule: Molecule2D): ValenceIssue[] {
  const order = new Map<string, number>()
  for (const a of molecule.atoms) order.set(a.id, 0)
  for (const b of molecule.bonds) {
    const o = BOND_ORDER[b.type] ?? 1
    order.set(b.atom1Id, (order.get(b.atom1Id) || 0) + o)
    order.set(b.atom2Id, (order.get(b.atom2Id) || 0) + o)
  }
  const issues: ValenceIssue[] = []
  for (const atom of molecule.atoms) {
    const current = Math.round((order.get(atom.id) || 0) * 2) / 2 // half integer (aromatic)
    const expected = STANDARD_VALENCE[atom.element]
    if (expected === undefined) {
      // Report unknown valence only when the atom participates in a bond.
      if (current > 0) issues.push({ atomId: atom.id, element: atom.element, current, expected: 0, kind: 'unknown' })
      continue
    }
    // Aromatic carbon at order ≈3 can be completed by implicit hydrogen.
    const rounded = Math.round(current)
    if (rounded > expected) {
      issues.push({ atomId: atom.id, element: atom.element, current: rounded, expected, kind: 'over' })
    } else if (rounded < expected) {
      issues.push({ atomId: atom.id, element: atom.element, current: rounded, expected, kind: 'under' })
    }
  }
  return issues
}

// Common SMILES examples
export const SMILES_EXAMPLES = [
  { name: 'Methane', smiles: 'C', formula: 'CH4' },
  { name: 'Ethanol', smiles: 'CCO', formula: 'C2H5OH' },
  { name: 'Acetic acid', smiles: 'CC(=O)O', formula: 'CH3COOH' },
  { name: 'Benzene', smiles: 'c1ccccc1', formula: 'C6H6' },
  { name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', formula: 'C9H8O4' },
  { name: 'Caffeine', smiles: 'Cn1cnc2c1c(=O)n(c(=O)n2C)C', formula: 'C8H10N4O2' },
  { name: 'Glucose', smiles: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', formula: 'C6H12O6' },
  { name: 'Water', smiles: 'O', formula: 'H2O' },
  { name: 'Ammonia', smiles: 'N', formula: 'NH3' },
  { name: 'Propane', smiles: 'CCC', formula: 'C3H8' },
]
