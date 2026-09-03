import { describe, expect, it } from 'vitest'

import ANIMATION_WORKSPACE_SOURCE from '../ui/panels/animation-workspace.tsx?raw'
import BIOMOLECULE_SETTINGS_SOURCE from '../ui/panels/biomolecule-settings.tsx?raw'
import INSPECTOR_SOURCE from '../ui/panels/inspector-panel.tsx?raw'
import MODELER_SOURCE from '../ui/ModelerView.tsx?raw'
import SIDEBAR_SOURCE from '../ui/panels/sidebar-tabs.tsx?raw'
import CRYSTAL_VIEWER_SOURCE from '../ui/components/crystal-viewer/index.tsx?raw'
import VISUAL_SETTINGS_SOURCE from '../ui/panels/visual-settings.tsx?raw'
import { resolveInspectorWorkspace } from '../ui/panels/inspector-workspace-route'

describe('Animation Inspector workspace', () => {
  it('starts with two discoverable collapsed rails and preserves that choice after import', () => {
    expect(MODELER_SOURCE).toContain('const [sidebarCollapsed, setSidebarCollapsed] = useState(true)')
    expect(MODELER_SOURCE).toContain('const [inspectorCollapsed, setInspectorCollapsed] = useState(true)')
    expect(MODELER_SOURCE).toContain('const [inspectorWidth, setInspectorWidth] = useState(52)')
    expect(MODELER_SOURCE).not.toContain('previousAtomCount')
    expect(SIDEBAR_SOURCE).toContain('const [localCollapsed, setLocalCollapsed] = useState(true)')
    expect(INSPECTOR_SOURCE).toContain('const [localCollapsed, setLocalCollapsed] = useState(true)')
  })

  it('temporarily owns the route without changing the selected Inspector tab', () => {
    expect(resolveInspectorWorkspace(false, 'functions')).toBe('functions')
    expect(resolveInspectorWorkspace(true, 'functions')).toBe('animation')
    expect(resolveInspectorWorkspace(false, 'functions')).toBe('functions')

    expect(resolveInspectorWorkspace(false, 'visual')).toBe('visual')
    expect(resolveInspectorWorkspace(true, 'visual')).toBe('animation')
    expect(resolveInspectorWorkspace(false, 'visual')).toBe('visual')
  })

  it('keeps timeline and layer authoring in one unique owner', () => {
    expect(ANIMATION_WORKSPACE_SOURCE.match(/<PresentationTimeline\s*\/>/g)).toHaveLength(1)
    expect(ANIMATION_WORKSPACE_SOURCE.match(/<BiomoleculeLayersSettings\s*\/>/g)).toHaveLength(1)
    expect(ANIMATION_WORKSPACE_SOURCE.match(/<CrystalLayersSettings\s*\/>/g)).toHaveLength(1)
    expect(VISUAL_SETTINGS_SOURCE).not.toContain('<PresentationTimeline')
    expect(VISUAL_SETTINGS_SOURCE).not.toContain('<CrystalLayersSettings')
    expect(BIOMOLECULE_SETTINGS_SOURCE.match(/id="bio-layers-heading"/g)).toHaveLength(1)
    expect(BIOMOLECULE_SETTINGS_SOURCE).toContain('export function BiomoleculeLayersSettings()')
  })

  it('places the unframed animation control between system data and Collapse', () => {
    const systemData = INSPECTOR_SOURCE.indexOf('<SystemDataCards')
    const animation = INSPECTOR_SOURCE.indexOf('id="inspector-animation-toggle"')
    const collapse = INSPECTOR_SOURCE.indexOf('aria-label="Collapse Inspector"', animation)
    const animationButton = INSPECTOR_SOURCE.slice(animation, collapse)

    expect(systemData).toBeGreaterThan(-1)
    expect(animation).toBeGreaterThan(systemData)
    expect(collapse).toBeGreaterThan(animation)
    expect(animationButton).toContain('className="zatom-pressable')
    expect(animationButton).not.toContain('zatom-choice')
    expect(animationButton).toContain("backgroundColor: animationOpen ? 'var(--control-selected-bg)' : 'transparent'")
    expect(INSPECTOR_SOURCE).toContain('id="inspector-header-controls"')
    expect(INSPECTOR_SOURCE).toContain('className="ml-auto flex shrink-0 items-center gap-0.5"')
    expect(INSPECTOR_SOURCE).toContain('modeler-system-data-cards relative')
    expect(INSPECTOR_SOURCE).toContain('onPointerMove={handlePointerMove}')
    expect(INSPECTOR_SOURCE).toContain("event.target.closest<HTMLElement>('[data-datum]')")
    expect(INSPECTOR_SOURCE).toContain('data-datum="atoms"')
    expect(INSPECTOR_SOURCE).toContain('data-datum="middle"')
    expect(INSPECTOR_SOURCE).toContain('data-datum="elements"')
    expect(INSPECTOR_SOURCE).toContain('onPointerLeave={handlePointerLeave}')
    expect(INSPECTOR_SOURCE).toContain('hoverIntentTimer.current = setTimeout')
    expect(INSPECTOR_SOURCE).toContain('}, 120)')
    expect(INSPECTOR_SOURCE).toContain('pointerSettling.current = true')
    expect(INSPECTOR_SOURCE).toContain('}, 480)')
    expect(INSPECTOR_SOURCE).not.toContain("onPointerEnter={() => setActiveDatum('atoms')}")
    expect(INSPECTOR_SOURCE).not.toContain("onPointerEnter={() => setActiveDatum('middle')}")
    expect(INSPECTOR_SOURCE).not.toContain("onMouseEnter={() => { setActiveDatum('elements')")
    expect(INSPECTOR_SOURCE).toContain("onFocusCapture={() => activateFromFocus('atoms')}")
    expect(INSPECTOR_SOURCE).toContain('className="absolute left-0 top-full')
    expect(INSPECTOR_SOURCE).not.toContain('className="absolute right-0 top-full')
    expect(INSPECTOR_SOURCE).toContain("resolveInspectorWorkspace(animationOpen, activeInspectorTab)")
  })

  it('stacks detailed selection information above the biomolecular sequence', () => {
    const stack = MODELER_SOURCE.indexOf('data-testid="viewport-bottom-stack"')
    const selection = MODELER_SOURCE.indexOf('<SelectionInfoOverlay />', stack)
    const sequence = MODELER_SOURCE.indexOf('<BiomoleculeSequenceStrip', stack)
    const toolbar = MODELER_SOURCE.indexOf('<BottomToolbar />', stack)

    expect(stack).toBeGreaterThan(-1)
    expect(selection).toBeGreaterThan(stack)
    expect(sequence).toBeGreaterThan(selection)
    expect(toolbar).toBeGreaterThan(sequence)
    expect(CRYSTAL_VIEWER_SOURCE).toContain('export function SelectionInfoOverlay()')
    expect(CRYSTAL_VIEWER_SOURCE).not.toContain('absolute bottom-28')
    expect(CRYSTAL_VIEWER_SOURCE).toContain("primary: `${atom.element} · ${atom.name} · ${residueLabel}`")
    expect(CRYSTAL_VIEWER_SOURCE).toContain('residue.identity.sequenceNumber')
    expect(CRYSTAL_VIEWER_SOURCE).toContain('coordinateLabel(position)')
    expect(CRYSTAL_VIEWER_SOURCE).toContain(".map(([symbol, count]) => `${symbol}${count > 1 ? ` ×${count}` : ''}`)")
  })
})
