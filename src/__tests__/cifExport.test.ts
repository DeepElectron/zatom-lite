import { exportToCIF, parseCIF } from '../lib/crystal/cif-parser'
import { assertEqual, assertTrue } from '../testing/assert'

const text = exportToCIF({
  name: 'Cu O cell',
  crystalSystem: 'triclinic',
  latticeParams: { a: 4.1, b: 5.2, c: 6.3, alpha: 78, beta: 83, gamma: 71 },
  atoms: [
    { element: 'Cu', position: [0, 0, 0] },
    { element: 'O', position: [0.25, 0.5, 0.75] },
  ],
})

assertTrue(text.includes('data_Cu_O_cell'), 'CIF export must use a valid normalized data block')
assertTrue(text.includes('# Exported from zatom'), 'CIF export must identify the current product')
assertEqual(text.includes('Crystal Builder'), false, 'CIF export must not retain the obsolete product name')
assertTrue(text.endsWith('\n'), 'CIF export must terminate the final record with a newline')

const parsed = parseCIF(text)
assertEqual(parsed.success, true, 'exported CIF must be accepted by the canonical parser')
if (parsed.success) {
  assertEqual(parsed.data.atoms.length, 2, 'CIF round-trip must preserve the atom count')
  assertTrue(Math.abs(parsed.data.latticeParams.a - 4.1) < 1e-6, 'CIF round-trip must preserve lattice a')
  assertTrue(Math.abs(parsed.data.latticeParams.gamma - 71) < 1e-6, 'CIF round-trip must preserve gamma')
  assertEqual(parsed.data.atoms[1]?.element, 'O', 'CIF round-trip must preserve element identity')
  assertTrue(Math.abs((parsed.data.atoms[1]?.position[2] ?? 0) - 0.75) < 1e-6, 'CIF round-trip must preserve fractional coordinates')
}

console.log('CIF export tests passed')
