import { renderToStaticMarkup } from 'react-dom/server'

import { assertTrue } from '../../../testing/assert'
import { AgentSchemaFields } from '../agent-modeling-fields'

function testRequiredFieldsNeverPresentAsOptional(): void {
  const markup = renderToStaticMarkup(
    <AgentSchemaFields
      schema={{
        type: 'object',
        required: ['goal', 'mode'],
        properties: {
          goal: { type: 'string' },
          mode: { enum: ['built-in', 'provider'] },
          note: { type: 'string' },
        },
      }}
      draft={{ goal: '', mode: '', note: '' }}
      errors={{}}
      onChange={() => undefined}
      showAdvanced
    />,
  )
  assertTrue(markup.includes('placeholder="Enter Goal"'))
  assertTrue(/<option[^>]*disabled=""[^>]*>Select Mode<\/option>/.test(markup))
  assertTrue(markup.includes('placeholder="Optional"'))
}

testRequiredFieldsNeverPresentAsOptional()
console.log('agent modeling field semantics tests passed')
