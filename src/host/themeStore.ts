/**
 * Interface appearance store.
 *
 * `appearance` is the persisted user choice. `theme` is the resolved light/dark
 * chrome used by CSS and native window controls. Auto (`viewport`) follows the
 * active scientific viewport's perceived background brightness; System follows
 * the operating system in real time. The render background itself remains owned
 * by the visual-style store and is never overwritten here.
 */
import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type Appearance = 'system' | 'viewport' | Theme

/** No stored preference → keep interface chrome coherent with the scientific view. */
export const DEFAULT_APPEARANCE: Appearance = 'viewport'
export const DEFAULT_SYSTEM_THEME: Theme = 'light'
export const DEFAULT_VIEWPORT_THEME: Theme = 'light'

export const SYSTEM_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

// v2 exposed `system` under the label “Auto”. In v3, Auto means viewport-aware;
// the explicit System choice retains the operating-system behavior.
const STORAGE_KEY = 'zatom-appearance-v3'
const LEGACY_STORAGE_KEY = 'zatom-appearance-v2'

type RgbColor = [number, number, number]

export interface InterfacePalette {
  theme: Theme
  background: string
  text: string
  textSecondary: string
  textTertiary: string
  surface: string
  elevated: string
  hover: string
  active: string
  border: string
  borderFocus: string
  primaryHover: string
  status: InterfaceStatusPalette
}

export interface InterfaceStatusPalette {
  success: string
  warning: string
  error: string
  neutral: string
}

const STATUS_BASE_COLORS: Record<Theme, Record<keyof InterfaceStatusPalette, RgbColor>> = {
  light: {
    success: [31, 103, 61],
    warning: [112, 69, 13],
    error: [144, 56, 50],
    neutral: [80, 89, 103],
  },
  dark: {
    success: [123, 196, 148],
    warning: [214, 164, 95],
    error: [231, 137, 130],
    neutral: [166, 173, 187],
  },
}

function parseHexColor(value: string): RgbColor | null {
  const raw = value.trim().replace(/^#/, '')
  const expanded = raw.length === 3
    ? raw.split('').map((character) => character + character).join('')
    : raw
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ]
}

function colorToHex(color: RgbColor): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function mixColor(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const weight = Math.min(Math.max(amount, 0), 1)
  return [
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
  ]
}

function roundedColor(color: RgbColor): RgbColor {
  return color.map((channel) => Math.round(channel)) as RgbColor
}

function linearSrgb(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: RgbColor): number {
  return 0.2126 * linearSrgb(color[0])
    + 0.7152 * linearSrgb(color[1])
    + 0.0722 * linearSrgb(color[2])
}

function contrastRatio(left: RgbColor, right: RgbColor): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

function minimumContrast(foreground: RgbColor, backgrounds: RgbColor[]): number {
  return Math.min(...backgrounds.map((background) => contrastRatio(foreground, background)))
}

/** Mute foreground toward the seed as far as the requested contrast allows. */
function readableMutedColor(
  foreground: RgbColor,
  seed: RgbColor,
  surfaces: RgbColor[],
  minimumRatio: number,
): RgbColor {
  if (minimumContrast(foreground, surfaces) < minimumRatio) return foreground
  let readable = 0
  let unreadable = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const amount = (readable + unreadable) / 2
    const candidate = mixColor(foreground, seed, amount)
    if (minimumContrast(candidate, surfaces) >= minimumRatio) readable = amount
    else unreadable = amount
  }
  return mixColor(foreground, seed, readable)
}

/** Preserve each familiar status hue, moving only as far toward text as contrast requires. */
function readableStatusColor(
  base: RgbColor,
  foreground: RgbColor,
  surfaces: RgbColor[],
  minimumRatio: number,
): RgbColor {
  const roundedBase = roundedColor(base)
  if (minimumContrast(roundedBase, surfaces) >= minimumRatio) return roundedBase
  const roundedForeground = roundedColor(foreground)
  if (minimumContrast(roundedForeground, surfaces) < minimumRatio) return roundedForeground

  let insufficient = 0
  let sufficient = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const amount = (insufficient + sufficient) / 2
    const candidate = roundedColor(mixColor(base, foreground, amount))
    if (minimumContrast(candidate, surfaces) >= minimumRatio) sufficient = amount
    else insufficient = amount
  }
  return roundedColor(mixColor(base, foreground, sufficient))
}

/** Find the quietest separator that still contrasts with its owning surface. */
function separatorColor(surface: RgbColor, foreground: RgbColor, minimumRatio: number): RgbColor {
  let insufficient = 0
  let sufficient = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const amount = (insufficient + sufficient) / 2
    const candidate = mixColor(surface, foreground, amount)
    if (contrastRatio(surface, candidate) >= minimumRatio) sufficient = amount
    else insufficient = amount
  }
  return mixColor(surface, foreground, sufficient)
}

/**
 * Derive a complete, contrast-safe interface palette from a Shader background.
 * The seed itself is never changed. Familiar surfaces normally move toward the
 * foreground; saturated/mid-tone custom colors automatically reverse the ramp so
 * readable text is preserved.
 */
export function deriveInterfacePalette(
  background: string,
  fallbackTheme: Theme = DEFAULT_VIEWPORT_THEME,
): InterfacePalette {
  const parsed = parseHexColor(background)
  const seed: RgbColor = parsed ?? (fallbackTheme === 'dark' ? [16, 16, 20] : [255, 255, 255])
  const normalizedBackground = colorToHex(seed)
  const black: RgbColor = [0, 0, 0]
  const white: RgbColor = [255, 255, 255]
  const theme: Theme = contrastRatio(seed, black) >= contrastRatio(seed, white) ? 'light' : 'dark'
  const foreground = theme === 'light' ? black : white
  const awayFromForeground = theme === 'light' ? white : black
  const weights = theme === 'light'
    ? [0.035, 0.075, 0.115, 0.15]
    : [0.055, 0.1, 0.15, 0.2]
  const preferredActive = mixColor(seed, foreground, weights[3])
  const rampTarget = contrastRatio(preferredActive, foreground) >= 4.6
    ? foreground
    : awayFromForeground
  const [surface, elevated, hover, active] = weights.map((weight) => mixColor(seed, rampTarget, weight)) as [RgbColor, RgbColor, RgbColor, RgbColor]
  const surfaces = [surface, elevated, hover, active]
  const renderedSurfaces = surfaces.map(roundedColor)
  const textSecondary = readableMutedColor(foreground, seed, surfaces, 4.6)
  const textTertiary = readableMutedColor(foreground, seed, surfaces, 3.3)
  const primaryHover = readableMutedColor(foreground, seed, [seed], 4.6)
  const statusBases = STATUS_BASE_COLORS[theme]
  const status: InterfaceStatusPalette = {
    success: colorToHex(readableStatusColor(statusBases.success, foreground, renderedSurfaces, 4.6)),
    warning: colorToHex(readableStatusColor(statusBases.warning, foreground, renderedSurfaces, 4.6)),
    error: colorToHex(readableStatusColor(statusBases.error, foreground, renderedSurfaces, 4.6)),
    neutral: colorToHex(readableStatusColor(statusBases.neutral, foreground, renderedSurfaces, 4.6)),
  }

  return {
    theme,
    background: normalizedBackground,
    text: colorToHex(foreground),
    textSecondary: colorToHex(textSecondary),
    textTertiary: colorToHex(textTertiary),
    surface: colorToHex(surface),
    elevated: colorToHex(elevated),
    hover: colorToHex(hover),
    active: colorToHex(active),
    border: colorToHex(separatorColor(surface, foreground, 1.85)),
    borderFocus: colorToHex(separatorColor(surface, foreground, 3.05)),
    primaryHover: colorToHex(primaryHover),
    status,
  }
}

/** Deterministic per-viewport contrast for lighting and overlays. */
export function resolveViewportTheme(background: string): Theme {
  const rgb = parseHexColor(background)
  if (!rgb) return DEFAULT_VIEWPORT_THEME
  const luminance = relativeLuminance(rgb)
  return luminance < 0.4 ? 'dark' : 'light'
}

export function resolveSystemTheme(matchesDark: boolean): Theme {
  return matchesDark ? 'dark' : 'light'
}

export function resolveAppearanceTheme(
  appearance: Appearance,
  systemTheme: Theme,
  viewportTheme: Theme,
): Theme {
  if (appearance === 'system') return systemTheme
  if (appearance === 'viewport') return viewportTheme
  return appearance
}

function readSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_SYSTEM_THEME
  }
  return resolveSystemTheme(window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY).matches)
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.appearance = appearance
}

function storedAppearance(): Appearance | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'system' || value === 'viewport' || value === 'light' || value === 'dark') return value

    // Preserve explicit Light/Dark choices. Both old automatic choices migrate
    // to the new viewport-aware Auto so a white canvas cannot reopen with dark
    // chrome merely because the OS is dark.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy === 'light' || legacy === 'dark') return legacy
    if (legacy === 'system' || legacy === 'viewport') return 'viewport'
    return null
  } catch {
    // Private-mode Safari and friends throw on localStorage access; a theme is not
    // worth failing to boot over.
    return null
  }
}

interface ThemeState {
  appearance: Appearance
  systemTheme: Theme
  viewportTheme: Theme
  theme: Theme
  setAppearance: (appearance: Appearance) => void
  setSystemTheme: (theme: Theme) => void
  setViewportTheme: (theme: Theme) => void
}

const initialAppearance = storedAppearance() ?? DEFAULT_APPEARANCE
const initialSystemTheme = readSystemTheme()
const initialTheme = resolveAppearanceTheme(
  initialAppearance,
  initialSystemTheme,
  DEFAULT_VIEWPORT_THEME,
)

export const useThemeStore = create<ThemeState>((set, get) => ({
  appearance: initialAppearance,
  systemTheme: initialSystemTheme,
  viewportTheme: DEFAULT_VIEWPORT_THEME,
  theme: initialTheme,
  setAppearance: (appearance) => {
    if (get().appearance === appearance) return
    try {
      localStorage.setItem(STORAGE_KEY, appearance)
    } catch {
      // A denied storage write must not block the live appearance change.
    }
    const state = get()
    const theme = resolveAppearanceTheme(appearance, state.systemTheme, state.viewportTheme)
    applyAppearance(appearance)
    if (theme !== state.theme) applyTheme(theme)
    set({ appearance, theme })
  },
  setSystemTheme: (systemTheme) => {
    const state = get()
    if (state.systemTheme === systemTheme) return
    if (state.appearance === 'system' && state.theme !== systemTheme) applyTheme(systemTheme)
    set({
      systemTheme,
      ...(state.appearance === 'system' ? { theme: systemTheme } : {}),
    })
  },
  setViewportTheme: (viewportTheme) => {
    const state = get()
    if (state.viewportTheme === viewportTheme) return
    if (state.appearance === 'viewport' && state.theme !== viewportTheme) applyTheme(viewportTheme)
    set({
      viewportTheme,
      ...(state.appearance === 'viewport' ? { theme: viewportTheme } : {}),
    })
  },
}))

// Boot: the pre-paint script in index.html has already put the class on <html>, so
// this only covers the case where the document was built without it (tests, SSR,
// an embedder supplying its own shell).
if (typeof document !== 'undefined') {
  applyAppearance(initialAppearance)
  applyTheme(initialTheme)
}

// System appearance can change while Zatom is open. Keep the browser chrome in
// sync without touching explicit Light/Dark or Viewport preferences.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const systemColorScheme = window.matchMedia(SYSTEM_COLOR_SCHEME_QUERY)
  systemColorScheme.addEventListener('change', (event) => {
    useThemeStore.getState().setSystemTheme(resolveSystemTheme(event.matches))
  })
}
