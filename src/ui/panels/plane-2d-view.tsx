"use client"

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { parseSimpleSMILES, addHydrogensToMolecule, type Molecule2D } from '../../lib/molecule/smiles-parser'
import { getCustomFragments, type CustomFragment } from '../../lib/molecule/custom-fragments'
import { buildPlaneBasis, computeProjectedAtoms, computeProjectedMirrorAtoms, computeProjectedBonds, computeProjectedLatticeEdges, computeSnapPoints, computeDynamicConnections, convert2DMoleculeTo3D, convert2DMoleculeAtOrigin } from '../../lib/plane/plane-projection'
import { edgeImageOffsets } from '../../lib/crystal/display-periodic-images'
import { isValidLattice } from '../../lib/crystal/lattice-math'
import { MoleculeOverlay } from './components/molecule-overlay'
import { AtomsOnPlaneLayer } from './components/atoms-on-plane-layer'
import { PlaneCanvasSubstrate, LatticeEdgesLayer, BondsOnPlaneLayer, OffPlaneAtomsLayer, DynamicConnectionsLayer, SnapPointsLayer } from './components/plane-svg-layers'
import { MoleculeMultiSelectToolbar } from './components/molecule-multi-select-toolbar'
import { MoleculeInsertWithPlaneControls, MoleculeInsertAtOriginControls } from './components/molecule-insert-controls'
import { PlaneModeNoPlaneWarning, PlaneModeStatsActions } from './components/plane-mode-footer'
import { SmilesInputSection } from './components/smiles-input-section'
import { MoleculeToolBar } from './components/molecule-tool-bar'
import { Plane2DViewHeader, MoleculeEditorToggle } from './components/plane-2d-view-header'
import { PlaneCanvasToolBar } from './components/plane-tool-bars'
import { useWindowMouseTracking } from '../../ui-kit/index'

// Distance threshold to consider an atom "on the plane"
const ON_PLANE_THRESHOLD = 0.5

// Tool modes for molecule 2D editor
type MoleculeToolMode = 'select' | 'add-atom' | 'add-bond' | 'delete' | 'move-molecule'

// Floating 2D plane view window with atom creation capabilities
export function Plane2DView() {
  const constructedPlane = useCrystalStore(s => s.constructedPlane)
  const show2DPlaneView = useCrystalStore(s => s.show2DPlaneView)
  const setShow2DPlaneView = useCrystalStore(s => s.setShow2DPlaneView)
  const allAtoms = useCrystalStore(s => s.atoms)
  const allBonds = useCrystalStore(s => s.bonds)
  const latticeVectors = useCrystalStore(s => s.latticeVectors)
  const supercellParams = useCrystalStore(s => s.supercellParams)
  const periodic = useCrystalStore(s => s.periodic)
  const periodicDirs = useCrystalStore(s => s.periodicDirs)

  // Memoize local-atom filtering; filtering inside the selector can loop.
  const atoms = useMemo(() => {
    if (!constructedPlane?.localRadius) return allAtoms
    const lr2 = constructedPlane.localRadius * constructedPlane.localRadius
    const [cx, cy, cz] = constructedPlane.center
    return allAtoms.filter(a => {
      if (!a.cartesian) return false
      const dx = a.cartesian[0] - cx, dy = a.cartesian[1] - cy, dz = a.cartesian[2] - cz
      return dx * dx + dy * dy + dz * dz <= lr2
    })
  }, [allAtoms, constructedPlane])

  const bonds = useMemo(() => {
    if (!constructedPlane?.localRadius) return allBonds
    const localIds = new Set(atoms.map(a => a.id))
    return allBonds.filter(b => localIds.has(b.atom1Id) && localIds.has(b.atom2Id))
  }, [allBonds, atoms, constructedPlane])
  const selectedAtomIds = useCrystalStore(s => s.selectedAtomIds)
  const selectAtomsOnPlaneSide = useCrystalStore(s => s.selectAtomsOnPlaneSide)
  const toolMode = useCrystalStore(s => s.toolMode)
  const addAtomToSupercell = useCrystalStore(s => s.addAtomToSupercell)
  const undo = useCrystalStore(s => s.undo)
  const canUndo = useCrystalStore(s => s.canUndo)
  const setAtomsDirectly = useCrystalStore(s => s.setAtomsDirectly)
  const setBondsDirectly = useCrystalStore(s => s.setBondsDirectly)
  const selectedElement = useCrystalStore(s => s.selectedElement)
  const setSelectedElement = useCrystalStore(s => s.setSelectedElement)
  
  const [isLocked, setIsLocked] = useState(false)
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [showOffPlaneAtoms, setShowOffPlaneAtoms] = useState(false)
  
  // Window resize state
  const [windowSize, setWindowSize] = useState({ width: 280, height: 320 })
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 })
  
  // Canvas zoom state
  const [zoomLevel, setZoomLevel] = useState(1)
  
  // Multi-select and transform state
  const [multiSelectedAtomIds, setMultiSelectedAtomIds] = useState<Set<string>>(new Set())
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [translateStart, setTranslateStart] = useState({ x: 0, y: 0 })
  
  // Canvas panning state (when locked)
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  
  // Window dragging state (when not locked)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  // Snap settings
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapDivision, setSnapDivision] = useState(2)
  const [showSnapPoints, setShowSnapPoints] = useState(true)
  
  // Atom creation (crystal mode) - selectedElement is from store for sync with 3D view
  const [hoveredSnapPoint, setHoveredSnapPoint] = useState<{x: number, y: number, x3d: number, y3d: number, z3d: number, type: string} | null>(null)
  
  // Show molecule editor (collapsed by default)
  const [showMoleculeEditor, setShowMoleculeEditor] = useState(false)
  
  // Molecule 2D editor state
  const [smilesInput, setSmilesInput] = useState('')
  const [molecule2D, setMolecule2D] = useState<Molecule2D | null>(null)
  const [autoAddHydrogen, setAutoAddHydrogen] = useState(false)
  const [mol2DToolMode, setMol2DToolMode] = useState<MoleculeToolMode>('select')
  const [mol2DSelectedElement, setMol2DSelectedElement] = useState('C')
  const [mol2DSelectedBondType, setMol2DSelectedBondType] = useState<'single' | 'double' | 'triple'>('single')
  const [mol2DSelectedAtomId, setMol2DSelectedAtomId] = useState<string | null>(null)
  const [mol2DPendingBondAtom, setMol2DPendingBondAtom] = useState<string | null>(null)
  const [insertRotation, setInsertRotation] = useState(0) // rotation angle for insertion
  const mol2DScale = 50 // Manual molecule editing scale in pixels per angstrom.
  
  // Molecule dragging state (for move-molecule tool)
  const [isDraggingMolecule, setIsDraggingMolecule] = useState(false)
  const [moleculeDragStart, setMoleculeDragStart] = useState({ x: 0, y: 0 })
  const [moleculeOffset, setMoleculeOffset] = useState({ x: 0, y: 0 }) // accumulated offset from original position
  
  // SmilesInputSection owns custom-library and save-dialog state.
  const [customFragments, setCustomFragments] = useState<CustomFragment[]>([])
  
  // Load custom fragments on mount
  useEffect(() => {
    setCustomFragments(getCustomFragments())
  }, [])
  
  // Hover state for dynamic connection lines
  const [hoveredAtomId, setHoveredAtomId] = useState<string | null>(null)
  const [isHoveringConnectionArea, setIsHoveringConnectionArea] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (snapEnabled) return
    setHoveredSnapPoint(null)
    setHoveredAtomId(null)
    setIsHoveringConnectionArea(false)
  }, [snapEnabled])

  const svgRef = useRef<SVGSVGElement>(null)
  
  // Handle atom hover with delay for leaving
  const handleAtomEnter = useCallback((atomId: string) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setHoveredAtomId(atomId)
    setIsHoveringConnectionArea(true)
  }, [])
  
  const handleAtomLeave = useCallback(() => {
    // Delay clearing to allow mouse to reach connection lines
    hoverTimeoutRef.current = setTimeout(() => {
      if (!isHoveringConnectionArea) {
        setHoveredAtomId(null)
      }
    }, 300)
  }, [isHoveringConnectionArea])
  
  const handleConnectionAreaEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHoveringConnectionArea(true)
  }, [])
  
  const handleConnectionAreaLeave = useCallback(() => {
    setIsHoveringConnectionArea(false)
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredAtomId(null)
    }, 200)
  }, [])

  // Plane-basis math lives in lib/plane/plane-projection.
  const planeBasis = useMemo(() => buildPlaneBasis(constructedPlane), [constructedPlane])

  // Project atoms onto the plane
  const projectedAtoms = useMemo(
    () => computeProjectedAtoms(planeBasis, constructedPlane, atoms, selectedAtomIds, ON_PLANE_THRESHOLD),
    [planeBasis, constructedPlane, atoms, selectedAtomIds],
  )

  // Project the same edge-image offsets used in 3D. The 2D analysis toggle is
  // independent because periodic equivalents remain analytically useful.
  const [showMirrorAtoms, setShowMirrorAtoms] = useState(true)
  const projectedMirrors = useMemo(() => {
    if (!periodic || !isValidLattice(latticeVectors)) return []
    const nx = Math.max(1, supercellParams?.nx ?? 1)
    const ny = Math.max(1, supercellParams?.ny ?? 1)
    const nz = Math.max(1, supercellParams?.nz ?? 1)
  // The display box is the lattice scaled by supercell repeats.
    const displayBox = {
      a: [latticeVectors.a[0] * nx, latticeVectors.a[1] * nx, latticeVectors.a[2] * nx] as [number, number, number],
      b: [latticeVectors.b[0] * ny, latticeVectors.b[1] * ny, latticeVectors.b[2] * ny] as [number, number, number],
      c: [latticeVectors.c[0] * nz, latticeVectors.c[1] * nz, latticeVectors.c[2] * nz] as [number, number, number],
    }
    const offsets = edgeImageOffsets(atoms, displayBox, periodicDirs)
    return computeProjectedMirrorAtoms(planeBasis, atoms, offsets, displayBox, ON_PLANE_THRESHOLD)
  }, [planeBasis, atoms, periodic, periodicDirs, latticeVectors, supercellParams])

  // Generate snap points based on lattice intersections, edges and bonds on the plane
  const snapPoints = useMemo(
    () => computeSnapPoints(planeBasis, snapEnabled && showSnapPoints, projectedAtoms.onPlane, bonds, atoms, latticeVectors, supercellParams, snapDivision, ON_PLANE_THRESHOLD),
    [planeBasis, snapEnabled, showSnapPoints, projectedAtoms.onPlane, bonds, atoms, latticeVectors, supercellParams, snapDivision],
  )

  const projectedLatticeEdges = useMemo(
    () => computeProjectedLatticeEdges(planeBasis, latticeVectors, supercellParams, ON_PLANE_THRESHOLD),
    [planeBasis, latticeVectors, supercellParams],
  )

  const projectedBonds = useMemo(
    () => computeProjectedBonds(planeBasis, bonds, atoms, ON_PLANE_THRESHOLD),
    [planeBasis, bonds, atoms],
  )

  // Dynamic connection lines from hovered atom to all nearby atoms on plane
  const dynamicConnections = useMemo(() => {
    if (!snapEnabled || !hoveredAtomId || !planeBasis || !isLocked || toolMode !== 'add-atom') return { lines: [], snapPoints: [] }
    const hoveredAtom = projectedAtoms.onPlane.find(a => a.id === hoveredAtomId) ?? null
    return computeDynamicConnections(hoveredAtom, hoveredAtomId, projectedAtoms.onPlane, atoms, snapDivision)
  }, [snapEnabled, hoveredAtomId, planeBasis, projectedAtoms.onPlane, atoms, snapDivision, isLocked, toolMode])

  // Window drag handlers
  const handleWindowMouseDown = (e: React.MouseEvent) => {
    if (isLocked) return
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('.canvas-area')) return
    
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleWindowMouseMove = (e: React.MouseEvent) => {
    if (isDragging && !isLocked) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
  }

  const handleWindowMouseUp = () => {
    setIsDragging(false)
  }

  // Canvas pan handlers (when locked)
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (!isLocked) return
    if (toolMode === 'add-atom') return // Don't pan in add-atom mode
    
    // Start molecule drag if in move-molecule mode
    if (mol2DToolMode === 'move-molecule' && molecule2D && molecule2D.atoms.length > 0) {
      setIsDraggingMolecule(true)
      setMoleculeDragStart({ x: e.clientX, y: e.clientY })
      return
    }
    
    setIsPanning(true)
    setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y })
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning && isLocked && mol2DToolMode !== 'move-molecule') {
      setCanvasOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    }
    
    // Handle molecule dragging (move-molecule tool) - using delta movement
    if (isDraggingMolecule && mol2DToolMode === 'move-molecule' && molecule2D) {
      // Calculate delta in screen pixels
      const deltaScreenX = e.clientX - moleculeDragStart.x
      const deltaScreenY = e.clientY - moleculeDragStart.y
      
      // Convert screen delta to lattice delta using current scale
      const { bounds } = projectedAtoms
      const padding = 2
      const rangeX = Math.max(bounds.maxX - bounds.minX + padding * 2, 4)
      const rangeY = Math.max(bounds.maxY - bounds.minY + padding * 2, 4)
      const viewSize = Math.min(windowSize.width - 40, windowSize.height - 120)
      const baseScale = Math.min(viewSize / rangeX, viewSize / rangeY) * 0.85
      const currentScale = baseScale * zoomLevel
      
      // Convert pixel delta to lattice units (Y is inverted in screen coords)
      const deltaLatticeX = deltaScreenX / currentScale
      const deltaLatticeY = -deltaScreenY / currentScale
      
      // Apply delta to current offset
      const finalX = moleculeOffset.x + deltaLatticeX
      const finalY = moleculeOffset.y + deltaLatticeY
      
      // Update drag start for next frame
      setMoleculeDragStart({ x: e.clientX, y: e.clientY })
      
      // Update offset (simple delta-based movement)
      setMoleculeOffset({ x: finalX, y: finalY })
    }
  }

  const handleCanvasMouseUp = () => {
    setIsPanning(false)
    setIsDraggingMolecule(false)
  }

  // Handle click on snap point to create atom
  const handleSnapPointClick = (point: {x3d: number, y3d: number, z3d: number}) => {
    if (!isLocked || toolMode !== 'add-atom') return
    
    // Add single atom to supercell at exact 3D position
    addAtomToSupercell(selectedElement, [point.x3d, point.y3d, point.z3d])
  }

  // Keyboard shortcut for undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (canUndo()) {
          undo()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, canUndo])

  // Parse SMILES input
  const handleParseSMILES = useCallback(() => {
    if (!smilesInput.trim()) return
    let result = parseSimpleSMILES(smilesInput.trim())
    if (result) {
      if (autoAddHydrogen) {
        result = addHydrogensToMolecule(result)
      }
      setMolecule2D(result)
      setMol2DSelectedAtomId(null)
      setMol2DPendingBondAtom(null)
    }
  }, [smilesInput, autoAddHydrogen])

  // Load example SMILES
  const handleLoadExample = useCallback((smiles: string) => {
    setSmilesInput(smiles)
    let result = parseSimpleSMILES(smiles)
    if (result) {
      if (autoAddHydrogen) {
        result = addHydrogensToMolecule(result)
      }
      setMolecule2D(result)
      setMol2DSelectedAtomId(null)
    }
  }, [autoAddHydrogen])

  // Toggle atom in multi-selection
  const toggleMultiSelect = useCallback((atomId: string) => {
    setMultiSelectedAtomIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(atomId)) {
        newSet.delete(atomId)
      } else {
        newSet.add(atomId)
      }
      return newSet
    })
  }, [])

  // Handle atom click in molecule 2D
  const handleMol2DAtomClick = useCallback((atomId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!molecule2D) return
    
    // Multi-select mode
    if (isMultiSelectMode) {
      toggleMultiSelect(atomId)
      return
    }
    
    if (mol2DToolMode === 'select') {
      setMol2DSelectedAtomId(atomId)
    } else if (mol2DToolMode === 'add-bond') {
      if (mol2DPendingBondAtom === null) {
        setMol2DPendingBondAtom(atomId)
      } else if (mol2DPendingBondAtom !== atomId) {
        // Create bond between pending atom and clicked atom
        const newBond = {
          id: `mol2d-bond-${Date.now()}`,
          atom1Id: mol2DPendingBondAtom,
          atom2Id: atomId,
          type: mol2DSelectedBondType,
        }
        setMolecule2D({
          ...molecule2D,
          bonds: [...molecule2D.bonds, newBond],
        })
        setMol2DPendingBondAtom(null)
      }
    } else if (mol2DToolMode === 'delete') {
      // Delete atom and its bonds
      setMolecule2D({
        ...molecule2D,
        atoms: molecule2D.atoms.filter(a => a.id !== atomId),
        bonds: molecule2D.bonds.filter(b => b.atom1Id !== atomId && b.atom2Id !== atomId),
      })
    }
  }, [molecule2D, mol2DToolMode, mol2DPendingBondAtom, mol2DSelectedBondType, isMultiSelectMode, toggleMultiSelect])

  // Insert molecule to 3D view at plane position
  const handleInsertTo3D = useCallback(() => {
    if (!molecule2D || !planeBasis) return
    const { newAtoms, newBonds } = convert2DMoleculeTo3D(
      molecule2D,
      planeBasis,
      insertRotation,
      moleculeOffset.x,
      moleculeOffset.y,
      Date.now(),
    )
    useCrystalStore.getState().clearBiomolecule()
    setAtomsDirectly([...atoms, ...newAtoms])
    setBondsDirectly([...bonds, ...newBonds])
    setMoleculeOffset({ x: 0, y: 0 })
    setShow2DPlaneView(false)
  }, [molecule2D, planeBasis, insertRotation, moleculeOffset, atoms, bonds, setAtomsDirectly, setBondsDirectly, setShow2DPlaneView])

  // Insert molecule to 3D view centered at origin (no plane available)
  const handleInsertAtOrigin = useCallback(() => {
    if (!molecule2D) return
    const { newAtoms, newBonds } = convert2DMoleculeAtOrigin(molecule2D, Date.now())
    useCrystalStore.getState().clearBiomolecule()
    setAtomsDirectly([...atoms, ...newAtoms])
    setBondsDirectly([...bonds, ...newBonds])
  }, [molecule2D, atoms, bonds, setAtomsDirectly, setBondsDirectly])

  // Clear molecule 2D
  const handleClearMolecule = useCallback(() => {
    setMolecule2D({ atoms: [], bonds: [], width: 0, height: 0 })
    setSmilesInput('')
    setMol2DSelectedAtomId(null)
    setMol2DPendingBondAtom(null)
  }, [])

  // Handle window resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, width: windowSize.width, height: windowSize.height })
  }, [windowSize])
  
  const handleResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const dx = e.clientX - resizeStart.x
    const dy = e.clientY - resizeStart.y
    setWindowSize({
      width: Math.max(240, Math.min(800, resizeStart.width + dx)),
      height: Math.max(280, Math.min(800, resizeStart.height + dy)),
    })
  }, [isResizing, resizeStart])
  
  const handleResizeMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])
  
  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY === 0) return
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setZoomLevel((previous) => {
      const next = Math.max(0.2, Math.min(5, previous * factor))
      return next
    })
  }, [])
  
  // Handle multi-select translation
  const handleTranslateStart = useCallback((e: React.MouseEvent) => {
    if (!isMultiSelectMode || multiSelectedAtomIds.size === 0) return
    e.stopPropagation()
    setIsTranslating(true)
    setTranslateStart({ x: e.clientX, y: e.clientY })
  }, [isMultiSelectMode, multiSelectedAtomIds])
  
  const handleTranslateMove = useCallback((e: MouseEvent) => {
    if (!isTranslating || !molecule2D) return
    const dx = (e.clientX - translateStart.x) / mol2DScale
    const dy = -(e.clientY - translateStart.y) / mol2DScale
    
    setMolecule2D(prev => {
      if (!prev) return prev
      return {
        ...prev,
        atoms: prev.atoms.map(atom => 
          multiSelectedAtomIds.has(atom.id) 
            ? { ...atom, x: atom.x + dx, y: atom.y + dy }
            : atom
        )
      }
    })
    setTranslateStart({ x: e.clientX, y: e.clientY })
  }, [isTranslating, translateStart, mol2DScale, multiSelectedAtomIds, molecule2D])
  
  const handleTranslateEnd = useCallback(() => {
    setIsTranslating(false)
  }, [])
  
  // Select all atoms in molecule
  const selectAllMoleculeAtoms = useCallback(() => {
    if (!molecule2D) return
    setMultiSelectedAtomIds(new Set(molecule2D.atoms.map(a => a.id)))
  }, [molecule2D])
  
  // Clear multi-selection
  const clearMultiSelect = useCallback(() => {
    setMultiSelectedAtomIds(new Set())
    setIsMultiSelectMode(false)
  }, [])
  
  // Global mouse events for window resize and multi-select translate
  useWindowMouseTracking(isResizing, handleResizeMouseMove, handleResizeMouseUp)
  useWindowMouseTracking(isTranslating, handleTranslateMove, handleTranslateEnd)

  // Show if requested
  if (!show2DPlaneView) return null
  
  // Check if we can show plane view (needs constructed plane)
  const canShowPlane = !!constructedPlane

  const { onPlane, positive, negative, bounds } = projectedAtoms
  
  const padding = 2
  const rangeX = Math.max(bounds.maxX - bounds.minX + padding * 2, 4)
  const rangeY = Math.max(bounds.maxY - bounds.minY + padding * 2, 4)
  // Use dynamic window size for canvas
  const viewSize = Math.min(windowSize.width - 40, windowSize.height - 120)
  const baseScale = Math.min(viewSize / rangeX, viewSize / rangeY) * 0.85
  const scale = baseScale * zoomLevel
  
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  const toScreenX = (x: number) => (viewSize / 2) + (x - centerX) * scale + canvasOffset.x
  const toScreenY = (y: number) => (viewSize / 2) - (y - centerY) * scale + canvasOffset.y

  const isAddAtomMode = toolMode === 'add-atom' && isLocked

  return (
    <div
      className="fixed z-50 rounded-2xl overflow-hidden shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: windowSize.width,
        height: windowSize.height,
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${isLocked ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={handleWindowMouseDown}
      onMouseMove={handleWindowMouseMove}
      onMouseUp={handleWindowMouseUp}
      onMouseLeave={handleWindowMouseUp}
    >
      {/* Header provided by Plane2DViewHeader. */}
      <Plane2DViewHeader
        isLocked={isLocked}
        setIsLocked={setIsLocked}
        showOffPlaneAtoms={showOffPlaneAtoms}
        setShowOffPlaneAtoms={setShowOffPlaneAtoms}
        windowSize={windowSize}
        setWindowSize={setWindowSize}
        canUndo={canUndo}
        onUndo={undo}
        onClose={() => setShow2DPlaneView(false)}
      />

      {/* Molecule editor toggle provided by MoleculeEditorToggle. */}
      <MoleculeEditorToggle
        canShowPlane={canShowPlane}
        onPlaneCount={onPlane.length}
        showMoleculeEditor={showMoleculeEditor}
        setShowMoleculeEditor={setShowMoleculeEditor}
        molecule2D={molecule2D}
      />

      {/* Molecule editor: SMILES input and tools */}
      {showMoleculeEditor && (
        <>
          {/* SMILES input, custom library, and save dialog provided by SmilesInputSection. */}
          <SmilesInputSection
            smilesInput={smilesInput}
            setSmilesInput={setSmilesInput}
            onParse={handleParseSMILES}
            autoAddHydrogen={autoAddHydrogen}
            setAutoAddHydrogen={setAutoAddHydrogen}
            onLoadExample={handleLoadExample}
            customFragments={customFragments}
            setCustomFragments={setCustomFragments}
            molecule2D={molecule2D}
          />

          {/* Toolbar provided by MoleculeToolBar. */}
          <MoleculeToolBar
            mol2DToolMode={mol2DToolMode}
            setMol2DToolMode={setMol2DToolMode}
            mol2DSelectedElement={mol2DSelectedElement}
            setMol2DSelectedElement={setMol2DSelectedElement}
            mol2DSelectedBondType={mol2DSelectedBondType}
            setMol2DSelectedBondType={setMol2DSelectedBondType}
            onClear={handleClearMolecule}
          />
        </>
      )}

      {/* Combine snap, division, and add-atom element controls in one row. */}
      {canShowPlane && isLocked && (
        <PlaneCanvasToolBar
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          showSnapPoints={showSnapPoints}
          setShowSnapPoints={setShowSnapPoints}
          snapDivision={snapDivision}
          setSnapDivision={setSnapDivision}
          isAddAtomMode={isAddAtomMode}
          selectedElement={selectedElement}
          setSelectedElement={setSelectedElement}
        />
      )}

      {/* Canvas area - unified for both plane and molecule */}
      <div
        className="canvas-area relative flex-1"
        style={{
          padding: 10,
          cursor: mol2DToolMode === 'move-molecule' ? 'move' : (isMultiSelectMode && multiSelectedAtomIds.size > 0 ? 'move' : (isLocked ? (toolMode === 'add-atom' ? 'crosshair' : 'grab') : 'default')),
          overflow: 'hidden',
        }}
        onMouseDown={(e) => {
          if (isMultiSelectMode && multiSelectedAtomIds.size > 0) {
            handleTranslateStart(e)
          } else {
            handleCanvasMouseDown(e)
          }
        }}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onWheel={handleWheel}
      >
        {/* Unified canvas - shows plane with molecule overlay */}
        {!canShowPlane ? (
          /* Empty state - no plane */
          <svg
            width={viewSize}
            height={viewSize}
            style={{
              background: 'var(--panel-elevated)',
              borderRadius: 12,
              color: 'var(--panel-text-tertiary)',
            }}
          >
            <text x={viewSize/2} y={viewSize/2 - 10} textAnchor="middle" fill="currentColor" fontSize={12}>
              No plane created
            </text>
            <text x={viewSize/2} y={viewSize/2 + 10} textAnchor="middle" fill="currentColor" fontSize={10} opacity={0.7}>
              Select 3 atoms in 3D view
            </text>
          </svg>
        ) : (
        <svg
          ref={svgRef}
          width={viewSize}
          height={viewSize}
          style={{
            background: 'var(--panel-elevated)',
            borderRadius: 12,
            overflow: 'visible',
          }}
        >
          {/* The dot grid, edge fade, and inset outline establish canvas scale. */}
          <PlaneCanvasSubstrate size={viewSize} />

          {/* Lattice edges */}
          <LatticeEdgesLayer edges={projectedLatticeEdges} toScreenX={toScreenX} toScreenY={toScreenY} />

          {/* Bonds on plane */}
          <BondsOnPlaneLayer bonds={projectedBonds} toScreenX={toScreenX} toScreenY={toScreenY} />

          {/* Dynamic connection lines from hovered atom - with hover area to keep lines visible */}
          <DynamicConnectionsLayer
            dynamicConnections={dynamicConnections}
            toScreenX={toScreenX}
            toScreenY={toScreenY}
            hoveredSnapPoint={hoveredSnapPoint}
            isAddAtomMode={isAddAtomMode}
            selectedElement={selectedElement}
            onConnectionAreaEnter={handleConnectionAreaEnter}
            onConnectionAreaLeave={handleConnectionAreaLeave}
            onSetHoveredSnapPoint={setHoveredSnapPoint}
            onSnapPointClick={handleSnapPointClick}
          />

          {/* Snap points (when enabled) */}
          <SnapPointsLayer
            snapPoints={snapPoints}
            enabled={snapEnabled && showSnapPoints && isLocked}
            toScreenX={toScreenX}
            toScreenY={toScreenY}
            hoveredSnapPoint={hoveredSnapPoint}
            isAddAtomMode={isAddAtomMode}
            selectedElement={selectedElement}
            onSetHoveredSnapPoint={setHoveredSnapPoint}
            onSnapPointClick={handleSnapPointClick}
          />

          {/* Off-plane atoms (if showing) */}
          {showOffPlaneAtoms && (
            <OffPlaneAtomsLayer positive={positive} negative={negative} toScreenX={toScreenX} toScreenY={toScreenY} />
          )}

          {/* Atoms on plane */}
          <AtomsOnPlaneLayer
            onPlane={onPlane}
            mirrors={showMirrorAtoms ? projectedMirrors : []}
            toScreenX={toScreenX}
            toScreenY={toScreenY}
            hoveredAtomId={hoveredAtomId}
            isAddAtomMode={isAddAtomMode}
            recede={showMoleculeEditor && !!molecule2D && molecule2D.atoms.length > 0}
            onAtomEnter={handleAtomEnter}
            onAtomLeave={handleAtomLeave}
          />

          {/* SMILES Molecule overlay - uses same coordinate system as plane */}
          {showMoleculeEditor && molecule2D && molecule2D.atoms.length > 0 && (
            <MoleculeOverlay
              molecule2D={molecule2D}
              insertRotation={insertRotation}
              moleculeOffset={moleculeOffset}
              mol2DToolMode={mol2DToolMode}
              mol2DSelectedAtomId={mol2DSelectedAtomId}
              mol2DPendingBondAtom={mol2DPendingBondAtom}
              multiSelectedAtomIds={multiSelectedAtomIds}
              toScreenX={toScreenX}
              toScreenY={toScreenY}
              onAtomClick={handleMol2DAtomClick}
            />
          )}
        </svg>
        )}
      </div>

      {/* Molecule editor: Insert controls (with plane) */}
      {showMoleculeEditor && molecule2D && molecule2D.atoms.length > 0 && canShowPlane && (
        <MoleculeInsertWithPlaneControls
          insertRotation={insertRotation}
          moleculeOffset={moleculeOffset}
          onChangeRotation={setInsertRotation}
          onInsert={handleInsertTo3D}
        />
      )}

      {/* Molecule editor: Insert at origin (no plane) */}
      {showMoleculeEditor && molecule2D && molecule2D.atoms.length > 0 && !canShowPlane && (
        <MoleculeInsertAtOriginControls onInsert={handleInsertAtOrigin} />
      )}

      {/* Plane mode: No plane warning */}
      {!showMoleculeEditor && !canShowPlane && (
        <PlaneModeNoPlaneWarning />
      )}

      {/* Plane mode: Bottom stats/actions */}
      {!showMoleculeEditor && canShowPlane && (
        <PlaneModeStatsActions
          onPlaneCount={onPlane.length}
          positiveCount={positive.length}
          negativeCount={negative.length}
          showOffPlaneAtoms={showOffPlaneAtoms}
          mirrorCount={projectedMirrors.length}
          showMirrors={showMirrorAtoms}
          onToggleMirrors={() => setShowMirrorAtoms(v => !v)}
          onSelectSide={selectAtomsOnPlaneSide}
        />
      )}

      {/* Multi-select toolbar (when molecule exists and atoms selected) */}
      {showMoleculeEditor && molecule2D && molecule2D.atoms.length > 0 && (
        <MoleculeMultiSelectToolbar
          isMultiSelectMode={isMultiSelectMode}
          multiSelectedAtomIds={multiSelectedAtomIds}
          zoomLevel={zoomLevel}
          onToggleMultiSelect={() => {
            setIsMultiSelectMode(!isMultiSelectMode)
            if (isMultiSelectMode) clearMultiSelect()
          }}
          onSelectAll={selectAllMoleculeAtoms}
          onResetZoom={() => setZoomLevel(1)}
        />
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)',
        }}
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  )
}
