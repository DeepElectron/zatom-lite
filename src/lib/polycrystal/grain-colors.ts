function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Deterministic per-grain color. Golden-angle hue spread gives well-separated
 * yet harmonious colors; medium saturation so grains are distinct but not garish.
 */
export function grainColorHex(grainId: number): string {
  const hue = (grainId * 137.508) % 360
  const sat = 0.52
  const light = grainId % 2 === 0 ? 0.62 : 0.54
  return hslToHex(hue, sat, light)
}
