import { useState, useEffect, useRef } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

// Draggable number input - click to edit, drag to scrub
function DraggableNumberInput({ 
  value, 
  onChange, 
  color,
  label,
  step = 0.01,
  precision = 4 
}: { 
  value: number
  onChange: (value: number) => void
  color: string
  label: string
  step?: number
  precision?: number
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [localValue, setLocalValue] = useState(value.toFixed(precision))
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, value: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Sync local value when external value changes (and not editing)
  useEffect(() => {
    if (!isEditing && !isDragging) {
      setLocalValue(value.toFixed(precision))
    }
  }, [value, isEditing, isDragging, precision])
  
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    
    dragStartRef.current = { x: e.clientX, value }
    setIsDragging(true)
    document.body.style.cursor = 'ew-resize'
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartRef.current.x
      // Sensitivity: ~100px = 1.0 change when step is 0.01
      const sensitivity = step * 100
      const deltaValue = (deltaX / 100) * sensitivity
      const newValue = dragStartRef.current.value + deltaValue
      onChange(newValue)
      setLocalValue(newValue.toFixed(precision))
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }
  
  const handleDoubleClick = () => {
    setIsEditing(true)
    setLocalValue(value.toFixed(precision))
    setTimeout(() => inputRef.current?.select(), 0)
  }
  
  const handleBlur = () => {
    setIsEditing(false)
    const parsed = parseFloat(localValue)
    if (!isNaN(parsed)) {
      onChange(parsed)
    } else {
      setLocalValue(value.toFixed(precision))
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur()
      inputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      setLocalValue(value.toFixed(precision))
      setIsEditing(false)
    }
  }
  
  return (
    <div className="flex items-center gap-2">
      <span 
        className="w-5 text-xs font-semibold select-none"
        style={{ color }}
      >
        {label}
      </span>
      <div 
        className="flex-1 relative group"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg-active)] border-2 text-[var(--text-primary)] text-center outline-none tabular-nums font-mono"
            style={{ borderColor: color }}
          />
        ) : (
          <div
            className="w-full select-none rounded-lg px-3 py-2 text-center font-mono text-sm text-white tabular-nums transition-[background-color,border-color] duration-150 ease-out"
            style={{
              background: isDragging 
                ? `linear-gradient(90deg, ${color}33 0%, ${color}11 100%)`
                : 'rgba(0,0,0,0.4)',
              border: `1px solid ${isDragging ? color : 'var(--glass-border-subtle)'}`,
              cursor: 'ew-resize',
            }}
          >
            <span className="relative">
              {localValue}
              {/* Drag indicator arrows */}
              <span 
                className="absolute inset-y-0 -left-4 flex items-center text-[10px] opacity-0 group-hover:opacity-50 transition-opacity"
                style={{ color }}
              >
                {'<'}
              </span>
              <span 
                className="absolute inset-y-0 -right-4 flex items-center text-[10px] opacity-0 group-hover:opacity-50 transition-opacity"
                style={{ color }}
              >
                {'>'}
              </span>
            </span>
          </div>
        )}
        {/* Scrub progress indicator */}
        {isDragging && (
          <div 
            className="absolute bottom-0 left-0 h-0.5 rounded-full"
            style={{ 
              background: color,
              width: '100%',
              opacity: 0.8,
            }}
          />
        )}
      </div>
    </div>
  )
}

// Atom position editor component
export function AtomPositionEditor({ atom }: { atom: { id: string; element: string; cartesian: [number, number, number] } }) {
  const updateAtomPosition = useCrystalStore((s) => s.updateAtomPosition)
  
  const handleChange = (axis: 0 | 1 | 2, newValue: number) => {
    const newPos: [number, number, number] = [...atom.cartesian] as [number, number, number]
    newPos[axis] = newValue
    updateAtomPosition(atom.id, newPos)
  }
  
  const axisConfig = [
    { label: 'X', color: '#FF6B6B', axis: 0 as const },
    { label: 'Y', color: '#4ECB71', axis: 1 as const },
    { label: 'Z', color: '#5B9DFF', axis: 2 as const },
  ]
  
  return (
    <div
      className="p-3 rounded-[16px]"
      style={{
        background: "var(--glass-bg-hover)",
        border: "1px solid var(--glass-border-subtle)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-[var(--text-secondary)]">Position (Cartesian)</div>
        <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12H19M5 12L9 8M5 12L9 16M19 12L15 8M19 12L15 16" />
          </svg>
          Drag to adjust
        </div>
      </div>
      <div className="space-y-2">
        {axisConfig.map(({ label, color, axis }) => (
          <DraggableNumberInput
            key={label}
            label={label}
            color={color}
            value={atom.cartesian[axis]}
            onChange={(v) => handleChange(axis, v)}
            step={0.05}
            precision={4}
          />
        ))}
      </div>
    </div>
  )
}
