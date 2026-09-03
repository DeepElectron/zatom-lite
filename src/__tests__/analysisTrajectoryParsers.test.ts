import { assertEqual, assertTrue } from '../testing/assert'
import {
  detectBinaryFormat,
  detectFormat,
  isAseTraj,
  parseAseTraj,
  parseGaussianOutput,
  parseTrajectory,
} from '../lib/analysis/trajectory'

const GAUSSIAN_SAMPLE = `
 Entering Link 1 = /opt/g16/l1.exe
 Initial command:
 ...

                          Input orientation:
 ---------------------------------------------------------------------
 Center     Atomic      Atomic             Coordinates (Angstroms)
 Number     Number       Type             X           Y           Z
 ---------------------------------------------------------------------
      1          6           0        0.000000    0.000000    0.000000
      2          1           0        1.090000    0.000000    0.000000
 ---------------------------------------------------------------------

 SCF Done:  E(RB3LYP) =  -40.5183945000     A.U. after    8 cycles

                          Standard orientation:
 ---------------------------------------------------------------------
 Center     Atomic      Atomic             Coordinates (Angstroms)
 Number     Number       Type             X           Y           Z
 ---------------------------------------------------------------------
      1          6           0        0.000100    0.000000    0.000000
      2          1           0        1.090100    0.000000    0.000000
 ---------------------------------------------------------------------

 SCF Done:  E(RB3LYP) =  -40.5183950000     A.U. after    6 cycles

                          Standard orientation:
 ---------------------------------------------------------------------
 Center     Atomic      Atomic             Coordinates (Angstroms)
 Number     Number       Type             X           Y           Z
 ---------------------------------------------------------------------
      1          6           0        0.000200    0.000000    0.000000
      2          1           0        1.090200    0.000000    0.000000
 ---------------------------------------------------------------------
`

function testGaussianBasicParse() {
  const result = parseGaussianOutput(GAUSSIAN_SAMPLE, 'opt.log')
  assertTrue(result.success, 'gaussian opt.log parses')
  if (!result.success) return
  // 1 Input + 2 Standard orientation blocks = 3 frames.
  assertEqual(result.data.frames.length, 3)
  assertEqual(result.data.frames[0].atoms.length, 2)
  assertEqual(result.data.frames[0].atoms[0].element, 'C')
  assertEqual(result.data.frames[0].atoms[1].element, 'H')
  // Frame 1 picks up E from "SCF Done" preceding it. Energy stored in eV.
  assertTrue(
    result.data.metadata[1].energy !== undefined && result.data.metadata[1].energy < 0,
    'energy parsed in eV (negative)',
  )
}

function testGaussianFormatDetection() {
  assertEqual(detectFormat(GAUSSIAN_SAMPLE, 'foo.log'), 'gaussian')
  // Filename alone should not falsely tag arbitrary .log files as Gaussian.
  assertEqual(detectFormat('some random log content', 'app.log'), 'unknown')
}

function testAseTrajMagicDetection() {
  // ASE ULM magic = "- of Ulm" (8 bytes).
  const magic = new Uint8Array([0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d, 0, 0])
  const buf = magic.buffer
  assertTrue(isAseTraj(buf), 'magic bytes recognised')
  assertEqual(detectBinaryFormat(buf, 'sample.traj'), 'ase_traj')
}

function testAseTrajGracefulNotice() {
  const magic = new Uint8Array([0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d, 0, 0])
  const result = parseAseTraj(magic.buffer)
  assertEqual(result.success, false)
  if (result.success === false) {
    // Helpful, mentions the conversion path.
    assertTrue(/extxyz|ase convert/i.test(result.error), 'error message guides user to conversion')
  }
}

function testDispatcherRoutesGaussian() {
  const result = parseTrajectory(GAUSSIAN_SAMPLE, 'opt.log')
  assertTrue(result.success && result.data.format === 'gaussian', 'dispatcher → gaussian')
}

function run() {
  testGaussianBasicParse()
  testGaussianFormatDetection()
  testAseTrajMagicDetection()
  testAseTrajGracefulNotice()
  testDispatcherRoutesGaussian()
  console.log('analysis trajectory parsers (Gaussian + ASE) tests passed')
}

run()
