/**
 * XRD wavelengths in Ångström (Å) for common laboratory radiation sources.
 * Standard IUPAC/IUCr values; reference Bearden 1967, Deslattes 2003.
 */
export const WAVELENGTHS = {
  CuKa: 1.54184,
  CuKa2: 1.54439,
  CuKa1: 1.54056,
  CuKb1: 1.39222,
  MoKa: 0.71073,
  MoKa2: 0.71359,
  MoKa1: 0.7093,
  MoKb1: 0.63229,
  CrKa: 2.291,
  CrKa2: 2.29361,
  CrKa1: 2.2897,
  CrKb1: 2.08487,
  FeKa: 1.93735,
  FeKa2: 1.93998,
  FeKa1: 1.93604,
  FeKb1: 1.75661,
  CoKa: 1.79026,
  CoKa2: 1.79285,
  CoKa1: 1.78896,
  CoKb1: 1.63079,
  AgKa: 0.560885,
  AgKa2: 0.563813,
  AgKa1: 0.559421,
  AgKb1: 0.497082,
} as const

export type RadiationKey = keyof typeof WAVELENGTHS

export type Hkl = [number, number, number]
export interface HklObj {
  hkl: Hkl
  multiplicity: number
}

export interface XrdSite {
  element: string
  /** Fractional coordinates in [0, 1) (wrapped on input is fine — phase is mod 2π). */
  frac: [number, number, number]
  occupancy?: number
}

export interface XrdStructure {
  sites: XrdSite[]
  lattice: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]
}

export interface XrdPattern {
  /** 2θ in degrees. */
  x: number[]
  /** Intensity (scaled to 100 by default). */
  y: number[]
  /** Per-peak HKL families with multiplicities. */
  hkls?: HklObj[][]
  /** d-spacing in Å. */
  d_hkls?: number[]
}

export interface XrdOptions {
  wavelength?: number | RadiationKey
  /** Per-element Debye–Waller B factor (Å²). */
  debye_waller_factors?: Record<string, number>
  /** When `null`, integrate to the Bragg limit (2/λ); otherwise [θ_min, θ_max] in degrees. */
  two_theta_range?: [number, number] | null
  /** Merge two peaks within this many degrees (default 1e-5). */
  peak_merge_tol?: number
  /** Drop peaks whose scaled intensity (% of max) is below this (default 1e-3). */
  scaled_intensity_tol?: number
  /** Rescale so the largest peak is 100 (default true). */
  scaled?: boolean
}

export interface XrdEntry {
  id: string
  label: string
  pattern: XrdPattern
  color: string
  wavelength: number
  radiation: RadiationKey | 'custom'
}

export const AVAILABLE_RADIATION = Object.keys(WAVELENGTHS) as RadiationKey[]
