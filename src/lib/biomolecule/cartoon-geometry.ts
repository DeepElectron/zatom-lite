import * as THREE from 'three'
import type { BioSecondaryStructure, BioStructure } from './types'

export type BioCartoonModel = 'ribbon' | 'oval' | 'rectangle' | 'tube' | 'rocket' | 'putty' | 'trace'

export const BIO_CARTOON_MODELS: readonly { value: BioCartoonModel; label: string }[] = [
  { value: 'ribbon', label: 'Richardson ribbon' },
  { value: 'oval', label: 'Oval ribbon' },
  { value: 'rectangle', label: 'Rectangular ribbon' },
  { value: 'tube', label: 'Tube' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'putty', label: 'B-factor putty' },
  { value: 'trace', label: 'Backbone trace' },
]

/** Canonical reachable ranges shared by geometry, state validation, and UI. */
export const BIO_CARTOON_LIMITS = {
  quality: { min: 4, max: 24 },
  smooth: { min: 0, max: 1 },
  width: { min: 0.4, max: 2 },
  thickness: { min: 0.3, max: 2.5 },
} as const

export interface BioCartoonOptions {
  model: BioCartoonModel
  /** Longitudinal samples per residue interval. */
  quality: number
  /** Secondary-structure-weighted guide smoothing, from raw trace to fully smoothed. */
  smooth: number
  width: number
  thickness: number
  /** A rejected residue breaks the sweep, rather than bridging across the hidden region. */
  residueFilter?: (residueIndex: number) => boolean
}

export interface BioCartoonMeshData {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
}

interface Profile {
  width: number
  height: number
  /** Superellipse exponent: 2 is elliptical; larger values approach a rectangle. */
  exponent: number
}

interface ModelPreset {
  helix: Profile
  sheet: Profile
  coil: Profile
  /** Maximum beta-arrow half-width; zero disables arrows. */
  arrowWidth: number
  smoothHelix: number
  smoothSheet: number
  smoothCoil: number
  radialHelix: boolean
  putty: boolean
}

const profile = (width: number, height: number, exponent: number): Profile => ({
  width,
  height,
  exponent,
})

const MODEL_PRESETS: Record<BioCartoonModel, ModelPreset> = {
  ribbon: {
    helix: profile(1.15, 0.22, 6),
    sheet: profile(1.15, 0.24, 6),
    coil: profile(0.26, 0.26, 2),
    arrowWidth: 1.9,
    smoothHelix: 1,
    smoothSheet: 0.8,
    smoothCoil: 0.2,
    radialHelix: true,
    putty: false,
  },
  oval: {
    helix: profile(1.25, 0.48, 2.6),
    sheet: profile(1.2, 0.44, 2.6),
    coil: profile(0.34, 0.34, 2),
    arrowWidth: 1.95,
    smoothHelix: 1,
    smoothSheet: 0.8,
    smoothCoil: 0.2,
    radialHelix: true,
    putty: false,
  },
  rectangle: {
    helix: profile(1.2, 0.18, 12),
    sheet: profile(1.2, 0.2, 12),
    coil: profile(0.22, 0.22, 3),
    arrowWidth: 2,
    smoothHelix: 1,
    smoothSheet: 0.85,
    smoothCoil: 0.2,
    radialHelix: true,
    putty: false,
  },
  tube: {
    helix: profile(0.45, 0.45, 2),
    sheet: profile(0.45, 0.45, 2),
    coil: profile(0.45, 0.45, 2),
    arrowWidth: 0,
    smoothHelix: 0.9,
    smoothSheet: 0.7,
    smoothCoil: 0.15,
    radialHelix: false,
    putty: false,
  },
  rocket: {
    helix: profile(1.45, 1.45, 2),
    sheet: profile(1.25, 0.2, 8),
    coil: profile(0.2, 0.2, 2),
    arrowWidth: 2.05,
    smoothHelix: 1,
    smoothSheet: 0.85,
    smoothCoil: 0.1,
    radialHelix: false,
    putty: false,
  },
  putty: {
    helix: profile(0.6, 0.6, 2),
    sheet: profile(0.6, 0.6, 2),
    coil: profile(0.6, 0.6, 2),
    arrowWidth: 0,
    smoothHelix: 0.85,
    smoothSheet: 0.7,
    smoothCoil: 0.15,
    radialHelix: false,
    putty: true,
  },
  trace: {
    helix: profile(0.32, 0.32, 2),
    sheet: profile(0.32, 0.32, 2),
    coil: profile(0.32, 0.32, 2),
    arrowWidth: 0,
    smoothHelix: 0,
    smoothSheet: 0,
    smoothCoil: 0,
    radialHelix: false,
    putty: false,
  },
}

const PROFILE_SEGMENTS = 24
const NUCLEIC_LADDER_SEGMENTS = 12
const NUCLEIC_BACKBONE_NAMES = new Set([
  'P', 'OP1', 'OP2', 'OP3', "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "O2'", "C1'",
])

interface SegmentData {
  /** Smoothed sweep guide. */
  points: THREE.Vector3[]
  /** Original representative-atom positions, retained for radial helix orientation. */
  raw: THREE.Vector3[]
  /** Representative-to-backbone-oxygen directions. */
  carbonyl: THREE.Vector3[]
  /** Desired cross-section thin axes. */
  references: THREE.Vector3[]
  secondary: BioSecondaryStructure[]
  colors: THREE.Color[]
  radiusScale: number[]
}

interface MeshOutput {
  positions: number[]
  normals: number[]
  colors: number[]
  indices: number[]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function smoothstep(value: number): number {
  const normalized = clamp01(value)
  return normalized * normalized * (3 - 2 * normalized)
}

function normalizedOptions(options: BioCartoonOptions): BioCartoonOptions {
  return {
    ...options,
    quality: Math.round(clamp(
      Number.isFinite(options.quality) ? options.quality : BIO_CARTOON_LIMITS.quality.min,
      BIO_CARTOON_LIMITS.quality.min,
      BIO_CARTOON_LIMITS.quality.max,
    )),
    smooth: clamp(
      Number.isFinite(options.smooth) ? options.smooth : 0,
      BIO_CARTOON_LIMITS.smooth.min,
      BIO_CARTOON_LIMITS.smooth.max,
    ),
    width: clamp(
      Number.isFinite(options.width) ? options.width : 1,
      BIO_CARTOON_LIMITS.width.min,
      BIO_CARTOON_LIMITS.width.max,
    ),
    thickness: clamp(
      Number.isFinite(options.thickness) ? options.thickness : 1,
      BIO_CARTOON_LIMITS.thickness.min,
      BIO_CARTOON_LIMITS.thickness.max,
    ),
  }
}

function emptyMesh(): BioCartoonMeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
  }
}

function nucleicBaseCentroid(structure: BioStructure, residueIndex: number): THREE.Vector3 | null {
  const residue = structure.residues[residueIndex]
  if (!residue) return null
  const centroid = new THREE.Vector3()
  let count = 0
  for (const atomIndex of residue.atomIndices) {
    const atom = structure.atoms[atomIndex]
    if (!atom || NUCLEIC_BACKBONE_NAMES.has(atom.name) || atom.element.toUpperCase() === 'H') continue
    centroid.x += atom.position[0]
    centroid.y += atom.position[1]
    centroid.z += atom.position[2]
    count += 1
  }
  return count >= 3 ? centroid.multiplyScalar(1 / count) : null
}

function appendCylinder(
  output: MeshOutput,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  color: THREE.Color,
): void {
  const axis = new THREE.Vector3().subVectors(to, from)
  if (axis.length() < 0.1) return
  axis.normalize()
  const helper = Math.abs(axis.y) > 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3().crossVectors(axis, helper).normalize()
  const up = new THREE.Vector3().crossVectors(side, axis)
  const base = output.positions.length / 3
  const vertex = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let end = 0; end < 2; end += 1) {
    const center = end === 0 ? from : to
    for (let segment = 0; segment < NUCLEIC_LADDER_SEGMENTS; segment += 1) {
      const angle = segment / NUCLEIC_LADDER_SEGMENTS * Math.PI * 2
      normal.set(0, 0, 0)
        .addScaledVector(side, Math.cos(angle))
        .addScaledVector(up, Math.sin(angle))
      vertex.copy(center).addScaledVector(normal, radius)
      output.positions.push(vertex.x, vertex.y, vertex.z)
      output.normals.push(normal.x, normal.y, normal.z)
      output.colors.push(color.r, color.g, color.b)
    }
  }

  for (let segment = 0; segment < NUCLEIC_LADDER_SEGMENTS; segment += 1) {
    const next = (segment + 1) % NUCLEIC_LADDER_SEGMENTS
    output.indices.push(
      base + segment,
      base + NUCLEIC_LADDER_SEGMENTS + segment,
      base + NUCLEIC_LADDER_SEGMENTS + next,
      base + segment,
      base + NUCLEIC_LADDER_SEGMENTS + next,
      base + next,
    )
  }
}

function collectSegments(
  structure: BioStructure,
  residueColors: readonly string[],
  options: BioCartoonOptions,
  preset: ModelPreset,
  output: MeshOutput,
): Array<{ segment: SegmentData; nucleic: boolean }> {
  let bFactorMinimum = Number.POSITIVE_INFINITY
  let bFactorMaximum = Number.NEGATIVE_INFINITY
  if (preset.putty) {
    for (const residue of structure.residues) {
      if (!residue.isStandard || residue.representativeAtomIndex == null) continue
      const bFactor = structure.atoms[residue.representativeAtomIndex]?.bFactor
      if (!Number.isFinite(bFactor)) continue
      bFactorMinimum = Math.min(bFactorMinimum, bFactor)
      bFactorMaximum = Math.max(bFactorMaximum, bFactor)
    }
    if (!(bFactorMaximum > bFactorMinimum)) {
      bFactorMinimum = 0
      bFactorMaximum = 1
    }
  }

  const result: Array<{ segment: SegmentData; nucleic: boolean }> = []
  for (const chain of structure.chains) {
    if (chain.polymerType === 'other') continue
    const nucleic = chain.polymerType === 'nucleic'
    const maximumGap = nucleic ? 10 : 4.5
    let current: SegmentData | null = null
    const flush = () => {
      if (current && current.points.length >= 2) result.push({ segment: current, nucleic })
      current = null
    }

    for (const residueIndex of chain.residueIndices) {
      const residue = structure.residues[residueIndex]
      if (!residue?.isStandard
        || residue.representativeAtomIndex == null
        || options.residueFilter?.(residueIndex) === false) {
        flush()
        continue
      }
      const representative = structure.atoms[residue.representativeAtomIndex]
      if (!representative) {
        flush()
        continue
      }
      const position = new THREE.Vector3(...representative.position)
      if (current?.raw.length && current.raw[current.raw.length - 1].distanceTo(position) > maximumGap) flush()
      if (!current) {
        current = {
          points: [],
          raw: [],
          carbonyl: [],
          references: [],
          secondary: [],
          colors: [],
          radiusScale: [],
        }
      }

      const carbonyl = new THREE.Vector3(0, 0, 1)
      const oxygen = residue.backboneOxygenIndex == null
        ? null
        : structure.atoms[residue.backboneOxygenIndex]
      if (!nucleic && oxygen) carbonyl.set(...oxygen.position).sub(position).normalize()

      let radiusScale = 1
      if (preset.putty) {
        const normalized = clamp01((representative.bFactor - bFactorMinimum) / (bFactorMaximum - bFactorMinimum))
        radiusScale = 0.42 + 1.35 * (
          structure.bFactorSemantics === 'plddt' ? 1 - normalized : normalized
        )
      }
      const color = new THREE.Color().setStyle(
        residueColors[residueIndex] ?? '#bbbbbb',
        THREE.NoColorSpace,
      )
      current.points.push(position.clone())
      current.raw.push(position)
      current.carbonyl.push(carbonyl)
      current.references.push(carbonyl.clone())
      current.secondary.push(nucleic ? 'coil' : residue.secondaryStructure)
      current.colors.push(color)
      current.radiusScale.push(radiusScale)

      if (nucleic) {
        const baseCentroid = nucleicBaseCentroid(structure, residueIndex)
        if (baseCentroid) appendCylinder(output, position, baseCentroid, 0.22, color)
      }
    }
    flush()
  }
  return result
}

/**
 * Smooth a trace with secondary-structure weights and prepare the desired thin
 * axis. Helices use the radial axis-to-representative direction; sheets and
 * coils use cross(tangent, carbonyl), so beta ribbons lie in the sheet plane.
 */
function prepareSegment(
  segment: SegmentData,
  preset: ModelPreset,
  options: BioCartoonOptions,
): void {
  const count = segment.points.length
  const weights = new Float64Array(count)
  for (let index = 0; index < count; index += 1) {
    const base = segment.secondary[index] === 'helix'
      ? preset.smoothHelix
      : segment.secondary[index] === 'sheet'
        ? preset.smoothSheet
        : preset.smoothCoil
    weights[index] = base * options.smooth
  }

  // Feather both sides of secondary-structure boundaries before smoothing.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = Float64Array.from(weights)
    for (let index = 1; index < count - 1; index += 1) {
      next[index] = 0.5 * weights[index]
        + 0.25 * weights[index - 1]
        + 0.25 * weights[index + 1]
    }
    if (count > 1) {
      next[0] = 0.6 * weights[0] + 0.4 * weights[1]
      next[count - 1] = 0.6 * weights[count - 1] + 0.4 * weights[count - 2]
    }
    weights.set(next)
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const next = segment.points.map((point) => point.clone())
    for (let index = 1; index < count - 1; index += 1) {
      if (weights[index] <= 0) continue
      const ideal = segment.points[index - 1].clone()
        .addScaledVector(segment.points[index], 2)
        .add(segment.points[index + 1])
        .multiplyScalar(0.25)
      next[index].lerp(ideal, weights[index])
    }
    segment.points = next
  }

  const tangent = new THREE.Vector3()
  const radial = new THREE.Vector3()
  for (let index = 0; index < count; index += 1) {
    const before = segment.points[Math.max(0, index - 1)]
    const after = segment.points[Math.min(count - 1, index + 1)]
    tangent.subVectors(after, before)
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1)
    tangent.normalize()

    let oriented = false
    if (preset.radialHelix && segment.secondary[index] === 'helix') {
      radial.subVectors(segment.raw[index], segment.points[index])
      radial.addScaledVector(tangent, -radial.dot(tangent))
      if (radial.lengthSq() > 0.09) {
        segment.references[index].copy(radial).normalize()
        oriented = true
      }
    }
    if (!oriented) {
      segment.references[index].crossVectors(tangent, segment.carbonyl[index])
      if (segment.references[index].lengthSq() < 1e-8) {
        segment.references[index].set(0, 1, 0).addScaledVector(tangent, -tangent.y)
        if (segment.references[index].lengthSq() < 1e-8) {
          segment.references[index].set(1, 0, 0).addScaledVector(tangent, -tangent.x)
        }
      }
      segment.references[index].normalize()
    }
  }

  // Ribbons are 180-degree symmetric. Keep every reference in the same half-plane.
  for (let index = 1; index < count; index += 1) {
    if (segment.references[index].dot(segment.references[index - 1]) < 0) {
      segment.references[index].negate()
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next = segment.references.map((reference) => reference.clone())
    for (let index = 1; index < count - 1; index += 1) {
      next[index].multiplyScalar(0.5)
        .addScaledVector(segment.references[index - 1], 0.25)
        .addScaledVector(segment.references[index + 1], 0.25)
      if (next[index].lengthSq() < 1e-8) next[index].copy(segment.references[index])
      next[index].normalize()
    }
    segment.references = next
  }
}

function secondaryProfile(preset: ModelPreset, secondary: BioSecondaryStructure): Profile {
  return secondary === 'helix'
    ? preset.helix
    : secondary === 'sheet'
      ? preset.sheet
      : preset.coil
}

/** Interpolate cross sections across SS boundaries and form a non-degenerate beta arrow. */
function profileAt(
  segment: SegmentData,
  preset: ModelPreset,
  options: BioCartoonOptions,
  residueFraction: number,
): Profile {
  const count = segment.secondary.length
  const residueIndex = Math.min(count - 1, Math.max(0, Math.floor(residueFraction)))
  const fraction = residueFraction - residueIndex
  const secondary = segment.secondary[residueIndex]
  const nextSecondary = segment.secondary[Math.min(count - 1, residueIndex + 1)]
  let result: Profile

  if (preset.arrowWidth > 0 && secondary === 'sheet' && nextSecondary !== 'sheet') {
    result = profile(
      Math.max(preset.arrowWidth * (1 - fraction), 0.2),
      preset.sheet.height,
      preset.sheet.exponent,
    )
  } else if (preset.arrowWidth > 0
    && secondary === 'sheet'
    && nextSecondary === 'sheet'
    && segment.secondary[Math.min(count - 1, residueIndex + 2)] !== 'sheet') {
    const blend = smoothstep((fraction - 0.65) / 0.35)
    result = profile(
      preset.sheet.width + (preset.arrowWidth - preset.sheet.width) * blend,
      preset.sheet.height,
      preset.sheet.exponent,
    )
  } else {
    const current = secondaryProfile(preset, secondary)
    const next = secondaryProfile(preset, nextSecondary)
    if (current.width === next.width
      && current.height === next.height
      && current.exponent === next.exponent) {
      result = current
    } else {
      const blend = smoothstep(fraction)
      result = profile(
        current.width + (next.width - current.width) * blend,
        current.height + (next.height - current.height) * blend,
        current.exponent + (next.exponent - current.exponent) * blend,
      )
    }
  }

  let radiusScale = 1
  if (preset.putty) {
    const current = segment.radiusScale[residueIndex]
    const next = segment.radiusScale[Math.min(count - 1, residueIndex + 1)]
    radiusScale = current + (next - current) * smoothstep(fraction)
  }
  return profile(
    result.width * options.width * radiusScale,
    result.height * options.thickness * radiusScale,
    result.exponent,
  )
}

function superellipsePoint(
  angle: number,
  width: number,
  height: number,
  exponent: number,
  output: { x: number; y: number },
): void {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const power = 2 / exponent
  output.x = width * Math.sign(cosine) * Math.pow(Math.abs(cosine), power)
  output.y = height * Math.sign(sine) * Math.pow(Math.abs(sine), power)
}

function addCap(
  output: MeshOutput,
  grid: Float64Array,
  sampleIndex: number,
  center: THREE.Vector3,
  tangent: THREE.Vector3,
  color: THREE.Color,
  start: boolean,
): void {
  const normal = tangent.clone()
  if (start) normal.negate()
  const base = output.positions.length / 3
  output.positions.push(center.x, center.y, center.z)
  output.normals.push(normal.x, normal.y, normal.z)
  output.colors.push(color.r, color.g, color.b)
  for (let segment = 0; segment < PROFILE_SEGMENTS; segment += 1) {
    const offset = (sampleIndex * PROFILE_SEGMENTS + segment) * 3
    output.positions.push(grid[offset], grid[offset + 1], grid[offset + 2])
    output.normals.push(normal.x, normal.y, normal.z)
    output.colors.push(color.r, color.g, color.b)
  }
  for (let segment = 0; segment < PROFILE_SEGMENTS; segment += 1) {
    const next = (segment + 1) % PROFILE_SEGMENTS
    if (start) output.indices.push(base, base + 1 + next, base + 1 + segment)
    else output.indices.push(base, base + 1 + segment, base + 1 + next)
  }
}

/**
 * Sweep a segment with a double-reflection rotation-minimizing frame, unwrap
 * the 180-degree-symmetric twist field, then derive normals from centered grid
 * differences. The latter preserves correct normals where beta arrows taper.
 */
function sweepSegment(
  output: MeshOutput,
  segment: SegmentData,
  preset: ModelPreset,
  options: BioCartoonOptions,
  nucleic: boolean,
): void {
  const residueCount = segment.points.length
  const curve = new THREE.CatmullRomCurve3(segment.points, false, 'centripetal', 0.5)
  const samplesPerResidue = options.quality
  const sampleCount = (residueCount - 1) * samplesPerResidue + 1
  if (sampleCount < 2) return

  const positions = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const fraction = sampleIndex / (sampleCount - 1)
    return curve.getPointAt(fraction)
  })
  const tangents = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const fraction = sampleIndex / (sampleCount - 1)
    return curve.getTangentAt(fraction).normalize()
  })

  // Wang et al. (2008) double-reflection rotation-minimizing frame.
  const rotationMinimizingNormals: THREE.Vector3[] = new Array(sampleCount)
  const firstNormal = segment.references[0].clone()
  firstNormal.addScaledVector(tangents[0], -firstNormal.dot(tangents[0]))
  if (firstNormal.lengthSq() < 1e-8) {
    firstNormal.set(0, 1, 0).addScaledVector(tangents[0], -tangents[0].y)
    if (firstNormal.lengthSq() < 1e-8) {
      firstNormal.set(1, 0, 0).addScaledVector(tangents[0], -tangents[0].x)
    }
  }
  rotationMinimizingNormals[0] = firstNormal.normalize()
  const firstReflection = new THREE.Vector3()
  const secondReflection = new THREE.Vector3()
  const reflectedNormal = new THREE.Vector3()
  const reflectedTangent = new THREE.Vector3()
  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    firstReflection.subVectors(positions[sampleIndex], positions[sampleIndex - 1])
    const firstLengthSquared = firstReflection.lengthSq()
    if (firstLengthSquared < 1e-12) {
      rotationMinimizingNormals[sampleIndex] = rotationMinimizingNormals[sampleIndex - 1].clone()
      continue
    }
    reflectedNormal.copy(rotationMinimizingNormals[sampleIndex - 1]).addScaledVector(
      firstReflection,
      -2 / firstLengthSquared * firstReflection.dot(rotationMinimizingNormals[sampleIndex - 1]),
    )
    reflectedTangent.copy(tangents[sampleIndex - 1]).addScaledVector(
      firstReflection,
      -2 / firstLengthSquared * firstReflection.dot(tangents[sampleIndex - 1]),
    )
    secondReflection.subVectors(tangents[sampleIndex], reflectedTangent)
    const secondLengthSquared = secondReflection.lengthSq()
    if (secondLengthSquared > 1e-12) {
      reflectedNormal.addScaledVector(
        secondReflection,
        -2 / secondLengthSquared * secondReflection.dot(reflectedNormal),
      )
    }
    reflectedNormal.addScaledVector(
      tangents[sampleIndex],
      -reflectedNormal.dot(tangents[sampleIndex]),
    )
    if (reflectedNormal.lengthSq() < 1e-10) {
      reflectedNormal.copy(rotationMinimizingNormals[sampleIndex - 1])
    }
    rotationMinimizingNormals[sampleIndex] = reflectedNormal.clone().normalize()
  }

  // Unwrap the desired frame about the RMF, treating angles separated by PI as equivalent.
  const twist = new Float64Array(sampleCount)
  const desired = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const residueFraction = sampleIndex / (sampleCount - 1) * (residueCount - 1)
    const residueIndex = Math.min(residueCount - 2, Math.floor(residueFraction))
    const fraction = residueFraction - residueIndex
    desired.copy(segment.references[residueIndex]).multiplyScalar(1 - fraction)
      .addScaledVector(segment.references[residueIndex + 1], fraction)
    desired.addScaledVector(tangents[sampleIndex], -desired.dot(tangents[sampleIndex]))
    if (desired.lengthSq() < 1e-8) {
      twist[sampleIndex] = sampleIndex > 0 ? twist[sampleIndex - 1] : 0
      continue
    }
    desired.normalize()
    binormal.crossVectors(tangents[sampleIndex], rotationMinimizingNormals[sampleIndex])
    let angle = Math.atan2(
      desired.dot(binormal),
      desired.dot(rotationMinimizingNormals[sampleIndex]),
    )
    if (sampleIndex > 0) {
      while (angle - twist[sampleIndex - 1] > Math.PI / 2) angle -= Math.PI
      while (angle - twist[sampleIndex - 1] < -Math.PI / 2) angle += Math.PI
    }
    twist[sampleIndex] = angle
  }
  const windowRadius = Math.max(1, Math.floor(samplesPerResidue / 2))
  const smoothedTwist = new Float64Array(sampleCount)
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    let total = 0
    let samples = 0
    for (let offset = -windowRadius; offset <= windowRadius; offset += 1) {
      const neighbor = sampleIndex + offset
      if (neighbor < 0 || neighbor >= sampleCount) continue
      total += twist[neighbor]
      samples += 1
    }
    smoothedTwist[sampleIndex] = total / samples
  }

  const grid = new Float64Array(sampleCount * PROFILE_SEGMENTS * 3)
  const outward = new Float64Array(sampleCount * PROFILE_SEGMENTS * 3)
  const thinAxis = new THREE.Vector3()
  const side = new THREE.Vector3()
  const sectionBinormal = new THREE.Vector3()
  const point = { x: 0, y: 0 }
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const residueFraction = sampleIndex / (sampleCount - 1) * (residueCount - 1)
    sectionBinormal.crossVectors(tangents[sampleIndex], rotationMinimizingNormals[sampleIndex])
    thinAxis.copy(rotationMinimizingNormals[sampleIndex])
      .multiplyScalar(Math.cos(smoothedTwist[sampleIndex]))
      .addScaledVector(sectionBinormal, Math.sin(smoothedTwist[sampleIndex]))
    side.crossVectors(tangents[sampleIndex], thinAxis)
    if (side.lengthSq() < 1e-10) side.copy(sectionBinormal)
    side.normalize()

    const section = nucleic
      ? profile(0.5 * options.width, 0.5 * options.thickness, 2)
      : profileAt(segment, preset, options, residueFraction)
    const inverseWidth = 1 / Math.max(section.width, 1e-3)
    const inverseHeight = 1 / Math.max(section.height, 1e-3)
    for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
      const angle = profileIndex / PROFILE_SEGMENTS * Math.PI * 2
      superellipsePoint(angle, section.width, section.height, section.exponent, point)
      const offset = (sampleIndex * PROFILE_SEGMENTS + profileIndex) * 3
      grid[offset] = positions[sampleIndex].x + side.x * point.x + thinAxis.x * point.y
      grid[offset + 1] = positions[sampleIndex].y + side.y * point.x + thinAxis.y * point.y
      grid[offset + 2] = positions[sampleIndex].z + side.z * point.x + thinAxis.z * point.y
      const outwardWidth = point.x * inverseWidth * inverseWidth
      const outwardHeight = point.y * inverseHeight * inverseHeight
      outward[offset] = side.x * outwardWidth + thinAxis.x * outwardHeight
      outward[offset + 1] = side.y * outwardWidth + thinAxis.y * outwardHeight
      outward[offset + 2] = side.z * outwardWidth + thinAxis.z * outwardHeight
    }
  }

  const base = output.positions.length / 3
  const color = new THREE.Color()
  const aroundDerivative = new THREE.Vector3()
  const sweepDerivative = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const residueFraction = sampleIndex / (sampleCount - 1) * (residueCount - 1)
    color.copy(segment.colors[Math.min(residueCount - 1, Math.round(residueFraction))])
    const previousSample = Math.max(0, sampleIndex - 1)
    const nextSample = Math.min(sampleCount - 1, sampleIndex + 1)
    for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
      const offset = (sampleIndex * PROFILE_SEGMENTS + profileIndex) * 3
      const previousProfile = (profileIndex - 1 + PROFILE_SEGMENTS) % PROFILE_SEGMENTS
      const nextProfile = (profileIndex + 1) % PROFILE_SEGMENTS
      const previousAroundOffset = (sampleIndex * PROFILE_SEGMENTS + previousProfile) * 3
      const nextAroundOffset = (sampleIndex * PROFILE_SEGMENTS + nextProfile) * 3
      const previousSweepOffset = (previousSample * PROFILE_SEGMENTS + profileIndex) * 3
      const nextSweepOffset = (nextSample * PROFILE_SEGMENTS + profileIndex) * 3
      aroundDerivative.set(
        grid[nextAroundOffset] - grid[previousAroundOffset],
        grid[nextAroundOffset + 1] - grid[previousAroundOffset + 1],
        grid[nextAroundOffset + 2] - grid[previousAroundOffset + 2],
      )
      sweepDerivative.set(
        grid[nextSweepOffset] - grid[previousSweepOffset],
        grid[nextSweepOffset + 1] - grid[previousSweepOffset + 1],
        grid[nextSweepOffset + 2] - grid[previousSweepOffset + 2],
      )
      normal.crossVectors(sweepDerivative, aroundDerivative)
      if (normal.lengthSq() < 1e-14) {
        normal.set(outward[offset], outward[offset + 1], outward[offset + 2])
      }
      normal.normalize()
      if (normal.x * outward[offset]
        + normal.y * outward[offset + 1]
        + normal.z * outward[offset + 2] < 0) normal.negate()
      output.positions.push(grid[offset], grid[offset + 1], grid[offset + 2])
      output.normals.push(normal.x, normal.y, normal.z)
      output.colors.push(color.r, color.g, color.b)
    }

    if (sampleIndex > 0) {
      const previousRing = base + (sampleIndex - 1) * PROFILE_SEGMENTS
      const currentRing = base + sampleIndex * PROFILE_SEGMENTS
      for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
        const next = (profileIndex + 1) % PROFILE_SEGMENTS
        output.indices.push(
          previousRing + profileIndex,
          currentRing + profileIndex,
          currentRing + next,
          previousRing + profileIndex,
          currentRing + next,
          previousRing + next,
        )
      }
    }
  }

  // Caps have their own vertices so axial cap normals do not round the rim.
  addCap(output, grid, 0, positions[0], tangents[0], segment.colors[0], true)
  addCap(
    output,
    grid,
    sampleCount - 1,
    positions[sampleCount - 1],
    tangents[sampleCount - 1],
    segment.colors[residueCount - 1],
    false,
  )
}

/**
 * Build protein ribbon geometry and nucleic-acid backbone/ladder geometry from
 * the canonical immutable BioStructure topology.
 */
export function buildBioCartoonGeometry(
  structure: BioStructure,
  residueColors: readonly string[],
  requestedOptions: BioCartoonOptions,
): BioCartoonMeshData {
  const options = normalizedOptions(requestedOptions)
  const preset = MODEL_PRESETS[options.model]
  const output: MeshOutput = { positions: [], normals: [], colors: [], indices: [] }
  const segments = collectSegments(structure, residueColors, options, preset, output)
  for (const { segment, nucleic } of segments) {
    prepareSegment(segment, preset, options)
    sweepSegment(output, segment, preset, options, nucleic)
  }
  if (output.positions.length === 0) return emptyMesh()
  return {
    positions: new Float32Array(output.positions),
    normals: new Float32Array(output.normals),
    colors: new Float32Array(output.colors),
    indices: new Uint32Array(output.indices),
  }
}
