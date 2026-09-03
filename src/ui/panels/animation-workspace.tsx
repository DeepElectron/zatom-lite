import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { BiomoleculeLayersSettings } from './biomolecule-settings'
import { CrystalLayersSettings } from './crystal-layers-settings'
import { PresentationTimeline } from './presentation-timeline'

/** Timeline and layer authoring share one presentation-focused Inspector route. */
export function AnimationWorkspace() {
  const bioStructure = useCrystalStore((state) => state.bioStructure)

  return (
    <div className="space-y-4">
      <PresentationTimeline />
      {bioStructure ? (
        <BiomoleculeLayersSettings />
      ) : (
        <div className="border-t border-[var(--glass-border-subtle)] pt-4">
          <CrystalLayersSettings />
        </div>
      )}
    </div>
  )
}
