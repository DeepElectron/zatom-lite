"use client"

import { useMemo } from "react"
import { useState } from "react"
import { Ruler, Triangle, Trash2, X, Edit3, Lock, Unlock, Check } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getElement } from "../../lib/crystal/elements"
import { Toggle } from "./panel-ui"

// Presets are picked for legibility against the scene rather than for variety:
// two neutrals cover light and dark backgrounds, and the three hues avoid the
// CPK colors of common elements so annotations never blend into their atoms.
const MEASUREMENT_COLOR_PRESETS = [
  { value: '#e5006e', label: 'Magenta' },
  { value: '#0ea5e9', label: 'Cyan' },
  { value: '#d97706', label: 'Amber' },
  { value: '#111827', label: 'Ink (for light scenes)' },
  { value: '#f8fafc', label: 'Chalk (for dark scenes)' },
] as const

function MeasurementModeButton({ 
  mode, 
  currentMode, 
  icon, 
  label, 
  atomCount,
  onClick 
}: { 
  mode: string
  currentMode: string
  icon: React.ReactNode
  label: string
  atomCount: number
  onClick: () => void 
}) {
  const isActive = currentMode === mode
  
  return (
    <button
      type="button"
      aria-pressed={isActive}
      data-selected={isActive}
      onClick={() => {
        onClick()
      }}
      className="zatom-choice zatom-pressable flex flex-1 flex-col items-center gap-1 rounded-lg py-2.5 text-xs"
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span className="text-[10px] opacity-60">{atomCount} atoms</span>
    </button>
  )
}

// Dihedral angle icon
function DihedralIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8L12 4L20 8" />
      <path d="M4 16L12 20L20 16" />
      <path d="M12 4V20" strokeDasharray="3 2" />
    </svg>
  )
}

/** Derive edit ranges by measurement type; dihedrals allow -180° through 180°. */
function internalEditConfig(type: string, currentValue: number) {
  if (type === 'distance') {
    return { label: 'distance', min: 0.5, max: Math.max(currentValue * 2, 5), step: 0.01, decimals: 3 }
  }
  if (type === 'dihedral') {
    return { label: 'dihedral', min: -180, max: 180, step: 0.5, decimals: 1 }
  }
  return { label: 'angle', min: 0, max: 180, step: 0.5, decimals: 1 }
}

function editFillPercent(cfg: { min: number; max: number }, value: number) {
  const span = cfg.max - cfg.min
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((value - cfg.min) / span) * 100))
}

export function MeasurementPanel() {
  const atoms = useCrystalStore((s) => s.atoms)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const bioHasAtomicTargets = useCrystalStore((s) => (
    s.bioShowSticks || s.bioShowSpacefill || s.bioShowLigand || s.bioShowIons || s.bioShowPocket
  ))
  const measurementMode = useCrystalStore((s) => s.measurementMode)
  const measurements = useCrystalStore((s) => s.measurements)
  const pendingMeasurementAtoms = useCrystalStore((s) => s.pendingMeasurementAtoms)
  const setMeasurementMode = useCrystalStore((s) => s.setMeasurementMode)
  const clearPendingMeasurement = useCrystalStore((s) => s.clearPendingMeasurement)
  const removeMeasurement = useCrystalStore((s) => s.removeMeasurement)
  const clearAllMeasurements = useCrystalStore((s) => s.clearAllMeasurements)
  const labelOffset = useCrystalStore((s) => s.measurementLabelOffset)
  const labelFaceCamera = useCrystalStore((s) => s.measurementLabelFaceCamera)
  const setLabelOffset = useCrystalStore((s) => s.setMeasurementLabelOffset)
  const setLabelFaceCamera = useCrystalStore((s) => s.setMeasurementLabelFaceCamera)
  const fontSize = useCrystalStore((s) => s.measurementFontSize)
  const lineWidth = useCrystalStore((s) => s.measurementLineWidth)
  const setFontSize = useCrystalStore((s) => s.setMeasurementFontSize)
  const setLineWidth = useCrystalStore((s) => s.setMeasurementLineWidth)
  const color = useCrystalStore((s) => s.measurementColor)
  const setColor = useCrystalStore((s) => s.setMeasurementColor)
  
  // Measurement editing
  const activeMeasurementEdit = useCrystalStore((s) => s.activeMeasurementEdit)
  const startMeasurementEdit = useCrystalStore((s) => s.startMeasurementEdit)
  const updateMeasurementEditTarget = useCrystalStore((s) => s.updateMeasurementEditTarget)
  const applyMeasurementEdit = useCrystalStore((s) => s.applyMeasurementEdit)
  const cancelMeasurementEdit = useCrystalStore((s) => s.cancelMeasurementEdit)
  
  // Local state for edit UI
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null)
  const [selectedFixedAtoms, setSelectedFixedAtoms] = useState<number[]>([])
  
  // Get atom info for pending measurement
  const pendingAtoms = useMemo(() => {
    return pendingMeasurementAtoms.map(id => atoms.find(a => a.id === id)).filter(Boolean)
  }, [pendingMeasurementAtoms, atoms])
  
  const requiredAtoms = measurementMode === 'distance' ? 2 : measurementMode === 'angle' ? 3 : 4

  return (
    <div className="space-y-4">
      {/* Mode selection */}
      <div>
        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Measurement Tool</label>
        <div className="flex gap-2">
          <MeasurementModeButton
            mode="distance"
            currentMode={measurementMode}
            icon={<Ruler className="w-4 h-4" />}
            label="Distance"
            atomCount={2}
            onClick={() => setMeasurementMode(measurementMode === 'distance' ? 'none' : 'distance')}
          />
          <MeasurementModeButton
            mode="angle"
            currentMode={measurementMode}
            icon={<Triangle className="w-4 h-4" />}
            label="Angle"
            atomCount={3}
            onClick={() => setMeasurementMode(measurementMode === 'angle' ? 'none' : 'angle')}
          />
          <MeasurementModeButton
            mode="dihedral"
            currentMode={measurementMode}
            icon={<DihedralIcon className="w-4 h-4" />}
            label="Dihedral"
            atomCount={4}
            onClick={() => setMeasurementMode(measurementMode === 'dihedral' ? 'none' : 'dihedral')}
          />
        </div>
      </div>
      
      {/* Active measurement progress */}
      {measurementMode !== 'none' && (
        <div
          className="p-3 rounded-lg"
          style={{ background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[var(--control-selected-text)]">
              Select {requiredAtoms} atoms
            </span>
            {pendingMeasurementAtoms.length > 0 && (
              <button
                onClick={() => {
                  clearPendingMeasurement()
                }}
                className="status-red flex items-center gap-1 text-xs hover:opacity-80"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          
          {/* Progress indicator */}
          <div className="flex gap-1 mb-2">
            {Array.from({ length: requiredAtoms }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{
                  background: i < pendingMeasurementAtoms.length ? 'var(--control-primary-bg)' : 'var(--panel-border)',
                }}
              />
            ))}
          </div>
          
          {/* Selected atoms */}
          {pendingAtoms.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pendingAtoms.map((atom, i) => {
                if (!atom) return null
                const color = getElement(atom.element)?.color || '#888'
                return (
                  <div
                    key={atom.id}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    style={{
                      background: `${color}22`,
                      border: `1px solid ${color}`,
                    }}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: color }}
                    />
                    <span style={{ color }}>{atom.element}</span>
                    <span className="text-[var(--text-tertiary)]">#{i + 1}</span>
                  </div>
                )
              })}
            </div>
          )}
          
          <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
            Click on atoms in the 3D view to add them to the measurement
          </p>
        </div>
      )}

      {measurementMode !== 'none' && bioStructure && !bioHasAtomicTargets && (
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
          Precise biomolecule measurements use visible atom spheres. Cartoon and surface geometry are not atom targets; switch the representation or click a visible ligand, ion, pocket, or selection atom.
        </p>
      )}
      
      {/* Measurements list */}
      {measurements.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--text-secondary)]">
              Measurements ({measurements.length})
            </label>
            <button
              onClick={() => {
                clearAllMeasurements()
              }}
              className="status-red flex items-center gap-1 text-xs hover:opacity-80"
            >
              <Trash2 className="w-3 h-3" />
              Clear all
            </button>
          </div>
          
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {measurements.map((m) => {
              const measurementAtoms = m.atomIds.map(id => atoms.find(a => a.id === id)).filter(Boolean)
              const typeLabel = m.type === 'distance' ? 'Distance' : m.type === 'angle' ? 'Angle' : 'Dihedral'
              const unit = m.type === 'distance' ? 'Å' : '°'
              const icon = m.type === 'distance' 
                ? <Ruler className="w-3.5 h-3.5" />
                : m.type === 'angle'
                  ? <Triangle className="w-3.5 h-3.5" />
                  : <DihedralIcon className="w-3.5 h-3.5" />
              
              const isEditing = editingMeasurementId === m.id
              const isActiveEdit = activeMeasurementEdit?.measurementId === m.id
              
              // Calculate required fixed atoms based on type
              const requiredFixed = m.type === 'distance' ? 1 : m.type === 'angle' ? 2 : 3
              const canStartEdit = isEditing && selectedFixedAtoms.length === requiredFixed
              
              return (
                <div
                  key={m.id}
                  className="rounded-lg overflow-hidden"
                  style={{
                    background: isEditing ? 'var(--control-selected-bg)' : 'var(--panel-elevated)',
                    border: `1px solid ${isEditing ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
                  }}
                >
                  {/* Main measurement row */}
                  <div className="p-2.5 flex items-center gap-2">
                    <div className="text-[var(--control-selected-text)]">{icon}</div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-xs">
                        {measurementAtoms.map((atom, i) => {
                          if (!atom) return null
                          const color = getElement(atom.element)?.color || '#888'
                          const isFixed = isEditing && selectedFixedAtoms.includes(i)
                          return (
                            <span key={atom.id} className="flex items-center gap-0.5">
                              {i > 0 && <span className="text-[var(--text-tertiary)]">-</span>}
                              <span 
                                style={{ color }}
                                className={isFixed ? "underline decoration-2" : ""}
                              >
                                {atom.element}
                                {isFixed && <Lock className="inline w-2 h-2 ml-0.5" />}
                              </span>
                            </span>
                          )
                        })}
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">{typeLabel}</div>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-sm font-mono font-medium tabular-nums">
                        {isActiveEdit 
                          ? activeMeasurementEdit.targetValue.toFixed(m.type === 'distance' ? 3 : 1)
                          : m.value.toFixed(m.type === 'distance' ? 3 : 1)
                        }{unit}
                      </div>
                    </div>
                    
                    {/* Edit button */}
                    {!isEditing && !isActiveEdit && (
                      <button
                        onClick={() => {
                          setEditingMeasurementId(m.id)
                          setSelectedFixedAtoms([])
                        }}
                        className="zatom-pressable rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
                        title="Edit measurement"
                        aria-label={`Edit ${typeLabel.toLowerCase()} measurement`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    
                    <button
                      onClick={() => {
                        if (isEditing) {
                          setEditingMeasurementId(null)
                          setSelectedFixedAtoms([])
                        }
                        if (isActiveEdit) {
                          cancelMeasurementEdit()
                        }
                        removeMeasurement(m.id)
                      }}
                      className="status-hover-red p-1 rounded text-[var(--panel-text-tertiary)]"
                      aria-label={`Remove ${typeLabel.toLowerCase()} measurement`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  {/* Edit mode: select fixed atoms */}
                  {isEditing && !isActiveEdit && (
                    <div className="px-2.5 pb-2.5 border-t border-[var(--glass-border-subtle)]">
                      <div className="text-[10px] text-[var(--text-secondary)] mt-2 mb-1.5">
                        Select {requiredFixed} atom{requiredFixed > 1 ? 's' : ''} to fix:
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {measurementAtoms.map((atom, i) => {
                          if (!atom) return null
                          const color = getElement(atom.element)?.color || '#888'
                          const isSelected = selectedFixedAtoms.includes(i)
                          return (
                            <button
                              key={atom.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedFixedAtoms(selectedFixedAtoms.filter(idx => idx !== i))
                                } else if (selectedFixedAtoms.length < requiredFixed) {
                                  setSelectedFixedAtoms([...selectedFixedAtoms, i])
                                }
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                              style={{
                                background: isSelected ? `${color}44` : `${color}22`,
                                border: `1px solid ${isSelected ? color : 'transparent'}`,
                              }}
                            >
                              {isSelected ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                              <span style={{ color }}>{atom.element}</span>
                              <span className="text-[var(--text-tertiary)]">#{i + 1}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            if (canStartEdit) {
                              startMeasurementEdit(m.id, selectedFixedAtoms)
                              setEditingMeasurementId(null)
                            }
                          }}
                          disabled={!canStartEdit}
                          className="zatom-primary zatom-pressable flex-1 rounded px-2 py-1.5 text-xs font-medium"
                        >
                          Continue
                        </button>
                        <button
                          onClick={() => {
                            setEditingMeasurementId(null)
                            setSelectedFixedAtoms([])
                          }}
                          className="px-2 py-1.5 rounded text-xs text-[var(--text-tertiary)] hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Active edit mode: adjust value */}
                  {isActiveEdit && (
                    <div className="px-2.5 pb-2.5 border-t border-[var(--glass-border-subtle)]">
                      <div className="text-[10px] text-[var(--text-secondary)] mt-2 mb-1.5">
                        Adjust {internalEditConfig(m.type, m.value).label}:
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="number"
                          value={activeMeasurementEdit.targetValue.toFixed(internalEditConfig(m.type, m.value).decimals)}
                          onChange={(e) => updateMeasurementEditTarget(parseFloat(e.target.value) || 0)}
                          step={internalEditConfig(m.type, m.value).step}
                          min={internalEditConfig(m.type, m.value).min}
                          max={internalEditConfig(m.type, m.value).max}
                          className="zatom-field flex-1 rounded px-2 py-1.5 font-mono text-sm"
                        />
                        <span className="text-xs text-[var(--text-tertiary)]">{unit}</span>
                      </div>
                      <input
                        type="range"
                        min={internalEditConfig(m.type, m.value).min}
                        max={internalEditConfig(m.type, m.value).max}
                        step={internalEditConfig(m.type, m.value).step}
                        value={activeMeasurementEdit.targetValue}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          updateMeasurementEditTarget(val)
                        }}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer mb-2"
                        style={{
                          background: `linear-gradient(to right, var(--panel-accent) 0%, var(--panel-accent) ${
                            editFillPercent(internalEditConfig(m.type, m.value), activeMeasurementEdit.targetValue)
                          }%, rgba(255,255,255,0.1) ${
                            editFillPercent(internalEditConfig(m.type, m.value), activeMeasurementEdit.targetValue)
                          }%, rgba(255,255,255,0.1) 100%)`,
                        }}
                      />
                      <div className="flex gap-1">
  <button
  onClick={() => {
    applyMeasurementEdit()
  }}
  className="zatom-primary zatom-pressable flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium"
                        >
                          <Check className="w-3 h-3" />
                          Apply
                        </button>
  <button
  onClick={() => {
    cancelMeasurementEdit()
  }}
  className="px-2 py-1.5 rounded text-xs text-[var(--text-tertiary)] hover:bg-white/10"
  >
  Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      
      {/* Label Settings */}
      {measurements.length > 0 && (
        <div className="pt-3 border-t border-[var(--glass-border-subtle)]">
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Label Settings</label>
          
          {/* Face Camera toggle */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-secondary)]">Face Camera</span>
            <Toggle
              checked={labelFaceCamera}
              onChange={(checked) => {
                setLabelFaceCamera(checked)
              }}
            />
          </div>
          
          {/* Label Offset slider */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">Label Offset</span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">{labelOffset.toFixed(1)}</span>
            </div>
        <input
          type="range"
          min="0.1"
          max="2.5"
          step="0.1"
          value={labelOffset}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            setLabelOffset(val)
          }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--panel-accent) 0%, var(--panel-accent) ${((labelOffset - 0.1) / 2.4) * 100}%, var(--panel-border) ${((labelOffset - 0.1) / 2.4) * 100}%, var(--panel-border) 100%)`,
              }}
            />
            <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mt-0.5">
              <span>Near</span>
              <span>Far</span>
            </div>
          </div>
          
          {/* Font Size slider */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">Font Size</span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">{fontSize.toFixed(2)}</span>
            </div>
        <input
          type="range"
          min="0.1"
          max="0.6"
          step="0.05"
          value={fontSize}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            setFontSize(val)
          }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--panel-accent) 0%, var(--panel-accent) ${((fontSize - 0.1) / 0.5) * 100}%, var(--panel-border) ${((fontSize - 0.1) / 0.5) * 100}%, var(--panel-border) 100%)`,
              }}
            />
            <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mt-0.5">
              <span>Small</span>
              <span>Large</span>
            </div>
          </div>
          
          {/* Line Width slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">Line Width</span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">{lineWidth.toFixed(1)}</span>
            </div>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.5"
          value={lineWidth}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            setLineWidth(val)
          }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--panel-accent) 0%, var(--panel-accent) ${((lineWidth - 0.5) / 4.5) * 100}%, var(--panel-border) ${((lineWidth - 0.5) / 4.5) * 100}%, var(--panel-border) 100%)`,
              }}
            />
            <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mt-0.5">
              <span>Thin</span>
              <span>Thick</span>
            </div>
          </div>

          {/* Annotation color */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Annotation Color</span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">{color.toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {MEASUREMENT_COLOR_PRESETS.map((preset) => {
                const active = preset.value.toLowerCase() === color.toLowerCase()
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setColor(preset.value)}
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={active}
                    className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: preset.value,
                      // Ring, not border: a border would eat into the swatch and make
                      // the two neutral presets read as a different size than the rest.
                      boxShadow: active
                        ? `0 0 0 1.5px var(--panel-bg), 0 0 0 3px var(--panel-accent)`
                        : `0 0 0 1px color-mix(in srgb, var(--text-primary) 20%, transparent)`,
                    }}
                  />
                )
              })}
              <label
                className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full"
                title="Custom color"
                style={{
                  background:
                    'conic-gradient(from 0deg, #e5006e, #d97706, #16a34a, #0ea5e9, #7c3aed, #e5006e)',
                  boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-primary) 20%, transparent)',
                }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Custom annotation color"
                />
              </label>
            </div>
          </div>
        </div>
      )}
      
      {/* Empty state */}
      {measurementMode === 'none' && measurements.length === 0 && (
        <div className="text-center py-4 text-[var(--text-tertiary)] text-xs">
          Select a measurement tool above to start measuring distances, angles, or dihedral angles between atoms.
        </div>
      )}
    </div>
  )
}
