// Colormaps shared by JavaScript previews and GLSL rendering.
export const COLORMAP_OPTIONS = [
  { value: 'rainbow', label: 'Rainbow (VESTA)' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'coolwarm', label: 'CoolWarm' },
  { value: 'bwr', label: 'Blue-White-Red (difference)' },
  { value: 'ironbow', label: 'Ironbow (thermal)' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'turbo', label: 'Turbo (Google)' },
  { value: 'magma', label: 'Magma' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'cividis', label: 'Cividis (colour-blind safe)' },
  { value: 'spectral', label: 'Spectral' },
  { value: 'piyg', label: 'PiYG (difference)' },
  { value: 'terrain', label: 'Terrain' },
] as const

export type ColormapName = (typeof COLORMAP_OPTIONS)[number]['value']

export const COLORMAP_INDEX: Record<ColormapName, number> = {
  rainbow: 0,
  viridis: 1,
  coolwarm: 2,
  bwr: 3,
  ironbow: 4,
  grayscale: 5,
  turbo: 6,
  magma: 7,
  plasma: 8,
  inferno: 9,
  cividis: 10,
  spectral: 11,
  piyg: 12,
  terrain: 13,
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/* Six-stop interpolation shared by the JavaScript and GLSL implementations. */

type Stops = [string, string, string, string, string, string]

// Six anchor colors per interpolated map.
const STOP_MAPS: Partial<Record<ColormapName, Stops>> = {
  turbo: ['#30123B', '#3E9BFE', '#46F884', '#E1DD37', '#F05B12', '#7A0403'],
  magma: ['#000004', '#3B0F70', '#8C2981', '#DE4968', '#FE9F6D', '#FCFDBF'],
  plasma: ['#0D0887', '#6A00A8', '#B12A90', '#E16462', '#FCA636', '#F0F921'],
  inferno: ['#000004', '#420A68', '#932667', '#DD513A', '#FCA50A', '#FCFFA4'],
  cividis: ['#00224E', '#35456C', '#666970', '#948E77', '#C8B866', '#FEE838'],
  spectral: ['#5E4FA2', '#66C2A5', '#E6F598', '#FEE08B', '#F46D43', '#9E0142'],
  piyg: ['#8E0152', '#DE77AE', '#FDE0EF', '#E6F5D0', '#7FBC41', '#276419'],
  terrain: ['#333399', '#0099FF', '#33CC66', '#FFF2AE', '#996633', '#FFFFFF'],
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function sampleStops(stops: Stops, t: number): [number, number, number] {
  const x = clamp01(t) * 5
  const i = Math.min(4, Math.floor(x))
  const f = x - i
  const a = hexToRgb(stops[i])
  const b = hexToRgb(stops[i + 1])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// JS implementation, used for panel color bar gradient preview
export function colormapJS(name: ColormapName, t: number): [number, number, number] {
  t = clamp01(t)
  const stops = STOP_MAPS[name]
  if (stops) return sampleStops(stops, t)
  switch (name) {
    case 'rainbow': {
      // Blue→Cyan→Green→Yellow→Red (jet simplified version, same as VESTA cut)
      const r = clamp01(1.5 - Math.abs(4 * t - 3))
      const g = clamp01(1.5 - Math.abs(4 * t - 2))
      const b = clamp01(1.5 - Math.abs(4 * t - 1))
      return [r, g, b]
    }
    case 'viridis': {
      // polynomial fitting
      const r = clamp01(0.267 + t * (0.005 + t * (2.31 * t - 1.19)))
      const g = clamp01(0.005 + t * (1.39 + t * (-0.66 + 0.17 * t)))
      const b = clamp01(0.329 + t * (1.38 + t * (-3.05 + 1.5 * t)))
      return [r, g, b]
    }
    case 'coolwarm': {
      const r = clamp01(0.23 + t * (1.42 - 0.71 * t))
      const g = clamp01(0.3 + t * (1.7 - 1.96 * t))
      const b = clamp01(0.75 + t * (0.6 - 1.2 * t))
      return [r, g, b]
    }
    case 'bwr': {
      if (t < 0.5) {
        const s = t * 2
        return [s, s, 1]
      }
      const s = (t - 0.5) * 2
      return [1, 1 - s, 1 - s]
    }
    case 'ironbow': {
      const r = clamp01(t * 3)
      const g = clamp01(t * 3 - 1)
      const b = t < 0.35 ? clamp01(t * 2.2) : clamp01(t * 3 - 2) * 0.9 + (t > 0.85 ? (t - 0.85) * 4 : 0)
      return [r, g, clamp01(b)]
    }
    default:
      return [t, t, t]
  }
}

export function colormapCSSGradient(name: ColormapName, stops = 24): string {
  const parts: string[] = []
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1)
    const [r, g, b] = colormapJS(name, t)
    parts.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${Math.round(t * 100)}%`)
  }
  return `linear-gradient(to right, ${parts.join(', ')})`
}

/*
 * ---------- GLSL version (used in slice shader, uCmap selection branch) ----------
 */

// Generate GLSL mix chain from 6-level color scale
function glslStops(stops: Stops): string {
  const v = (hex: string) => {
    const [r, g, b] = hexToRgb(hex)
    return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`
  }
  return `{
    float x = t * 5.0;
    vec3 c0 = ${v(stops[0])}; vec3 c1 = ${v(stops[1])}; vec3 c2 = ${v(stops[2])};
    vec3 c3 = ${v(stops[3])}; vec3 c4 = ${v(stops[4])}; vec3 c5 = ${v(stops[5])};
    if (x < 1.0) return mix(c0, c1, x);
    if (x < 2.0) return mix(c1, c2, x - 1.0);
    if (x < 3.0) return mix(c2, c3, x - 2.0);
    if (x < 4.0) return mix(c3, c4, x - 3.0);
    return mix(c4, c5, min(x - 4.0, 1.0));
  }`
}

export const COLORMAP_GLSL = /* glsl */ `
vec3 applyColormap(int id, float t) {
  t = clamp(t, 0.0, 1.0);
  if (id == 0) {
    // rainbow / jet
    return clamp(vec3(
      1.5 - abs(4.0 * t - 3.0),
      1.5 - abs(4.0 * t - 2.0),
      1.5 - abs(4.0 * t - 1.0)
    ), 0.0, 1.0);
  } else if (id == 1) {
    // viridis polynomial fitting
    return clamp(vec3(
      0.267 + t * (0.005 + t * (2.31 * t - 1.19)),
      0.005 + t * (1.39 + t * (-0.66 + 0.17 * t)),
      0.329 + t * (1.38 + t * (-3.05 + 1.5 * t))
    ), 0.0, 1.0);
  } else if (id == 2) {
    // coolwarm
    return clamp(vec3(
      0.23 + t * (1.42 - 0.71 * t),
      0.30 + t * (1.70 - 1.96 * t),
      0.75 + t * (0.60 - 1.20 * t)
    ), 0.0, 1.0);
  } else if (id == 3) {
    // blue white red
    return t < 0.5 ? vec3(t * 2.0, t * 2.0, 1.0) : vec3(1.0, 2.0 - t * 2.0, 2.0 - t * 2.0);
  } else if (id == 4) {
    // ironbow
    float b = t < 0.35 ? t * 2.2 : clamp(t * 3.0 - 2.0, 0.0, 1.0) * 0.9 + max(0.0, (t - 0.85) * 4.0);
    return clamp(vec3(t * 3.0, t * 3.0 - 1.0, b), 0.0, 1.0);
  } else if (id == 6) ${glslStops(STOP_MAPS.turbo!)}
  else if (id == 7) ${glslStops(STOP_MAPS.magma!)}
  else if (id == 8) ${glslStops(STOP_MAPS.plasma!)}
  else if (id == 9) ${glslStops(STOP_MAPS.inferno!)}
  else if (id == 10) ${glslStops(STOP_MAPS.cividis!)}
  else if (id == 11) ${glslStops(STOP_MAPS.spectral!)}
  else if (id == 12) ${glslStops(STOP_MAPS.piyg!)}
  else if (id == 13) ${glslStops(STOP_MAPS.terrain!)}
  return vec3(t);
}
`
