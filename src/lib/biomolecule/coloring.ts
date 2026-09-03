import { getElement } from "../crystal/elements"
import { BIO_HYDROPHOBICITY } from "./constants"
import type { BioColorScheme, BioStructure } from "./types"

export type BioRgbColor = readonly [number, number, number]

export interface QualitativePointCharge {
  position: readonly [number, number, number]
  charge: number
  residueIndex: number
}

// Biomolecules and crystal structures share the canonical Jmol/CPK element
// palette so the same element never changes color across import formats.

export const BIO_CHAIN_PALETTE = [
  "#33ff33",
  "#33b1ff",
  "#feb32d",
  "#f24fb3",
  "#8ae1e1",
  "#f97d7d",
  "#c0ff8e",
  "#b487fb",
  "#ffe11a",
  "#5c8f8f",
]

/**
 * Lower-saturation blue-to-magenta chain palette for publication figures. The
 * standard high-contrast palette remains available for analytical work.
 */
export const BIO_CHAIN_PALETTE_PUBLICATION = [
  "#4a6fd4",
  "#8b6fd4",
  "#c77fce",
  "#5fa8dd",
  "#6b4fa8",
  "#e0a3d5",
  "#3f5ba8",
  "#a88fd8",
  "#7fc4e8",
  "#d46fa8",
]

export function bioChainColor(chainIndex: number, palette: readonly string[] = BIO_CHAIN_PALETTE): string {
  const normalized = Number.isFinite(chainIndex) ? Math.max(0, Math.floor(chainIndex)) : 0
  return palette[normalized % palette.length]
}

const VIRIDIS: BioRgbColor[] = [
  [0.267, 0.005, 0.329],
  [0.229, 0.322, 0.545],
  [0.127, 0.567, 0.551],
  [0.369, 0.789, 0.383],
  [0.993, 0.906, 0.144],
]

const SEQUENCE_GRADIENTS: Readonly<Record<
  "viridis" | "sequence-sunset" | "sequence-ocean" | "sequence-muted" | "sequence-mono",
  readonly BioRgbColor[]
>> = {
  viridis: VIRIDIS,
  "sequence-sunset": [
    [0.157, 0.137, 0.322],
    [0.478, 0.184, 0.475],
    [0.784, 0.271, 0.376],
    [0.949, 0.514, 0.243],
    [0.976, 0.827, 0.541],
  ],
  "sequence-ocean": [
    [0.055, 0.145, 0.271],
    [0.098, 0.373, 0.494],
    [0.196, 0.6, 0.6],
    [0.451, 0.788, 0.706],
    [0.867, 0.925, 0.855],
  ],
  "sequence-muted": [
    [0.29, 0.373, 0.596],
    [0.4, 0.639, 0.678],
    [0.596, 0.729, 0.51],
    [0.878, 0.769, 0.443],
    [0.804, 0.478, 0.408],
  ],
  "sequence-mono": [
    [0.145, 0.149, 0.157],
    [0.353, 0.365, 0.376],
    [0.561, 0.573, 0.588],
    [0.741, 0.749, 0.757],
    [0.91, 0.914, 0.918],
  ],
}

function isSequenceGradient(
  scheme: BioColorScheme,
): scheme is keyof typeof SEQUENCE_GRADIENTS {
  return Object.prototype.hasOwnProperty.call(SEQUENCE_GRADIENTS, scheme)
}

const QUALITATIVE_CHARGE_ATOMS: Readonly<Record<string, readonly string[]>> = {
  ASP: ["OD1", "OD2"],
  GLU: ["OE1", "OE2"],
  LYS: ["NZ"],
  ARG: ["NH1", "NH2", "CZ"],
  HIS: ["ND1", "NE2"],
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value))
}

function hexToRgb(hex: string): BioRgbColor {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function rgbToHex(color: BioRgbColor): string {
  return `#${color.map((value) => Math.round(clamp(value) * 255).toString(16).padStart(2, "0")).join("")}`
}

function interpolateColor(left: BioRgbColor, right: BioRgbColor, progress: number): BioRgbColor {
  return [
    left[0] + (right[0] - left[0]) * progress,
    left[1] + (right[1] - left[1]) * progress,
    left[2] + (right[2] - left[2]) * progress,
  ]
}

function sampleGradient(stops: readonly BioRgbColor[], progress: number): string {
  const position = clamp(progress) * (stops.length - 1)
  const left = Math.min(stops.length - 2, Math.floor(position))
  return rgbToHex(interpolateColor(stops[left], stops[left + 1], position - left))
}

function blueWhiteRed(progress: number): string {
  const blue = hexToRgb("#2757c9")
  const white = hexToRgb("#f5f5f5")
  const red = hexToRgb("#cc2a1e")
  const t = clamp(progress)
  return rgbToHex(t < 0.5 ? interpolateColor(blue, white, t * 2) : interpolateColor(white, red, (t - 0.5) * 2))
}

/** Source-compatible PyMOL spectrum: HSL blue → red, not a two-stop RGB ramp. */
function sequenceSpectrum(progress: number): string {
  const hue = (1 - clamp(progress)) * 240
  const saturation = .85
  const lightness = .55
  const chroma = saturation * Math.min(lightness, 1 - lightness)
  const channel = (offset: number): number => {
    const section = (offset + hue / 30) % 12
    return lightness - chroma * Math.max(-1, Math.min(section - 3, 9 - section, 1))
  }
  return rgbToHex([channel(0), channel(8), channel(4)])
}

/** Source-compatible B-factor ramp; electrostatic and charge use separate palettes. */
function bFactorBlueWhiteRed(progress: number): string {
  const t = clamp(progress)
  if (t < .5) {
    const amount = t * 2
    return rgbToHex([.2 + .8 * amount, .3 + .7 * amount, 1])
  }
  const amount = (t - .5) * 2
  return rgbToHex([1, 1 - .7 * amount, 1 - .8 * amount])
}

function threeColorRamp(low: string, middle: string, high: string, progress: number): string {
  const t = clamp(progress)
  const decode = (hex: string): readonly [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
  const [left, right, amount] = t < .5
    ? [decode(low), decode(middle), t * 2] as const
    : [decode(middle), decode(high), (t - .5) * 2] as const
  return `#${left.map((value, index) => Math.round(value + (right[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

function negativeWhitePositive(normalizedPotential: number): string {
  // APBS visual convention only: negative red, neutral white, positive blue.
  return blueWhiteRed((1 - normalizedPotential) / 2)
}

export function qualitativeResidueCharge(residueName: string): number {
  switch (residueName.toUpperCase()) {
    case "ASP":
    case "GLU":
      return -1
    case "LYS":
    case "ARG":
      return 1
    case "HIS":
      return 0.5
    default:
      return 0
  }
}

/**
 * Fixed residue-level charges for qualitative illustration. These are not a
 * force-field charge model: termini, protonation states, ligands, nucleic
 * acids, ions and solvent are deliberately not parameterized here.
 */
export function collectQualitativeResiduePointCharges(structure: BioStructure): QualitativePointCharge[] {
  const result: QualitativePointCharge[] = []
  for (const residue of structure.residues) {
    const charge = qualitativeResidueCharge(residue.name)
    if (charge === 0) continue
    const desiredNames = QUALITATIVE_CHARGE_ATOMS[residue.name]
    const carriers = residue.atomIndices.filter((atomIndex) => desiredNames?.includes(structure.atoms[atomIndex].name))
    const effective = carriers.length > 0 ? carriers : residue.representativeAtomIndex === null ? [] : [residue.representativeAtomIndex]
    if (effective.length === 0) continue
    for (const atomIndex of effective) {
      result.push({
        position: structure.atoms[atomIndex].position,
        charge: charge / effective.length,
        residueIndex: residue.index,
      })
    }
  }
  return result
}

/**
 * Qualitative, cutoff Coulomb-like potential at topology atoms using a
 * distance-dependent dielectric: phi proportional to sum(q / 4r^2). It is
 * explicitly not APBS and must not be interpreted as a physical ESP value.
 */
export function computeQualitativeCoulombPotentialAtAtoms(
  structure: BioStructure,
  cutoffAngstrom = 12,
): Float32Array {
  const output = new Float32Array(structure.atoms.length)
  const charges = collectQualitativeResiduePointCharges(structure)
  if (charges.length === 0) return output
  const cutoffSquared = cutoffAngstrom ** 2
  const cellSize = cutoffAngstrom
  const grid = new Map<string, QualitativePointCharge[]>()
  const cellKey = (position: readonly number[]): string =>
    `${Math.floor(position[0] / cellSize)},${Math.floor(position[1] / cellSize)},${Math.floor(position[2] / cellSize)}`
  for (const charge of charges) {
    const key = cellKey(charge.position)
    const bucket = grid.get(key)
    if (bucket) bucket.push(charge)
    else grid.set(key, [charge])
  }
  for (const atom of structure.atoms) {
    const gx = Math.floor(atom.position[0] / cellSize)
    const gy = Math.floor(atom.position[1] / cellSize)
    const gz = Math.floor(atom.position[2] / cellSize)
    let potential = 0
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const charge of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
            const squared =
              (atom.position[0] - charge.position[0]) ** 2 +
              (atom.position[1] - charge.position[1]) ** 2 +
              (atom.position[2] - charge.position[2]) ** 2
            if (squared <= cutoffSquared) potential += charge.charge / (4 * Math.max(squared, 2.25))
          }
        }
      }
    }
    output[atom.index] = potential
  }
  return output
}

export function normalizeQualitativePotential(values: Float32Array, quantile = 0.95): Float32Array {
  const magnitudes = [...values].map(Math.abs).filter((value) => value > 1e-9).sort((a, b) => a - b)
  if (magnitudes.length === 0) return new Float32Array(values.length)
  const scale = magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * clamp(quantile)))] || 1
  return Float32Array.from(values, (value) => clamp(value / scale, -1, 1))
}

function residueColors(structure: BioStructure, scheme: BioColorScheme): string[] {
  const output = new Array<string>(structure.residues.length).fill("#bbbbbb")
  if (scheme === "chain" || scheme === "chain-publication") {
    const palette = scheme === "chain-publication" ? BIO_CHAIN_PALETTE_PUBLICATION : BIO_CHAIN_PALETTE
    structure.residues.forEach((residue) => {
      output[residue.index] = bioChainColor(residue.chainIndex, palette)
    })
    return output
  }
  if (scheme === "secondary-structure") {
    const colors = { helix: "#ff0d0d", sheet: "#ffd700", coil: "#2ecc40" }
    structure.residues.forEach((residue) => {
      output[residue.index] = colors[residue.secondaryStructure]
    })
    return output
  }
  if (isSequenceGradient(scheme) || scheme === "sequence-spectrum") {
    for (const chain of structure.chains) {
      const residues = chain.residueIndices.filter((residueIndex) => structure.residues[residueIndex].isStandard)
      residues.forEach((residueIndex, offset) => {
        const progress = residues.length <= 1 ? 0.5 : offset / (residues.length - 1)
        output[residueIndex] = isSequenceGradient(scheme)
          ? sampleGradient(SEQUENCE_GRADIENTS[scheme], progress)
          : sequenceSpectrum(progress)
      })
    }
    return output
  }
  if (scheme === "hydrophobicity") {
    structure.residues.forEach((residue) => {
      const value = BIO_HYDROPHOBICITY[residue.name]
      output[residue.index] = value === undefined
        ? "#c8c8c8"
        : threeColorRamp("#3c64c8", "#ffffff", "#c83c14", (value + 4.5) / 9)
    })
    return output
  }
  if (scheme === "qualitative-residue-charge") {
    structure.residues.forEach((residue) => {
      output[residue.index] = threeColorRamp(
        "#cc2a1e", "#f0f0f0", "#2757c9",
        (qualitativeResidueCharge(residue.name) + 1) / 2,
      )
    })
    return output
  }
  if (scheme === "qualitative-coulomb-potential") {
    const potential = normalizeQualitativePotential(computeQualitativeCoulombPotentialAtAtoms(structure))
    structure.residues.forEach((residue) => {
      const atomIndex = residue.representativeAtomIndex ?? residue.atomIndices[0]
      output[residue.index] = negativeWhitePositive(atomIndex === undefined ? 0 : potential[atomIndex])
    })
    return output
  }
  if (scheme === "b-factor" || scheme === "plddt") {
    const values = structure.atoms.map((atom) => atom.bFactor)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const span = maximum - minimum || 1
    structure.residues.forEach((residue) => {
      const atom = structure.atoms[residue.representativeAtomIndex ?? residue.atomIndices[0]]
      if (!atom) return
      output[residue.index] = scheme === "plddt" ? plddtColor(atom.bFactor) : bFactorBlueWhiteRed((atom.bFactor - minimum) / span)
    })
    return output
  }
  return output
}

function plddtColor(value: number): string {
  if (value >= 90) return "#0053d6"
  if (value >= 70) return "#65cbf3"
  if (value >= 50) return "#ffdb13"
  return "#ff7d45"
}

export function computeBioAtomColors(structure: BioStructure, scheme: BioColorScheme): string[] {
  if (scheme === "plddt" && structure.bFactorSemantics !== "plddt") {
    throw new Error("pLDDT coloring requires structure.bFactorSemantics === 'plddt'")
  }
  if (scheme === "element") return structure.atoms.map((atom) => getElement(atom.element).color)
  if (scheme === "b-factor") {
    const values = structure.atoms.map((atom) => atom.bFactor)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const span = maximum - minimum || 1
    return structure.atoms.map((atom) => bFactorBlueWhiteRed((atom.bFactor - minimum) / span))
  }
  if (scheme === "plddt") return structure.atoms.map((atom) => plddtColor(atom.bFactor))
  if (scheme === "qualitative-coulomb-potential") {
    const values = normalizeQualitativePotential(computeQualitativeCoulombPotentialAtAtoms(structure))
    return [...values].map(negativeWhitePositive)
  }
  const byResidue = residueColors(structure, scheme)
  return structure.atoms.map((atom) => byResidue[atom.residueIndex])
}

export function computeBioResidueColors(structure: BioStructure, scheme: BioColorScheme): string[] {
  if (scheme === "plddt" && structure.bFactorSemantics !== "plddt") {
    throw new Error("pLDDT coloring requires structure.bFactorSemantics === 'plddt'")
  }
  // There is no single element for residue granularity, and the convention of "whole chain is colored by carbon" is followed (the protein skeleton is dominated by carbon).
  if (scheme === "element") return new Array(structure.residues.length).fill(getElement("C").color)
  return residueColors(structure, scheme)
}
