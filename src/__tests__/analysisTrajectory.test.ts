import { assertEqual, assertTrue } from '../testing/assert'
import {
  detectFormat,
  parseExtxyz,
  parseLammpsDump,
  parsePmgJson,
  parseTrajectory,
  parseXdatcar,
} from '../lib/analysis/trajectory'

const XDATCAR_SAMPLE = `Si test
1.0
3.0 0.0 0.0
0.0 3.0 0.0
0.0 0.0 3.0
Si
2
Direct configuration=     1
0.0 0.0 0.0
0.5 0.5 0.5
Direct configuration=     2
0.01 0.0 0.0
0.51 0.5 0.5
Direct configuration=     3
0.02 0.0 0.0
0.52 0.5 0.5
`

const LAMMPS_DUMP_SAMPLE = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 5
0 5
0 5
ITEM: ATOMS id type x y z fx fy fz
1 1 0.0 0.0 0.0 0.1 0.0 0.0
2 1 2.5 2.5 2.5 -0.1 0.0 0.0
ITEM: TIMESTEP
100
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 5
0 5
0 5
ITEM: ATOMS id type x y z fx fy fz
1 1 0.1 0.0 0.0 0.05 0.0 0.0
2 1 2.4 2.5 2.5 -0.05 0.0 0.0
`

const EXTXYZ_SAMPLE = `2
Lattice="5.0 0 0 0 5.0 0 0 0 5.0" energy=-12.5 step=0 T=300
H 0.0 0.0 0.0
H 1.0 0.0 0.0
2
Lattice="5.0 0 0 0 5.0 0 0 0 5.0" energy=-12.7 step=1 T=300
H 0.01 0.0 0.0
H 1.01 0.0 0.0
`

const PMG_JSON_SAMPLE = JSON.stringify({
  species: ['Cu', 'Cu'],
  positions: [
    [[0, 0, 0], [1.8, 1.8, 0]],
    [[0.01, 0, 0], [1.81, 1.8, 0]],
  ],
  lattice: [[3.6, 0, 0], [0, 3.6, 0], [0, 0, 3.6]],
  energies: [-7.5, -7.49],
  forces: [
    [[0.1, 0, 0], [-0.1, 0, 0]],
    [[0.05, 0, 0], [-0.05, 0, 0]],
  ],
})

function testFormatDetection() {
  assertEqual(detectFormat(XDATCAR_SAMPLE, 'XDATCAR'), 'vasp_xdatcar')
  assertEqual(detectFormat(LAMMPS_DUMP_SAMPLE, 'md.dump'), 'lammps_dump')
  assertEqual(detectFormat(EXTXYZ_SAMPLE, 'traj.xyz'), 'extxyz')
  assertEqual(detectFormat(PMG_JSON_SAMPLE, 'traj.json'), 'pmg_json')
  assertEqual(detectFormat('hello world', 'mystery.txt'), 'unknown')
}

function testXdatcarParse() {
  const res = parseXdatcar(XDATCAR_SAMPLE, 'XDATCAR')
  assertTrue(res.success, 'XDATCAR parses')
  if (!res.success) return
  assertEqual(res.data.format, 'vasp_xdatcar')
  assertEqual(res.data.frames.length, 3)
  assertEqual(res.data.frames[0].atoms.length, 2)
  assertEqual(res.data.frames[0].atoms[0].element, 'Si')
  // Cartesian of (0.5, 0.5, 0.5) in a 3 Å cubic cell is (1.5, 1.5, 1.5).
  const cart = res.data.frames[0].atoms[1].cartesian!
  assertTrue(Math.abs(cart[0] - 1.5) < 1e-6, 'fractional → cartesian')
  assertEqual(res.data.metadata[2].step, 3)
}

function testLammpsDumpParseWithForces() {
  const res = parseLammpsDump(LAMMPS_DUMP_SAMPLE, 'md.dump')
  assertTrue(res.success, 'LAMMPS dump parses')
  if (!res.success) return
  assertEqual(res.data.frames.length, 2)
  assertEqual(res.data.metadata[0].step, 0)
  assertEqual(res.data.metadata[1].step, 100)
  assertTrue(res.data.stats!.has_forces, 'forces detected')
  // RMS force across two atoms with |f| = 0.1 should be 0.1.
  const rms = res.data.metadata[0].rms_force!
  assertTrue(Math.abs(rms - 0.1) < 1e-6, `RMS force = ${rms}, expected 0.1`)
}

function testExtxyzCommentMetadata() {
  const res = parseExtxyz(EXTXYZ_SAMPLE, 'traj.xyz')
  assertTrue(res.success, 'extxyz parses')
  if (!res.success) return
  assertEqual(res.data.frames.length, 2)
  assertEqual(res.data.metadata[0].energy, -12.5)
  assertEqual(res.data.metadata[1].energy, -12.7)
  assertEqual(res.data.metadata[0].temperature, 300)
  assertTrue(res.data.stats!.has_energy, 'energy stat flagged')
}

function testPmgJsonParse() {
  const res = parsePmgJson(PMG_JSON_SAMPLE, 'traj.json')
  assertTrue(res.success, 'pymatgen JSON parses')
  if (!res.success) return
  assertEqual(res.data.frames.length, 2)
  assertEqual(res.data.metadata[0].energy, -7.5)
  assertTrue(res.data.stats!.has_forces, 'forces present')
  const rms = res.data.metadata[0].rms_force!
  assertTrue(Math.abs(rms - 0.1) < 1e-6, `pmg JSON RMS force = ${rms}, expected 0.1`)
}

function testDispatcherRoutesToCorrectParser() {
  const xdatcar = parseTrajectory(XDATCAR_SAMPLE, 'XDATCAR')
  assertTrue(xdatcar.success, 'dispatcher → xdatcar')
  if (xdatcar.success) assertEqual(xdatcar.data.format, 'vasp_xdatcar')

  const dump = parseTrajectory(LAMMPS_DUMP_SAMPLE, 'md.dump')
  assertTrue(dump.success, 'dispatcher → lammps')
  if (dump.success) assertEqual(dump.data.format, 'lammps_dump')

  const xyz = parseTrajectory(EXTXYZ_SAMPLE, 'traj.xyz')
  assertTrue(xyz.success, 'dispatcher → extxyz')
  if (xyz.success) assertEqual(xyz.data.format, 'extxyz')
}

function testRejectsUnknownFormat() {
  const res = parseTrajectory('garbage data here', 'mystery.bin')
  assertEqual(res.success, false)
}

function run() {
  testFormatDetection()
  testXdatcarParse()
  testLammpsDumpParseWithForces()
  testExtxyzCommentMetadata()
  testPmgJsonParse()
  testDispatcherRoutesToCorrectParser()
  testRejectsUnknownFormat()
  console.log('analysis trajectory tests passed')
}

run()
