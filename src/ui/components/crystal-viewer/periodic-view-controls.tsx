import { Box } from 'lucide-react'
import { invert3x3 } from '../../../lib/crystal/lattice-math'
import type { CameraViewSpec } from '../../../lib/render/camera-directions'
import { useViewportManager } from '../../../orchestration/viewportManager'
import { useViewportStore, useViewportStoreApi } from '../../../orchestration/ViewportContext'
import './periodic-view-controls.css'

const VIEWS: { label: string; title: string; view: CameraViewSpec }[] = [
  { label: 'a', title: 'Along a [100]', view: 'a' },
  { label: 'b', title: 'Along b [010]', view: 'b' },
  { label: 'c', title: 'Along c [001]', view: 'c' },
  { label: '(100)', title: 'Normal to (100) · b–c plane', view: { hkl: [1, 0, 0] } },
  { label: '(010)', title: 'Normal to (010) · c–a plane', view: { hkl: [0, 1, 0] } },
  { label: '(001)', title: 'Normal to (001) · a–b plane', view: { hkl: [0, 0, 1] } },
  { label: 'Iso', title: 'Isometric view', view: 'iso' },
]

/** Per-pane camera controls. These never select or modify atoms. */
export function PeriodicViewControls() {
  const available = useViewportStore(s => s.periodic && Object.values(s.periodicDirs).some(Boolean)
    && (s.atoms.length > 0 || Boolean(s.compactStructure)) && Boolean(invert3x3(s.latticeVectors)))
  const setView = useViewportStore(s => s.setPeriodicView)
  const api = useViewportStoreApi()
  if (!available) return null

  return (
    <div className="periodic-view-controls" role="toolbar" aria-label="Periodic views" data-viewport-control
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {VIEWS.map(({label, title, view}, index) => (
        <button key={label} type="button" title={title} aria-label={title}
          className={index < 3 ? 'periodic-view-axis' : index < 6 ? 'periodic-view-plane' : 'periodic-view-iso'}
          style={{ gridColumn: index === 6 ? 4 : index % 3 + 1, gridRow: index < 3 ? 1 : index < 6 ? 2 : '1 / 3' }}
          onClick={event => {
            event.stopPropagation()
            const manager = useViewportManager.getState()
            const slot = Object.values(manager.viewports).find(slot => slot.kind === 'crystal' && Object.is(slot.storeInstance, api))
            if (slot) manager.setActive(slot.id)
            setView(view, event.detail === 0 ? 0 : 180)
          }}>
          {index === 6 ? <><Box size={15} strokeWidth={1.4} aria-hidden="true" /><span>Iso</span></> : label}
        </button>
      ))}
    </div>
  )
}
