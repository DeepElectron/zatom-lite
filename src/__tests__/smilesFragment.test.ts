import { generateFragmentFromSmiles } from '../lib/molecule/smiles-fragment'
import { assertEqual } from '../testing/assert'

const marked = generateFragmentFromSmiles('*CO')
assertEqual(marked.success, true, 'a marked SMILES must generate a fragment')
if (marked.success) {
  assertEqual(marked.data.atoms.some((atom) => atom.element === 'Xe'), false, 'attachment sentinels must not leak into the fragment')
  assertEqual(marked.data.atoms[marked.data.attachmentIndex]?.element, 'C', "'*' must select the bonded carbon as attachment atom")
  assertEqual(marked.data.atoms.length, 5, 'marked hydroxymethyl must reserve one open valence')
}

const invalid = generateFragmentFromSmiles('C(')
assertEqual(invalid.success, false, 'invalid SMILES must fail without producing a fragment')

console.log('SMILES fragment tests passed')
