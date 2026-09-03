import type { CubData } from "./CubParser"
import {
  DEFAULT_CUBE_FIELD_SLICE,
  EMPTY_CUBE_FIELD_SLICE_SAMPLE,
  type CubeFieldSliceSettings,
  type CubeFieldSliceSampleState,
} from "./cube-field-slice"
import type { MoldenData } from "./MoldenParser"
import type { ColorRange, SurfaceColormap } from "./surface-coloring"
import type { SurfaceExtremum } from "./surface-extrema"

export type MolecularOrbitalSourceType = "cub" | "molden"

/**
 * A second scalar field used only to colour the isosurface (IGMH/NCI
 * sign(λ₂)ρ over a δg surface, or ESP over a density surface). Independent
 * of the surface source: it attaches to a cube or a Molden surface alike.
 */
export interface SurfaceColorField {
  cubData: CubData
  sourceName: string | null
  colormap: SurfaceColormap
  /** null = symmetric auto range from the values sampled on the surface. */
  range: ColorRange | null
  /** Show surface minima/maxima markers (ESP-style surface analysis). */
  showExtrema: boolean
}

/**
 * Derived by the render layer after sampling the colour field on the current
 * surface. The colour bar and the extremum markers read this rather than
 * re-sampling, so all three agree on one range.
 */
export interface SurfaceColorStats {
  /** The range actually mapped through the colormap (auto or user). */
  range: ColorRange
  /** Raw min/max seen on the surface, for the bar's out-of-range hints. */
  sampled: ColorRange
  extrema: readonly SurfaceExtremum[]
}

export interface MolecularOrbitalState {
  colorField: SurfaceColorField | null
  colorFieldStats: SurfaceColorStats | null
  /** True scalar field sampled on the active constructed reference plane. */
  fieldSlice: CubeFieldSliceSettings
  /** Ephemeral render evidence; never treated as a persisted user setting. */
  fieldSliceSample: CubeFieldSliceSampleState
  sourceType: MolecularOrbitalSourceType | null
  sourceName: string | null
  cubData: CubData | null
  moldenData: MoldenData | null
  selectedOrbitalIndex: number
  isoValue: number
  resolution: number
  opacity: number
  positiveColor: string
  negativeColor: string
  visible: boolean
}

export interface CubSurfaceRenderDefaults {
  isoValue: number
  resolution: number
  opacity: number
}

/**
 * A total electron-density surface is normally inspected much farther from
 * the nuclei than a signed orbital lobe. Keep the two profiles explicit so a
 * density-friendly iso value never becomes the global orbital default.
 */
export const ORBITAL_CUB_SURFACE_DEFAULTS: Readonly<CubSurfaceRenderDefaults> = {
  isoValue: 0.03,
  resolution: 34,
  opacity: 0.62,
}

export const ELECTRON_DENSITY_CUB_SURFACE_DEFAULTS: Readonly<CubSurfaceRenderDefaults> = {
  isoValue: 0.002,
  resolution: 60,
  opacity: 0.86,
}

/**
 * Detect only total electron/charge density. Spin, magnetization and
 * difference-density cubes are signed fields and must retain the existing
 * signed-field/orbital rendering profile even when their header contains the
 * words "electron density".
 */
export function isElectronDensityCub(
  data: Pick<CubData, "title" | "comment">,
  sourceName?: string,
): boolean {
  const baseName = sourceName?.split(/[/\\]/).at(-1) ?? ""
  const evidence = `${baseName}\n${data.title ?? ""}\n${data.comment ?? ""}`.toLowerCase()
  const orbital = /(?:^|[\s._-])(?:orbital|homo|lumo|somo|nto)(?:$|[\s._-])/.test(evidence)
  const potential = /electrostatic[\s._-]*potential|(?:^|[\s._-])(?:esp|mep)(?:$|[\s._-])/.test(evidence)
  const signedDensity = /(?:spin|magneti[sz]ation|difference|difference-density|density-difference|\bdiff\b)/
    .test(evidence)
  if (orbital || potential || signedDensity) return false
  return /electron[\s._-]*density|charge[\s._-]*density|total[\s._-]*density|(?:^|[/\\\s._-])density(?:$|[/\\\s._-])|\brho\b/
    .test(evidence)
}

/** Resolve fresh-import defaults from Cube contents and filename. */
export function cubSurfaceRenderDefaults(
  data: Pick<CubData, "title" | "comment">,
  sourceName?: string,
): Readonly<CubSurfaceRenderDefaults> {
  return isElectronDensityCub(data, sourceName)
    ? ELECTRON_DENSITY_CUB_SURFACE_DEFAULTS
    : ORBITAL_CUB_SURFACE_DEFAULTS
}

export const defaultMolecularOrbitalState: MolecularOrbitalState = {
  colorField: null,
  colorFieldStats: null,
  fieldSlice: { ...DEFAULT_CUBE_FIELD_SLICE },
  fieldSliceSample: { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE },
  sourceType: null,
  sourceName: null,
  cubData: null,
  moldenData: null,
  selectedOrbitalIndex: -1,
  ...ORBITAL_CUB_SURFACE_DEFAULTS,
  positiveColor: "#4C8DFF",
  negativeColor: "#FF5C8A",
  visible: true,
}

export function getHomoIndex(data: MoldenData): number {
  for (let index = data.orbitals.length - 1; index >= 0; index -= 1) {
    if ((data.orbitals[index]?.occupation ?? 0) > 0.0001) {
      return index
    }
  }
  return -1
}

export function getLumoIndex(data: MoldenData): number {
  const homoIndex = getHomoIndex(data)
  if (homoIndex >= 0 && homoIndex + 1 < data.orbitals.length) {
    return homoIndex + 1
  }

  return data.orbitals.findIndex((orbital) => (orbital.occupation ?? 0) <= 0.0001)
}

export function formatOrbitalLabel(data: MoldenData, index: number): string {
  const orbital = data.orbitals[index]
  if (!orbital) {
    return `MO ${index + 1}`
  }

  const homoIndex = getHomoIndex(data)
  const lumoIndex = getLumoIndex(data)

  let label = `MO ${index + 1}`
  if (index === homoIndex) {
    label = `HOMO (${index + 1})`
  } else if (index === lumoIndex) {
    label = `LUMO (${index + 1})`
  } else if (homoIndex >= 0 && index < homoIndex) {
    label = `HOMO-${homoIndex - index} (${index + 1})`
  } else if (lumoIndex >= 0 && index > lumoIndex) {
    label = `LUMO+${index - lumoIndex} (${index + 1})`
  }

  const details = [`E=${orbital.energy.toFixed(3)}`]
  if (orbital.spin) {
    details.push(orbital.spin)
  }
  if (Number.isFinite(orbital.occupation)) {
    details.push(`occ=${orbital.occupation.toFixed(2)}`)
  }

  return `${label} • ${details.join(", ")}`
}
