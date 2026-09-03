import { normalizePinnedFunctionIds } from '../orchestration/functionPins'
import { assertDeepEqual } from '../testing/assert'

assertDeepEqual(
  normalizePinnedFunctionIds([]),
  ['tools', 'cell', 'select', 'measure', 'super', 'plane'],
  'the Functions grid must start with the six core manual modeling controls',
)

console.log('function pin tests passed')
