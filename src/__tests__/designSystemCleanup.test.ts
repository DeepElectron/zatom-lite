import { describe, expect, it } from 'vitest'

import PLANE_TOOL_BARS from '../ui/panels/components/plane-tool-bars.tsx?raw'
import MOLECULE_TOOL_BAR from '../ui/panels/components/molecule-tool-bar.tsx?raw'
import PLANE_VIEW from '../ui/panels/plane-2d-view.tsx?raw'
import VIEW_SETTINGS from '../ui/panels/view-settings.tsx?raw'
import PANEL_UI from '../ui/panels/panel-ui.tsx?raw'
import AGENT_PANEL from '../ui/panels/agent-modeling-panel.tsx?raw'
import AGENT_FIELDS from '../ui/panels/agent-modeling-fields.tsx?raw'
import AGENT_TASK from '../ui/panels/agent-modeling-task.tsx?raw'
import AGENT_RESULT from '../ui/panels/agent-modeling-result.tsx?raw'
import AGENT_TRANSFER from '../ui/panels/agent-modeling-project-transfer.tsx?raw'
import MOF_ANALYZER from '../ui/panels/mof-analyzer.tsx?raw'
import CHART_VIEWPORT from '../ui/components/viewport-grid/ChartViewport.tsx?raw'
import PANEL_STATUS from '../ui/panels/panel-status.ts?raw'
import MOLECULE_MULTI_SELECT from '../ui/panels/components/molecule-multi-select-toolbar.tsx?raw'
import SLAB_BUILDER from '../ui/panels/slab-builder.tsx?raw'
import STRUCTURE_PANEL from '../ui/panels/structure-panel.tsx?raw'

const DARK_ONLY_SURFACE = /background(?:Color)?:\s*['"]rgba\((?:0,0,0|255,255,255)/

describe('2D editing controls', () => {
  it('uses semantic element choices instead of dark-only button colors', () => {
    expect(PLANE_TOOL_BARS).toContain('ElementChoice')
    expect(MOLECULE_TOOL_BAR).toContain('ElementChoice')
    expect(PLANE_TOOL_BARS).not.toMatch(/rgba\(255,255,255/)
    expect(MOLECULE_TOOL_BAR).not.toMatch(/rgba\(255,255,255/)
    expect(PLANE_TOOL_BARS).toContain('role="radiogroup"')
    expect(MOLECULE_TOOL_BAR).toContain('role="radiogroup"')
  })

  it('makes the Snap switch control real snapping behavior', () => {
    expect(PLANE_VIEW).toContain('snapEnabled && showSnapPoints')
    expect(PLANE_VIEW).toContain('if (!snapEnabled || !hoveredAtomId')
    expect(PLANE_TOOL_BARS).toContain('disabled={!snapEnabled}')
  })
})

describe('performance controls', () => {
  it('models render modes as metadata and keeps Detailed neutral', () => {
    expect(VIEW_SETTINGS).toContain('PERFORMANCE_MODE_META')
    expect(VIEW_SETTINGS).toMatch(/detailed:\s*\{[\s\S]*?label: "Detailed"[\s\S]*?status-neutral/)
    expect(VIEW_SETTINGS).not.toContain("renderMode === 'ultra'")
  })

  it('uses shared accessible range and toggle rows', () => {
    expect(VIEW_SETTINGS).toContain('<RangeSliderRow')
    expect(VIEW_SETTINGS).toContain('<ToggleRow')
    expect(VIEW_SETTINGS).not.toContain('pointer-events-none [&::-webkit-slider-thumb]')
    expect(PANEL_UI).toContain('role="switch"')
    expect(PANEL_UI).toContain('var(--control-selected-bg)')
  })
})

describe('bounded theme hotspot cleanup', () => {
  it('removes fixed black and white chrome surfaces from touched areas', () => {
    for (const source of [
      AGENT_PANEL,
      AGENT_FIELDS,
      AGENT_TASK,
      AGENT_RESULT,
      AGENT_TRANSFER,
      MOF_ANALYZER,
      CHART_VIEWPORT,
    ]) {
      expect(source).not.toMatch(DARK_ONLY_SURFACE)
    }
  })

  it('keeps chart data colors while making chart chrome semantic', () => {
    expect(CHART_VIEWPORT).toContain('stroke="var(--panel-border)"')
    expect(CHART_VIEWPORT).toContain("backgroundColor: 'var(--panel-elevated)'")
    expect(CHART_VIEWPORT).toContain("backgroundColor: '#34d399'")
    expect(CHART_VIEWPORT).toContain("backgroundColor: '#f59e0b'")
  })
})

describe('continued semantic status cleanup', () => {
  it('defines one shared token map for operational status tones', () => {
    expect(PANEL_STATUS).toContain('PANEL_STATUS_TONES')
    for (const tone of ['green', 'amber', 'red', 'neutral']) {
      expect(PANEL_STATUS).toContain(`var(--status-${tone})`)
      expect(PANEL_STATUS).toContain(`var(--status-${tone}-bg)`)
      expect(PANEL_STATUS).toContain(`var(--status-${tone}-border)`)
    }
  })

  it('removes dark-only chrome from the molecule multi-select toolbar', () => {
    expect(MOLECULE_MULTI_SELECT).toContain('var(--panel-bg)')
    expect(MOLECULE_MULTI_SELECT).toContain('var(--panel-border)')
    expect(MOLECULE_MULTI_SELECT).toContain('zatom-choice zatom-pressable')
    expect(MOLECULE_MULTI_SELECT).not.toMatch(/rgba\((?:0,0,0|255,255,255)/)
    expect(MOLECULE_MULTI_SELECT).not.toContain('text-white/40')
    expect(MOLECULE_MULTI_SELECT).not.toContain('hover:bg-white/10')
  })

  it('routes builder, structure, and review status chrome through semantic tones', () => {
    for (const source of [SLAB_BUILDER, STRUCTURE_PANEL, VIEW_SETTINGS]) {
      expect(source).toContain('panel-status')
      expect(source).not.toMatch(/rgba\((?:255,69,58|245,158,11|48,209,88|239,68,68|34,197,94)/)
      expect(source).not.toMatch(/#(?:FF453A|F59E0B|30D158|22C55E|EF4444)/i)
    }
  })

})
