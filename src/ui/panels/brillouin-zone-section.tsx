import { Hexagon } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { BrillouinZoneViewer } from "./brillouin-zone-viewer"

export function BrillouinZoneSection() {
  const latticeParams = useCrystalStore((s) => s.latticeParams)
  const unitCellAtoms = useCrystalStore((s) => s.unitCellAtoms)
  const showBZOverlay = useCrystalStore((s) => s.showBZOverlay)
  const setShowBZOverlay = useCrystalStore((s) => s.setShowBZOverlay)

  // Check if we have a valid crystal structure
  const hasStructure = unitCellAtoms.length > 0 && latticeParams.a > 0

  if (!hasStructure) {
    return (
      <div className="text-center py-6 text-[var(--text-tertiary)] text-sm">
        <Hexagon className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <div>Load a crystal template to view</div>
        <div className="text-xs mt-1">Brillouin zone and k-path</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Show in 3D Viewer Button */}
      <button
        onClick={() => setShowBZOverlay(!showBZOverlay)}
        aria-pressed={showBZOverlay}
        data-selected={showBZOverlay}
        className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"
      >
        <Hexagon className="w-4 h-4" />
        {showBZOverlay ? 'Hide from 3D Viewer' : 'Show in 3D Viewer'}
      </button>

      {/* Preview */}
      <div className="h-[320px] mt-3 border border-[var(--border-primary)] rounded-lg overflow-hidden">
        <BrillouinZoneViewer />
      </div>
    </div>
  )
}
