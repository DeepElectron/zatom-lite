import { analyzeVoid } from '../lib/analysis/porosity/void-field'
import { OptimizedMarchingCubes } from '../lib/molecular-orbitals/OptimizedMarchingCubes'
import {
  computeProceduralVolumeField,
  generateProceduralVolume,
  type ProceduralVolumeStructure,
} from '../lib/render/procedural-volume'
import { assertEqual, assertTrue } from '../testing/assert'

function testTypedGridMatchesFunctionSampling() {
  const resolution = 14
  const min: [number, number, number] = [-1.5, -2.25, -0.75]
  const max: [number, number, number] = [2.5, 1.25, 3.5]
  const plane = (x: number, y: number, z: number) => x + 2 * y + 3 * z
  const isoValue = 0.731234
  const data = new Float32Array(resolution ** 3)
  let index = 0
  for (let k = 0; k < resolution; k++) {
    const z = min[2] + k / (resolution - 1) * (max[2] - min[2])
    for (let j = 0; j < resolution; j++) {
      const y = min[1] + j / (resolution - 1) * (max[1] - min[1])
      for (let i = 0; i < resolution; i++, index++) {
        const x = min[0] + i / (resolution - 1) * (max[0] - min[0])
        data[index] = plane(x, y, z)
      }
    }
  }

  const marchingCubes = new OptimizedMarchingCubes()
  const options = { smoothIterations: 0, sharedVertices: true }
  const fromFunction = marchingCubes.generateFromGrid(plane, { min, max }, resolution, isoValue, options)
  const fromTypedGrid = marchingCubes.generateFromGrid(data, { min, max }, resolution, isoValue, options)
  assertEqual(fromTypedGrid.vertices.length, fromFunction.vertices.length, 'typed and functional grids must share resolution semantics')
  assertEqual(fromTypedGrid.faces.length, fromFunction.faces.length, 'typed and functional grids must produce the same topology')
  assertTrue(fromTypedGrid.faces.length > 0, 'affine grid must produce a non-empty isosurface')
  for (let i = 0; i < fromTypedGrid.faces.length; i++) {
    assertEqual(fromTypedGrid.faces[i], fromFunction.faces[i], 'typed and functional grids must preserve axis ordering')
    assertTrue(fromTypedGrid.faces[i] < fromTypedGrid.vertices.length / 3, 'face indices must reference a vertex')
  }
  for (let i = 0; i < fromTypedGrid.vertices.length; i += 3) {
    const x = fromTypedGrid.vertices[i]
    const y = fromTypedGrid.vertices[i + 1]
    const z = fromTypedGrid.vertices[i + 2]
    assertTrue(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'surface vertices must be finite')
    assertTrue(x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2], 'surface vertices must stay in bounds')
    assertTrue(Math.abs(plane(x, y, z) - isoValue) < 1e-5, 'surface vertices must lie on the analytic affine plane')
    assertTrue(Math.abs(x - fromFunction.vertices[i]) < 1e-5, 'typed-grid x coordinate must match functional sampling')
    assertTrue(Math.abs(y - fromFunction.vertices[i + 1]) < 1e-5, 'typed-grid y coordinate must match functional sampling')
    assertTrue(Math.abs(z - fromFunction.vertices[i + 2]) < 1e-5, 'typed-grid z coordinate must match functional sampling')
    const normalLength = Math.hypot(
      fromTypedGrid.normals[i],
      fromTypedGrid.normals[i + 1],
      fromTypedGrid.normals[i + 2],
    )
    assertTrue(Number.isFinite(normalLength) && Math.abs(normalLength - 1) < 1e-4, 'surface normals must be finite unit vectors')
  }

  const invalidInputs = [
    marchingCubes.generateFromGrid(new Float32Array(7), { min, max }, 2, 0),
    marchingCubes.generateFromGrid(plane, { min, max }, 1, 0),
    marchingCubes.generateFromGrid(plane, { min, max: [max[0], Number.NaN, max[2]] }, resolution, 0),
    marchingCubes.generateFromGrid(plane, { min, max: [min[0], max[1], max[2]] }, resolution, 0),
  ]
  for (const invalid of invalidInputs) {
    assertEqual(invalid.vertices.length, 0, 'invalid marching-cubes inputs must return an empty result')
    assertEqual(invalid.faces.length, 0, 'invalid marching-cubes inputs must not emit topology')
  }
}

const SAMPLE_STRUCTURE: ProceduralVolumeStructure = {
  atoms: [
    { element: 'C', position: [1.4, 2, 2] },
    { element: 'C', position: [2.6, 2, 2] },
  ],
  bonds: [{ a: 0, b: 1 }],
  latticeVectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
  supercell: [1, 1, 1],
}

function testIllustrativeFieldsAreFiniteAndNormalized() {
  for (const field of ['density', 'bonding', 'elf'] as const) {
    const volume = computeProceduralVolumeField(SAMPLE_STRUCTURE, field, 16)
    assertEqual(volume.data.length, 16 ** 3)
    let min = Infinity
    let max = -Infinity
    for (const value of volume.data) {
      assertTrue(Number.isFinite(value), `${field} field values must be finite`)
      assertTrue(value >= 0 && value <= 1, `${field} field values must be normalized`)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    if (field === 'bonding') {
      assertTrue(volume.diverging, 'bonding proxy must retain a diverging zero point')
      assertTrue(min < 0.5 && max > 0.5, 'bonding proxy must contain depletion and accumulation regions')
      assertTrue(min <= 0.001 || max >= 0.999, 'bonding proxy must scale by its strongest signed extremum')
    } else {
      assertTrue(min <= 0.001, `${field} field must reach its normalized lower range`)
      assertTrue(max >= 0.999, `${field} field must reach its normalized upper range`)
    }
  }

  const result = generateProceduralVolume({
    structure: SAMPLE_STRUCTURE,
    field: 'density',
    resolution: 16,
    isoLevel: 0.25,
    generateSurface: true,
  })
  assertTrue(Boolean(result.positive && result.positive.faces.length > 0), 'density proxy must generate a drawable isosurface')
}

function testPorositySurfaceAreaKeepsGridPointStride() {
  const radius = 1.7 + 0.3
  const result = analyzeVoid({
    atoms: [{ element: 'C', cartesian: [0, 0, 0] }],
    latticeVectors: null,
    periodic: false,
    probeRadius: 0.3,
    resolution: 32,
  })
  const expectedArea = 4 * Math.PI * radius * radius
  const relativeError = Math.abs(result.accessibleSurfaceAreaAng2 - expectedArea) / expectedArea
  assertTrue(relativeError < 0.15, `porosity sphere area regression: relative error ${relativeError.toFixed(3)}`)
}

function run() {
  testTypedGridMatchesFunctionSampling()
  testIllustrativeFieldsAreFiniteAndNormalized()
  testPorositySurfaceAreaKeepsGridPointStride()
  console.log('procedural volume tests passed')
}

run()
