import { Trash2 } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

// Face selection info component with method selection - always shows method buttons
export function FaceSelectionInfo({ 
  faceCount, 
  atomCount,
  embeddedInPlaneBuilder = false,
}: { 
  faceCount: number
  edgeCount: number
  atomCount: number
  embeddedInPlaneBuilder?: boolean
}) {
  const faceSelectMethod = useCrystalStore((s) => s.faceSelectMethod)
  const setFaceSelectMethod = useCrystalStore((s) => s.setFaceSelectMethod)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectedFaceIds = useCrystalStore((s) => s.selectedFaceIds)
  const clearFaceSelection = useCrystalStore((s) => s.clearFaceSelection)
  const constructedPlane = useCrystalStore((s) => s.constructedPlane)
  const constructPlaneFromAtoms = useCrystalStore((s) => s.constructPlaneFromAtoms)
  const constructPlaneFromFaces = useCrystalStore((s) => s.constructPlaneFromFaces)
  const clearConstructedPlane = useCrystalStore((s) => s.clearConstructedPlane)
  const show2DPlaneView = useCrystalStore((s) => s.show2DPlaneView)
  const setShow2DPlaneView = useCrystalStore((s) => s.setShow2DPlaneView)
  const selectAtomsOnPlaneSide = useCrystalStore((s) => s.selectAtomsOnPlaneSide)
  
  // Check if we can construct a face from selection
  const canConstructFromAtoms = faceSelectMethod === 'three-atoms' && atomCount >= 3
  const canConstructFromFaces = faceSelectMethod === 'direct' && faceCount >= 1

  const handleConstructFace = () => {
    if (canConstructFromAtoms) {
      constructPlaneFromAtoms(Array.from(selectedAtomIds))
    } else if (canConstructFromFaces) {
      constructPlaneFromFaces(Array.from(selectedFaceIds))
    }
  }

  return (
    <div className="space-y-4">
      {/* Face selection method - always visible */}
      <div>
        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Selection Method</label>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { value: 'direct', label: 'Direct' },
            { value: 'three-atoms', label: '3 Atoms' },
          ].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={faceSelectMethod === value}
              data-selected={faceSelectMethod === value}
              className="zatom-choice zatom-pressable rounded-lg px-2 py-2 text-xs font-medium"
              onClick={() => {
                setFaceSelectMethod(value as typeof faceSelectMethod)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Method-specific guidance */}
      <div
        className="p-3 rounded-lg text-xs"
        style={{ background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}
      >
        {faceSelectMethod === 'direct' && (
          <div className="text-[var(--text-secondary)]">
            <div className="mb-1 font-medium text-[var(--control-selected-text)]">Direct Selection</div>
            Click on lattice faces to select. Multi-select with Shift.
            {faceCount > 0 && (
              <div className="mt-1.5 text-[#30D158]">
                {faceCount} face{faceCount > 1 ? 's' : ''} selected
              </div>
            )}
          </div>
        )}
        {faceSelectMethod === 'three-atoms' && (
          <div className="text-[var(--text-secondary)]">
            <div className="mb-1 font-medium text-[var(--control-selected-text)]">3-Atom Selection</div>
            Select 3 non-collinear atoms to define a plane.
            <div className="mt-1.5 flex items-center gap-2">
              <div 
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: 'var(--glass-bg-active)' }}
              >
                <div 
                  className="h-full rounded-full transition-[width,background-color] duration-150 ease-out"
                  style={{ 
                    width: `${Math.min(100, (atomCount / 3) * 100)}%`,
                    background: atomCount >= 3 ? 'var(--status-green)' : 'var(--control-primary-bg)'
                  }}
                />
              </div>
              <span style={{ color: atomCount >= 3 ? 'var(--status-green)' : 'var(--control-selected-text)' }}>
                {atomCount}/3
              </span>
            </div>
          </div>
        )}
        
      </div>

      {/* PlaneBuilder already owns the canonical three-atom Build action. Direct
          face selection still needs this button because it has no atom-based
          action in the workflow below. */}
      {!constructedPlane && (!embeddedInPlaneBuilder || faceSelectMethod === 'direct') && (
        <button
          className="zatom-primary zatom-pressable w-full rounded-lg py-2.5 text-sm font-medium"
          disabled={!canConstructFromAtoms && !canConstructFromFaces}
          onClick={handleConstructFace}
        >
          Construct Plane
        </button>
      )}

      {/* Constructed plane info */}
      {constructedPlane && !embeddedInPlaneBuilder && (
        <div
          className="p-3 rounded-lg"
          style={{
            background: "rgba(48, 209, 88, 0.1)",
            border: "1px solid rgba(48, 209, 88, 0.3)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-[#30D158]">Plane Constructed</div>
            <button
              onClick={clearConstructedPlane}
              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <div className="text-xs text-[var(--text-secondary)] space-y-1 mb-3">
            <div>Normal: ({constructedPlane.normal.map(n => n.toFixed(2)).join(', ')})</div>
            <div>Points: {constructedPlane.points.length}</div>
          </div>

          {/* Toggle 2D view */}
          <button
            onClick={() => setShow2DPlaneView(!show2DPlaneView)}
            aria-pressed={show2DPlaneView}
            data-selected={show2DPlaneView}
            className="zatom-choice zatom-pressable mb-2 w-full rounded-lg py-2 text-xs font-medium"
          >
            {show2DPlaneView ? 'Hide' : 'Show'} 2D Plane View
          </button>

          {/* Space partitioning buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => selectAtomsOnPlaneSide('positive')}
              className="zatom-choice zatom-pressable rounded-lg py-2 text-xs font-medium"
            >
              Select + Side
            </button>
            <button
              onClick={() => selectAtomsOnPlaneSide('negative')}
              className="zatom-choice zatom-pressable rounded-lg py-2 text-xs font-medium"
            >
              Select - Side
            </button>
          </div>
        </div>
      )}

      {/* Clear selection button when faces are selected */}
      {faceCount > 0 && faceSelectMethod === 'direct' && !constructedPlane && (
        <button
          onClick={() => clearFaceSelection()}
          className="status-surface-red w-full rounded-lg border py-2 text-xs font-medium transition-colors"
        >
          Clear Face Selection
        </button>
      )}
    </div>
  )
}
