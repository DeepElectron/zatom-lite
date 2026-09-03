/** The pre-paint script and Zustand store must share one appearance contract. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import INDEX_HTML from '../../index.html?raw'
import THEME_BOOTSTRAP_SOURCE from '../../public/theme-bootstrap.js?raw'
import MODELER_VIEW_SOURCE from '../ui/ModelerView.tsx?raw'
import CRYSTAL_VIEWER_SOURCE from '../ui/components/crystal-viewer/index.tsx?raw'
import COMPACT_ATOMS_SOURCE from '../ui/components/crystal-viewer/compact-atoms.tsx?raw'
import INSPECTION_OVERLAY_SOURCE from '../ui/components/crystal-viewer/agent-inspection-overlay.tsx?raw'
import ASSEMBLY_VIEWER_SOURCE from '../ui/components/assembly-viewer/index.tsx?raw'
import ASSEMBLY_SCENE_SOURCE from '../ui/components/assembly-viewer/assembly-scene.tsx?raw'
import LIGHTING_CONTROLS_SOURCE from '../ui/panels/lighting-controls.tsx?raw'
import VISUAL_SETTINGS_SOURCE from '../ui/panels/visual-settings.tsx?raw'
import THEME_STORE_SOURCE from '../host/themeStore.ts?raw'
import { STYLE_PRESETS } from '../lib/render/crystal-visuals'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_SYSTEM_THEME,
  DEFAULT_VIEWPORT_THEME,
  deriveInterfacePalette,
  resolveAppearanceTheme,
  resolveSystemTheme,
  resolveViewportTheme,
  useThemeStore,
} from '../host/themeStore'

const MODELER_CSS = readFileSync('src/app/index.css', 'utf8')

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

const VIEWPORT_PALETTE_BACKGROUNDS = [
  ...STYLE_PRESETS.map((preset) => preset.patch.background),
  '#ff0000',
  '#ff00ff',
  '#777777',
].filter((background): background is string => Boolean(background))

/** The `var appearance = '...'` fallback in the CSP-compatible pre-paint script. */
function prePaintDefault(): string | null {
  const match = THEME_BOOTSTRAP_SOURCE.match(/var\s+appearance\s*=\s*'(system|viewport|light|dark)'/)
  return match ? match[1] : null
}

describe('the pre-paint script and the store agree', () => {
  it('index.html declares a default at all', () => {
    expect(prePaintDefault()).not.toBeNull()
  })

  it('it is the same default the store uses', () => {
    expect(prePaintDefault()).toBe(DEFAULT_APPEARANCE)
  })

  it('the class is derived, never asserted on the html tag', () => {
    // A literal `class="dark"` here cannot be overridden by a stored 'light'
    // preference, and it is what put the two sources of truth out of step.
    const htmlTag = INDEX_HTML.match(/<html[^>]*>/)?.[0] ?? ''
    expect(htmlTag).not.toMatch(/class\s*=/)
  })

  it('both read the same storage key', () => {
    const keyInStore = THEME_STORE_SOURCE.match(/STORAGE_KEY\s*=\s*'([^']+)'/)?.[1]
    expect(keyInStore).toBeTruthy()
    expect(THEME_BOOTSTRAP_SOURCE).toContain(`localStorage.getItem('${keyInStore}')`)
  })

  it('the pre-paint script honours every stored appearance', () => {
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/stored\s*===\s*'system'/)
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/stored\s*===\s*'viewport'/)
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/stored\s*===\s*'light'/)
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/stored\s*===\s*'dark'/)
    expect(THEME_BOOTSTRAP_SOURCE).toContain('document.documentElement.dataset.appearance = appearance')
  })

  it('migrates v2 automatic choices to viewport-aware Auto without losing manual overrides', () => {
    expect(THEME_STORE_SOURCE).toContain("const STORAGE_KEY = 'zatom-appearance-v3'")
    expect(THEME_STORE_SOURCE).toContain("const LEGACY_STORAGE_KEY = 'zatom-appearance-v2'")
    expect(THEME_STORE_SOURCE).toMatch(/legacy === 'light' \|\| legacy === 'dark'/)
    expect(THEME_STORE_SOURCE).toMatch(/legacy === 'system' \|\| legacy === 'viewport'\) return 'viewport'/)
    expect(THEME_BOOTSTRAP_SOURCE).toContain("localStorage.getItem('zatom-appearance-v2')")
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/legacy === 'system' \|\| legacy === 'viewport'\) appearance = 'viewport'/)
  })

  it('System resolves the operating-system scheme before first paint', () => {
    expect(DEFAULT_SYSTEM_THEME).toBe('light')
    expect(THEME_BOOTSTRAP_SOURCE).toContain("window.matchMedia('(prefers-color-scheme: dark)').matches")
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/appearance\s*===\s*'system'/)
  })

  it('Auto starts with the light default VESTA preset before React reads the viewport', () => {
    expect(DEFAULT_VIEWPORT_THEME).toBe('light')
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/appearance\s*===\s*'viewport'/)
  })

  it('first paint has a background for both themes', () => {
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/html\s*\{\s*background-color:\s*#ffffff/)
    expect(THEME_BOOTSTRAP_SOURCE).toMatch(/html\.dark\s*\{\s*background-color:/)
  })
})

describe('appearance resolution', () => {
  it('defaults to Auto', () => {
    expect(DEFAULT_APPEARANCE).toBe('viewport')
  })

  it('keeps Auto coherent with a white viewport while System can follow a dark OS', () => {
    const viewportTheme = resolveViewportTheme('#ffffff')
    expect(resolveAppearanceTheme(DEFAULT_APPEARANCE, 'dark', viewportTheme)).toBe('light')
    expect(resolveAppearanceTheme('system', 'dark', viewportTheme)).toBe('dark')
  })

  it('maps the system preference to the resolved chrome theme', () => {
    expect(resolveSystemTheme(false)).toBe('light')
    expect(resolveSystemTheme(true)).toBe('dark')
  })

  it('resolves Auto and System independently from manual overrides', () => {
    expect(resolveAppearanceTheme('system', 'dark', 'light')).toBe('dark')
    expect(resolveAppearanceTheme('viewport', 'dark', 'light')).toBe('light')
    expect(resolveAppearanceTheme('light', 'dark', 'dark')).toBe('light')
    expect(resolveAppearanceTheme('dark', 'light', 'light')).toBe('dark')
  })

  it('keeps every preset and custom background readable without changing its seed', () => {
    for (const background of VIEWPORT_PALETTE_BACKGROUNDS) {
      const palette = deriveInterfacePalette(background)
      expect(palette.background).toBe(background.toLowerCase())
      for (const surface of [palette.surface, palette.elevated, palette.hover, palette.active]) {
        expect(contrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette.textSecondary, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette.textTertiary, surface)).toBeGreaterThanOrEqual(3)
      }
      expect(contrastRatio(palette.border, palette.surface)).toBeGreaterThanOrEqual(1.75)
      expect(contrastRatio(palette.borderFocus, palette.surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every semantic status readable across all derived panel surfaces', () => {
    for (const background of VIEWPORT_PALETTE_BACKGROUNDS) {
      const palette = deriveInterfacePalette(background)
      for (const foreground of Object.values(palette.status)) {
        for (const surface of [palette.surface, palette.elevated, palette.hover, palette.active]) {
          expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.6)
        }
      }
    }
  })

  it('resolves viewport-local contrast independently of chrome preference', () => {
    expect(resolveViewportTheme('#ffffff')).toBe('light')
    expect(resolveViewportTheme('#101014')).toBe('dark')
    expect(resolveViewportTheme('invalid')).toBe(DEFAULT_VIEWPORT_THEME)
  })

  it('updates only the resolved mode while keeping the other live inputs ready', () => {
    const store = useThemeStore.getState()
    store.setAppearance('dark')
    useThemeStore.getState().setSystemTheme('light')
    useThemeStore.getState().setViewportTheme('light')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(useThemeStore.getState().systemTheme).toBe('light')
    expect(useThemeStore.getState().viewportTheme).toBe('light')

    useThemeStore.getState().setAppearance('system')
    expect(useThemeStore.getState().theme).toBe('light')
    useThemeStore.getState().setSystemTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')

    useThemeStore.getState().setAppearance('viewport')
    expect(useThemeStore.getState().theme).toBe('light')
    useThemeStore.getState().setViewportTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')

    // Leave the singleton in the product default for any later tests in this worker.
    useThemeStore.getState().setSystemTheme(DEFAULT_SYSTEM_THEME)
    useThemeStore.getState().setViewportTheme(DEFAULT_VIEWPORT_THEME)
    useThemeStore.getState().setAppearance(DEFAULT_APPEARANCE)
  })

  it('keeps System synchronized when the system scheme changes at runtime', () => {
    expect(THEME_STORE_SOURCE).toContain('window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY)')
    expect(THEME_STORE_SOURCE).toContain("systemColorScheme.addEventListener('change'")
    expect(THEME_STORE_SOURCE).toContain('setSystemTheme(resolveSystemTheme(event.matches))')
  })
})

describe('modeler chrome materials', () => {
  it('derives the complete Auto palette from the Shader background', () => {
    expect(MODELER_CSS).toMatch(/html\[data-appearance="viewport"\]\s*\{/)
    expect(MODELER_CSS).toMatch(/html\.dark\[data-appearance="viewport"\]\s*\{/)
    expect(MODELER_CSS).toMatch(/\.modeler-root\[data-appearance="viewport"\]\s*\{/)
    expect(MODELER_CSS).toContain('--background: var(--viewport-background)')
    expect(MODELER_CSS).toContain('--workspace-bg: var(--viewport-background)')
    expect(MODELER_CSS).toContain('--panel-bg: var(--auto-theme-surface)')
    expect(MODELER_CSS).toContain('--card: var(--auto-theme-surface)')
    expect(MODELER_CSS).toContain('--popover: var(--auto-theme-elevated)')
    expect(MODELER_CSS).toContain('--sidebar: var(--auto-theme-surface)')
  })

  it('keeps collapsed rails on the semantic panel material', () => {
    const rule = MODELER_CSS.match(/\.modeler-side-panel\[data-collapsed="true"\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('background: var(--glass-bg)')
    expect(rule).toContain('border-color: var(--glass-border)')
  })

  it('resolves Auto before paint when the active viewport changes', () => {
    expect(MODELER_VIEW_SOURCE).toContain('useLayoutEffect')
    expect(MODELER_VIEW_SOURCE).toContain('deriveInterfacePalette(activeViewportBackground)')
    expect(MODELER_VIEW_SOURCE).toContain("'--viewport-background': palette.background")
    expect(MODELER_VIEW_SOURCE).toContain("'--auto-theme-surface': palette.surface")
    expect(MODELER_VIEW_SOURCE).toContain("'--auto-theme-status-success': palette.status.success")
    expect(MODELER_VIEW_SOURCE).toContain('setViewportTheme(palette.theme)')
    expect(MODELER_VIEW_SOURCE).toContain("backgroundImage: theme === 'dark' && appearance !== 'viewport'")
  })

  it('exposes distinct Auto and System choices without a duplicate viewport mode', () => {
    expect(VISUAL_SETTINGS_SOURCE).toContain("options={['Auto', 'System', 'Light', 'Dark']}")
    expect(VISUAL_SETTINGS_SOURCE).toContain("value === 'Auto' ? 'viewport'")
    expect(VISUAL_SETTINGS_SOURCE).toContain("value === 'System' ? 'system'")
    expect(VISUAL_SETTINGS_SOURCE).not.toContain('Match Viewport')
  })

  it('derives quiet status materials from their contrast-safe foregrounds', () => {
    expect(MODELER_CSS).toContain('--status-green: var(--auto-theme-status-success)')
    expect(MODELER_CSS).toContain('--status-amber: var(--auto-theme-status-warning)')
    expect(MODELER_CSS).toContain('--status-red: var(--auto-theme-status-error)')
    expect(MODELER_CSS).toContain('--status-neutral: var(--auto-theme-status-neutral)')
    expect(MODELER_CSS).toContain('color-mix(in srgb, var(--status-green) 9%, transparent)')
    expect(MODELER_CSS).toContain('color-mix(in srgb, var(--status-red) 8%, transparent)')
  })

  it('defines semantic material aliases at root scope for body-level portals', () => {
    for (const token of [
      '--glass-bg:',
      '--glass-bg-active:',
      '--glass-bg-subtle:',
      '--glass-border-subtle:',
      '--text-secondary:',
      '--border-primary:',
    ]) {
      expect(MODELER_CSS).toContain(token)
    }
  })

  it('keeps viewport lighting and overlays independent from chrome preference', () => {
    for (const source of [
      CRYSTAL_VIEWER_SOURCE,
      COMPACT_ATOMS_SOURCE,
      INSPECTION_OVERLAY_SOURCE,
      ASSEMBLY_SCENE_SOURCE,
      LIGHTING_CONTROLS_SOURCE,
    ]) {
      expect(source).not.toContain('useThemeStore')
      expect(source).toContain('resolveViewportTheme')
    }
  })

  it('uses the same viewport background for the assembly canvas and its lighting', () => {
    expect(ASSEMBLY_VIEWER_SOURCE).toContain('useCrystalStore((s) => s.background)')
    expect(ASSEMBLY_VIEWER_SOURCE).toContain('style={{ background }}')
    expect(ASSEMBLY_VIEWER_SOURCE).not.toContain("background: 'transparent'")
    expect(ASSEMBLY_SCENE_SOURCE).toContain('resolveViewportTheme(background)')
  })
})
