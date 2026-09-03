/** Draggable HUD for the staged assembly-placement workflow. */
import { useEffect, useRef, useState, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { useWindowMouseTracking } from '../../../ui-kit/index'
import { Toggle } from '../../panels/panel-ui'

export function PlacementPanel({
  placementState,
  previewBlock,
  updatePlacementPosition,
  updatePlacementRotation,
  togglePlacementOrthographic,
  nextPlacementStep,
  cancelPlacement,
  confirmPlacement,
}: {
  placementState: any
  previewBlock: any
  updatePlacementPosition: (pos: [number, number, number]) => void
  updatePlacementRotation: (rot: [number, number, number]) => void
  togglePlacementOrthographic: () => void
  nextPlacementStep: () => void
  cancelPlacement: () => void
  confirmPlacement: () => void
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  
  // Center panel on mount
  useEffect(() => {
    if (position === null && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      setPosition({
        x: (window.innerWidth - rect.width) / 2,
        y: 60
      })
    }
  }, [position])
  
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, button')) return
    if (!position) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }, [isDragging, dragStart])
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])
  
  useWindowMouseTracking(isDragging, handleMouseMove, handleMouseUp)
  
  // Don't render until position is calculated (to avoid flash at 0,0)
  const panelStyle = position 
    ? { left: position.x, top: position.y } 
    : { left: '50%', top: 60, transform: 'translateX(-50%)' }
  
  return (
    <div 
      ref={panelRef}
      className="absolute pointer-events-auto"
      style={panelStyle}
    >
      <div 
        className={`overflow-hidden rounded-xl border shadow-xl backdrop-blur-xl ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          width: expanded ? 280 : 220,
          background: 'var(--glass-bg)',
          borderColor: 'color-mix(in srgb, #FF9F0A 30%, var(--glass-border))',
        }}
      >
        {/* Draggable header */}
        <div 
          className="px-3 py-2 bg-white/5 cursor-grab flex items-center justify-between border-b border-white/5"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#FF9F0A]" />
            <span className="text-[10px] text-white/70 font-medium truncate max-w-[120px]">
              {previewBlock?.name}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Step dots */}
            <div className={`w-1.5 h-1.5 rounded-full ${placementState.step === 'position-xy' ? 'bg-[#FF9F0A]' : 'bg-white/20'}`} />
            <div className={`w-1.5 h-1.5 rounded-full ${placementState.step === 'position-z' ? 'bg-[#FF9F0A]' : 'bg-white/20'}`} />
            <div className={`w-1.5 h-1.5 rounded-full ${placementState.step === 'confirm' ? 'bg-[#30D158]' : 'bg-white/20'}`} />
          </div>
        </div>
        
        <div className="p-2.5">
          {/* Compact position/rotation display */}
          <div className="flex gap-1.5 mb-2 text-[9px]">
            <div className="flex-1 bg-white/5 rounded-lg px-2 py-1.5">
              <div className="flex justify-between">
                <span className="text-red-400">X</span>
                <span className="text-white font-mono">{placementState.position[0].toFixed(1)}</span>
              </div>
            </div>
            <div className="flex-1 bg-white/5 rounded-lg px-2 py-1.5">
              <div className="flex justify-between">
                <span className="text-green-400">Y</span>
                <span className="text-white font-mono">{placementState.position[1].toFixed(1)}</span>
              </div>
            </div>
            <div className="flex-1 bg-white/5 rounded-lg px-2 py-1.5">
              <div className="flex justify-between">
                <span className="text-blue-400">Z</span>
                <span className="text-white font-mono">{placementState.position[2].toFixed(1)}</span>
              </div>
            </div>
          </div>
          
          {/* Distance to nearest atom */}
          {placementState.minDistance > 0 && (
            <div className="mb-2 px-2 py-1.5 bg-[#FF453A]/10 border border-[#FF453A]/30 rounded-lg">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-[#FF453A]/70">Min Distance</span>
                <span className="text-[#FF453A] font-mono font-medium">{placementState.minDistance.toFixed(2)} Å</span>
              </div>
            </div>
          )}
          
          {/* Height slider for step 2 */}
          {placementState.step === 'position-z' && (
            <div className="mb-2">
              <input
                type="range"
                min="-20"
                max="20"
                step="0.5"
                value={placementState.position[1]}
                onChange={(e) => updatePlacementPosition([
                  placementState.position[0],
                  parseFloat(e.target.value),
                  placementState.position[2]
                ])}
                className="w-full h-1.5 accent-[#FF9F0A] rounded-full"
              />
            </div>
          )}
          
  {/* Expandable rotation/options */}
  <button
  onClick={() => {
    setExpanded(!expanded)
  }}
  className="w-full text-[9px] text-white/40 hover:text-white/60 py-1 transition-colors"
  >
            {expanded ? 'Hide options' : 'Show rotation & options'}
          </button>
          
          {expanded && (
            <div className="mt-2 space-y-2">
              {/* Rotation inputs */}
              <div className="flex gap-1.5">
                {['X', 'Y', 'Z'].map((axis, i) => (
                  <div key={axis} className="flex-1">
                    <input
                      type="number"
                      step="15"
                      value={Math.round(placementState.rotation[i] * 180 / Math.PI)}
                      onChange={(e) => {
                        const newRot = [...placementState.rotation] as [number, number, number]
                        newRot[i] = parseFloat(e.target.value || '0') * Math.PI / 180
                        updatePlacementRotation(newRot)
                      }}
                      className="zatom-field w-full rounded px-1.5 py-1 text-center text-[10px]"
                      placeholder={axis}
                    />
                  </div>
                ))}
  <button
  onClick={() => {
    updatePlacementRotation([0, 0, 0])
  }}
  className="px-2 rounded bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
  title="Reset rotation"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
              
              {/* Ortho toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[9px] text-white/40">Ortho</span>
                <Toggle
                  checked={placementState.useOrthographic}
                  onChange={() => {
                    togglePlacementOrthographic()
                  }}
                />
              </div>
            </div>
          )}
          
          {/* Action buttons */}
          <div className="flex gap-1.5 mt-2">
  <button
  onClick={() => {
    cancelPlacement()
  }}
  className="zatom-choice zatom-pressable flex-1 rounded-lg px-2 py-1.5 text-[10px] font-medium"
  >
  Cancel
            </button>
  {placementState.step === 'position-xy' && (
  <button
  onClick={() => {
    nextPlacementStep()
  }}
  className="zatom-primary zatom-pressable flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold"
  >
                Next
              </button>
            )}
  {placementState.step === 'position-z' && (
  <button
  onClick={() => {
    nextPlacementStep()
  }}
  className="zatom-primary zatom-pressable flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold"
  >
                Confirm
              </button>
            )}
  {placementState.step === 'confirm' && (
  <button
  onClick={() => {
    confirmPlacement()
  }}
  className="zatom-primary zatom-pressable flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold"
  >
                Place
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
