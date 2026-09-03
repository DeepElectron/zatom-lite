import { exportAtomsToXYZ } from '../lib/crystal/xyz-export'
import { parseXYZ } from '../lib/crystal/xyz-parser'
import { assertEqual } from '../testing/assert'

const content = exportAtomsToXYZ([
  { element: 'C', cartesian: [1.25, -0.5, 0] },
  { element: 'H', position: [2, 0, 0.75] },
])

assertEqual(content.split('\n')[0], '2', 'XYZ export must declare the exact atom count')
assertEqual(content.split('\n')[1], 'Exported from zatom', 'XYZ export must use the current product identity')

const parsed = parseXYZ(content)
assertEqual(parsed.success, true, 'exported XYZ must round-trip through the canonical parser')
if (parsed.success) {
  assertEqual(parsed.data.atoms.length, 2, 'round-trip must preserve all atoms')
  assertEqual(parsed.data.atoms[0]?.cartesian[0], 1.25, 'round-trip must preserve coordinates')
  assertEqual(parsed.data.atoms[1]?.element, 'H', 'round-trip must preserve elements')
}

console.log('XYZ export tests passed')
