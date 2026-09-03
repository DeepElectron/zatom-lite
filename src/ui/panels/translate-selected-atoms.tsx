import { useState, useEffect } from "react"
import { Move } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { PanelSection } from "./components/panel-section"

export function TranslateSelectedAtoms() {
  const translateMode = useCrystalStore((s) => s.translateMode)
  const setTranslateMode = useCrystalStore((s) => s.setTranslateMode)
  const selectionTransformMode = useCrystalStore((s) => s.selectionTransformMode)
  const setSelectionTransformMode = useCrystalStore((s) => s.setSelectionTransformMode)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)
  const setTranslationPreview = useCrystalStore((s) => s.setTranslationPreview)
  const setRotationPreview = useCrystalStore((s) => s.setRotationPreview)
  const applyTranslationPreview = useCrystalStore((s) => s.applyTranslationPreview)
  const applyRotationPreview = useCrystalStore((s) => s.applyRotationPreview)
  
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [dz, setDz] = useState(0)
  const [rx, setRx] = useState(0)
  const [ry, setRy] = useState(0)
  const [rz, setRz] = useState(0)
  
  useEffect(() => {
    if (translationPreview) {
      setDx(translationPreview[0])
      setDy(translationPreview[1])
      setDz(translationPreview[2])
    }
  }, [translationPreview])

  useEffect(() => {
    if (rotationPreview) {
      setRx(rotationPreview[0])
      setRy(rotationPreview[1])
      setRz(rotationPreview[2])
    }
  }, [rotationPreview])
  
  const updateTranslateValue = (axis: 'x' | 'y' | 'z', value: number) => {
    const newDx = axis === 'x' ? value : dx
    const newDy = axis === 'y' ? value : dy
    const newDz = axis === 'z' ? value : dz
    
    if (axis === 'x') setDx(value)
    if (axis === 'y') setDy(value)
    if (axis === 'z') setDz(value)
    
    if (newDx !== 0 || newDy !== 0 || newDz !== 0) {
      setTranslationPreview([newDx, newDy, newDz])
    } else {
      setTranslationPreview(null)
    }
  }

  const updateRotateValue = (axis: 'x' | 'y' | 'z', value: number) => {
    const newRx = axis === 'x' ? value : rx
    const newRy = axis === 'y' ? value : ry
    const newRz = axis === 'z' ? value : rz

    if (axis === 'x') setRx(value)
    if (axis === 'y') setRy(value)
    if (axis === 'z') setRz(value)

    if (newRx !== 0 || newRy !== 0 || newRz !== 0) {
      setRotationPreview([newRx, newRy, newRz])
    } else {
      setRotationPreview(null)
    }
  }
  
  const handleApply = () => {
    if (selectionTransformMode === 'rotate') {
      if (rotationPreview) {
        applyRotationPreview()
        setRx(0)
        setRy(0)
        setRz(0)
      }
      return
    }

    if (translationPreview) {
      applyTranslationPreview()
      setDx(0)
      setDy(0)
      setDz(0)
    }
  }
  
  const handleCancel = () => {
    setTranslationPreview(null)
    setRotationPreview(null)
    setTranslateMode(false)
    setSelectionTransformMode('translate')
    setDx(0)
    setDy(0)
    setDz(0)
    setRx(0)
    setRy(0)
    setRz(0)
  }
  
  const hasPreview = selectionTransformMode === 'rotate' ? rotationPreview !== null : translationPreview !== null
  
  return (
    /* The section outline alone communicates its active state. */
    <PanelSection label="Transform" tone={translateMode ? 'active' : 'default'}>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={selectionTransformMode === 'translate'}
          data-selected={selectionTransformMode === 'translate'}
          onClick={() => {
            setSelectionTransformMode('translate')
            setRotationPreview(null)
          }}
          className="zatom-choice zatom-pressable rounded-lg py-1.5 text-xs font-medium"
        >
          Translate
        </button>
        <button
          type="button"
          aria-pressed={selectionTransformMode === 'rotate'}
          data-selected={selectionTransformMode === 'rotate'}
          onClick={() => {
            setSelectionTransformMode('rotate')
            setTranslationPreview(null)
          }}
          className="zatom-choice zatom-pressable rounded-lg py-1.5 text-xs font-medium"
        >
          Rotate
        </button>
      </div>
      
      {/* Drag mode toggle */}
      <button
        type="button"
        aria-pressed={translateMode}
        data-selected={translateMode}
        onClick={() => {
          setTranslateMode(!translateMode)
        }}
        className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium"
      >
        <Move className="w-3.5 h-3.5" />
        {translateMode ? "Drag Mode Active" : "Enable Drag Mode"}
      </button>
      
      {translateMode && (
        <p className="text-[10px] text-[var(--text-tertiary)] mt-2 mb-2">
          Drag handles in 3D view or use inputs below
        </p>
      )}
      
      {/* Numeric inputs - always visible when in translate mode */}
      {translateMode && (
        <>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] mb-1 block">
                {selectionTransformMode === 'rotate' ? 'RX (deg)' : 'X (Å)'}
              </label>
              <input
                type="number"
                value={Math.round((selectionTransformMode === 'rotate' ? rx : dx) * 100) / 100}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  if (selectionTransformMode === 'rotate') {
                    updateRotateValue('x', value)
                  } else {
                    updateTranslateValue('x', value)
                  }
                }}
                step={0.1}
                className="zatom-field w-full rounded-lg px-2 py-1.5 text-center text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] mb-1 block">
                {selectionTransformMode === 'rotate' ? 'RY (deg)' : 'Y (Å)'}
              </label>
              <input
                type="number"
                value={Math.round((selectionTransformMode === 'rotate' ? ry : dy) * 100) / 100}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  if (selectionTransformMode === 'rotate') {
                    updateRotateValue('y', value)
                  } else {
                    updateTranslateValue('y', value)
                  }
                }}
                step={0.1}
                className="zatom-field w-full rounded-lg px-2 py-1.5 text-center text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] mb-1 block">
                {selectionTransformMode === 'rotate' ? 'RZ (deg)' : 'Z (Å)'}
              </label>
              <input
                type="number"
                value={Math.round((selectionTransformMode === 'rotate' ? rz : dz) * 100) / 100}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  if (selectionTransformMode === 'rotate') {
                    updateRotateValue('z', value)
                  } else {
                    updateTranslateValue('z', value)
                  }
                }}
                step={0.1}
                className="zatom-field w-full rounded-lg px-2 py-1.5 text-center text-xs"
              />
            </div>
          </div>
          
          {/* Apply/Cancel buttons */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                handleCancel()
              }}
              className="zatom-choice zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                handleApply()
              }}
              disabled={!hasPreview}
              className="zatom-primary zatom-pressable flex-1 rounded-lg py-1.5 text-xs font-medium"
            >
              Apply
            </button>
          </div>
        </>
      )}
    </PanelSection>
  )
}
