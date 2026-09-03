import { useState, useEffect, useCallback, useRef } from "react"
import { Circle, Cylinder, Layers, ArrowRight, Box, Atom } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getElement } from "../../lib/crystal/elements"
import { compileSelectionExpression } from "../../lib/selection/expression"
import { labelColorOn } from "./components/plane-canvas-theme"
import { PanelSection, SectionLabel } from "./components/panel-section"

/** Expression templates use icons, not arbitrary colors, to encode geometric families. */
const SELECTION_TEMPLATES = [
  { id: 'sphere', name: 'Sphere', icon: Circle, expr: 'r < 3.0', desc: 'Spherical region' },
  { id: 'shell', name: 'Shell', icon: Circle, expr: 'r > 2.0 && r < 4.0', desc: 'Spherical shell' },
  { id: 'cylinder_x', name: 'Cyl X', icon: Cylinder, expr: 'sqrt((y-cy)^2 + (z-cz)^2) < 2.0 && abs(x-cx) < 5.0', desc: 'Cylinder along X' },
  { id: 'cylinder_y', name: 'Cyl Y', icon: Cylinder, expr: 'sqrt((x-cx)^2 + (z-cz)^2) < 2.0 && abs(y-cy) < 5.0', desc: 'Cylinder along Y' },
  { id: 'cylinder_z', name: 'Cyl Z', icon: Cylinder, expr: 'sqrt((x-cx)^2 + (y-cy)^2) < 2.0 && abs(z-cz) < 5.0', desc: 'Cylinder along Z' },
  { id: 'plane_x', name: 'X=', icon: Layers, expr: 'abs(x - cx) < 0.5', desc: 'Same X coordinate' },
  { id: 'plane_y', name: 'Y=', icon: Layers, expr: 'abs(y - cy) < 0.5', desc: 'Same Y coordinate' },
  { id: 'plane_z', name: 'Z=', icon: Layers, expr: 'abs(z - cz) < 0.5', desc: 'Same Z coordinate' },
  { id: 'half_z_pos', name: 'Z+', icon: ArrowRight, expr: 'z >= cz', desc: 'Z positive half' },
  { id: 'half_z_neg', name: 'Z-', icon: ArrowRight, expr: 'z <= cz', desc: 'Z negative half' },
  { id: 'box', name: 'Box', icon: Box, expr: 'abs(x-cx) < 3 && abs(y-cy) < 3 && abs(z-cz) < 3', desc: 'Box region' },
  { id: 'element', name: 'Element', icon: Atom, expr: 'el == "C"', desc: 'By element' },
]

// Multi-selection tools based on function expressions
export function SelectionTools() {
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectAtoms = useCrystalStore((s) => s.selectAtoms)
  const setSelectionRegionPreview = useCrystalStore((s) => s.setSelectionRegionPreview)
  const boundFrameId = useCrystalStore((s) => s.boundFrameRef?.frameId ?? null)

  const [expression, setExpression] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  // Locked center point - persists after selection
  const [lockedCenter, setLockedCenter] = useState<{ element: string; position: [number, number, number] } | null>(null)
  const previousFrameId = useRef(boundFrameId)

  useEffect(() => {
    if (previousFrameId.current !== boundFrameId) {
      previousFrameId.current = boundFrameId
      setLockedCenter(null)
      setError(null)
      setSelectionRegionPreview(null)
    }
  }, [boundFrameId, setSelectionRegionPreview])

  // Get first selected atom for potential center
  const firstSelectedAtom = selectedAtomIds.size > 0 ? atoms.find(a => a.id === Array.from(selectedAtomIds)[0]) : null

  // Use locked center if available, otherwise use first selected atom
  const centerPos = lockedCenter?.position ?? firstSelectedAtom?.cartesian ?? null
  const centerX = centerPos?.[0] ?? null
  const centerY = centerPos?.[1] ?? null
  const centerZ = centerPos?.[2] ?? null

  // Lock current selection as center
  const lockCenter = () => {
    if (firstSelectedAtom?.cartesian) {
      setLockedCenter({ element: firstSelectedAtom.element, position: firstSelectedAtom.cartesian })
      // Update preview
      updatePreview(expression, firstSelectedAtom.cartesian)
    }
  }

  // Clear locked center
  const clearCenter = () => {
    setLockedCenter(null)
    setSelectionRegionPreview?.(null)
  }

  const applyTemplate = (template: typeof SELECTION_TEMPLATES[0]) => {
    setExpression(template.expr)
    setError(null)
    // Update preview with new expression
    if (centerPos) {
      updatePreview(template.expr, centerPos)
    }
  }

  // Update selection region preview
  const updatePreview = useCallback((expr: string, center: [number, number, number]) => {
    if (!setSelectionRegionPreview) return

    // Parse expression to determine preview shape
    const sphereMatch = expr.match(/^r\s*<\s*([\d.]+)$/)
    const shellMatch = expr.match(/r\s*>\s*([\d.]+)\s*&&\s*r\s*<\s*([\d.]+)/)
    const cylZMatch = expr.match(/sqrt\(\(x-cx\)\^2\s*\+\s*\(y-cy\)\^2\)\s*<\s*([\d.]+)\s*&&\s*abs\(z-cz\)\s*<\s*([\d.]+)/)
    const cylYMatch = expr.match(/sqrt\(\(x-cx\)\^2\s*\+\s*\(z-cz\)\^2\)\s*<\s*([\d.]+)\s*&&\s*abs\(y-cy\)\s*<\s*([\d.]+)/)
    const cylXMatch = expr.match(/sqrt\(\(y-cy\)\^2\s*\+\s*\(z-cz\)\^2\)\s*<\s*([\d.]+)\s*&&\s*abs\(x-cx\)\s*<\s*([\d.]+)/)
    const boxMatch = expr.match(/abs\(x-cx\)\s*<\s*([\d.]+)\s*&&\s*abs\(y-cy\)\s*<\s*([\d.]+)\s*&&\s*abs\(z-cz\)\s*<\s*([\d.]+)/)

    if (sphereMatch) {
      setSelectionRegionPreview({ type: 'sphere', center, radius: parseFloat(sphereMatch[1]) })
    } else if (shellMatch) {
      setSelectionRegionPreview({ type: 'shell', center, innerRadius: parseFloat(shellMatch[1]), outerRadius: parseFloat(shellMatch[2]) })
    } else if (cylZMatch) {
      setSelectionRegionPreview({ type: 'cylinder', center, radius: parseFloat(cylZMatch[1]), height: parseFloat(cylZMatch[2]) * 2, axis: 'z' })
    } else if (cylYMatch) {
      setSelectionRegionPreview({ type: 'cylinder', center, radius: parseFloat(cylYMatch[1]), height: parseFloat(cylYMatch[2]) * 2, axis: 'y' })
    } else if (cylXMatch) {
      setSelectionRegionPreview({ type: 'cylinder', center, radius: parseFloat(cylXMatch[1]), height: parseFloat(cylXMatch[2]) * 2, axis: 'x' })
    } else if (boxMatch) {
      setSelectionRegionPreview({ type: 'box', center, size: [parseFloat(boxMatch[1]) * 2, parseFloat(boxMatch[2]) * 2, parseFloat(boxMatch[3]) * 2] })
    } else {
      setSelectionRegionPreview(null)
    }
  }, [setSelectionRegionPreview])

  // Update preview when expression or center changes
  useEffect(() => {
    if (centerX !== null && centerY !== null && centerZ !== null) {
      updatePreview(expression, [centerX, centerY, centerZ])
    } else {
      setSelectionRegionPreview?.(null)
    }
  }, [centerX, centerY, centerZ, expression, setSelectionRegionPreview, updatePreview])

  // Region geometry is a transient preview owned by this panel. Leaving Select
  // (for example, opening Measure) must not leave a stale sphere over the model.
  useEffect(() => () => {
    setSelectionRegionPreview(null)
  }, [setSelectionRegionPreview])

  const executeSelection = () => {
    const usesCenterCoords = /\b(cx|cy|cz|r)\b/.test(expression)
    if (!centerPos && usesCenterCoords) {
      setError('Lock a center point first')
      return
    }
    const cx = centerPos?.[0] ?? 0, cy = centerPos?.[1] ?? 0, cz = centerPos?.[2] ?? 0

    try {
      const predicate = compileSelectionExpression(expression)
      const selected = atoms.filter(atom => {
        const pos = atom.cartesian
        if (!pos) return false
        const x = pos[0], y = pos[1], z = pos[2]
        const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
        return predicate({ x, y, z, cx, cy, cz, r, el: atom.element })
      })

      if (selected.length === 0) {
        setError('No atoms match the expression')
      } else {
        setError(null)
        selectAtoms(selected.map(a => a.id))
      }
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Invalid expression syntax')
    }
  }

  const invertSelection = () => {
    const currentSelected = Array.from(selectedAtomIds)
    selectAtoms(atoms.filter(a => !currentSelected.includes(a.id)).map(a => a.id))
  }

  const selectAll = () => selectAtoms(atoms.map(a => a.id))

  /** Clear selection and dependent translation state together. */
  const clearSelection = () => {
    const store = useCrystalStore.getState()
    store.setTranslateMode(false)
    store.setTranslationPreview(null)
    selectAtoms([])
  }

  // Select connected neighbors (atoms directly bonded to selected atoms)
  const selectConnectedNeighbors = () => {
    const newSelection = new Set(selectedAtomIds)
    bonds.forEach(bond => {
      if (selectedAtomIds.has(bond.atom1Id)) {
        newSelection.add(bond.atom2Id)
      }
      if (selectedAtomIds.has(bond.atom2Id)) {
        newSelection.add(bond.atom1Id)
      }
    })
    selectAtoms(Array.from(newSelection))
  }

  // Select entire fragment (all atoms connected through bonds)
  const selectFragment = () => {
    const newSelection = new Set(selectedAtomIds)
    let changed = true
    while (changed) {
      changed = false
      bonds.forEach(bond => {
        if (newSelection.has(bond.atom1Id) && !newSelection.has(bond.atom2Id)) {
          newSelection.add(bond.atom2Id)
          changed = true
        }
        if (newSelection.has(bond.atom2Id) && !newSelection.has(bond.atom1Id)) {
          newSelection.add(bond.atom1Id)
          changed = true
        }
      })
    }
    selectAtoms(Array.from(newSelection))
  }

  const hasStructure = atoms.length > 0
  const hasSelection = selectedAtomIds.size > 0
  const centerAtom = lockedCenter ?? (firstSelectedAtom?.cartesian
    ? { element: firstSelectedAtom.element, position: firstSelectedAtom.cartesian }
    : null)

  return (
    <div className="flex flex-col gap-3">
      {/* Direct selection needs no setup, so it appears first. */}
      <PanelSection label="Select">
        <div className="flex gap-1.5">
          <button onClick={selectAll} disabled={!hasStructure} className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium">All</button>
          <button onClick={invertSelection} disabled={!hasStructure} className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium">Invert</button>
          <button onClick={clearSelection} disabled={!hasSelection} className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium">Clear</button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={selectConnectedNeighbors}
            disabled={!hasSelection || bonds.length === 0}
            className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium"
            title="Add atoms directly bonded to selected atoms"
          >
            + Neighbors
          </button>
          <button
            onClick={selectFragment}
            disabled={!hasSelection || bonds.length === 0}
            className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium"
            title="Add all atoms connected through bonds (entire fragment)"
          >
            + Fragment
          </button>
        </div>
      </PanelSection>

      {/* Region selection is one flow: choose center, enter condition, apply template. */}
      <PanelSection
        label="Select by region"
        trailing={
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="zatom-pressable rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--panel-text)]"
          >
            {showHelp ? 'Hide syntax' : 'Syntax'}
          </button>
        }
      >
        {/* Only the locked center receives the active accent outline. */}
        {centerAtom ? (
          <div
            className="flex items-center gap-2 rounded-lg p-2"
            style={{
              background: lockedCenter ? 'var(--panel-accent-bg)' : 'var(--glass-bg-active)',
              border: `1px solid ${lockedCenter ? 'var(--panel-accent-border)' : 'transparent'}`,
            }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
              style={{
                background: getElement(centerAtom.element).color,
                color: labelColorOn(getElement(centerAtom.element).color),
              }}
            >
              {centerAtom.element}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium">
                {lockedCenter ? 'Center locked' : 'Center candidate'}
              </div>
              <div className="truncate font-mono text-[11px] text-[var(--text-tertiary)]">
                {centerAtom.position.map((v) => v.toFixed(2)).join(', ')}
              </div>
            </div>
            {lockedCenter ? (
              <button onClick={clearCenter} className="zatom-choice zatom-pressable rounded px-2 py-1 text-[11px] font-medium">
                Unlock
              </button>
            ) : (
              <button onClick={lockCenter} className="zatom-choice zatom-pressable rounded px-2 py-1 text-[11px] font-medium">
                Lock
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Select an atom, then Lock it to anchor <code className="font-mono">r</code>,{' '}
            <code className="font-mono">cx</code>, <code className="font-mono">cy</code>,{' '}
            <code className="font-mono">cz</code>.
          </p>
        )}

        {/* Step 2: expression. */}
        <textarea
          value={expression}
          onChange={(e) => { setExpression(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); executeSelection() } }}
          placeholder="r < 3.0"
          rows={2}
          className="zatom-field w-full resize-none rounded-lg px-3 py-2 font-mono text-xs"
        />

        {showHelp && (
          <div className="flex flex-col gap-1 rounded-lg p-2 text-[11px] leading-relaxed" style={{ background: 'var(--glass-bg-active)' }}>
            <p className="text-[var(--text-secondary)]">
              <span className="font-medium">Variables</span> x, y, z · cx, cy, cz · r · el
            </p>
            <p className="text-[var(--text-secondary)]">
              <span className="font-medium">Functions</span> sqrt, abs, sin, cos, exp, log, PI
            </p>
            <p className="font-mono text-[var(--text-tertiary)]">{'el == "O" && r < 2.5'}</p>
          </div>
        )}

        {error && <p className="text-[11px] text-[var(--status-red)]">{error}</p>}

        <button
          onClick={executeSelection}
          disabled={!expression.trim()}
          className="zatom-primary zatom-pressable w-full rounded-lg py-2 text-xs font-medium"
        >
          Apply expression
        </button>

        {/* Step 3: templates remain with the expression because they seed it. */}
        <div className="flex flex-col gap-1.5 pt-1">
          <SectionLabel>Templates</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            {SELECTION_TEMPLATES.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  title={`${t.desc}: ${t.expr}`}
                  aria-pressed={expression === t.expr}
                  data-selected={expression === t.expr}
                  className="zatom-choice zatom-pressable flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </PanelSection>
    </div>
  )
}
