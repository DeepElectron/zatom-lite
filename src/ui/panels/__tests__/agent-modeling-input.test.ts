import { assertDeepEqual, assertEqual, assertTrue } from '../../../testing/assert'
import {
  agentFieldUsesMultilineEditor,
  agentFieldUsesFilePicker,
  agentFieldUsesJsonEditor,
  createAgentInputDraft,
  encodeAgentFileBase64,
  parseAgentInputDraft,
  type AgentInputSchema,
} from '../agent-modeling-input'

const schema: AgentInputSchema = {
  type: 'object',
  required: ['method', 'steps', 'cutoffs', 'options'],
  properties: {
    method: { enum: ['fast', 'accurate'], default: 'accurate' },
    steps: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    enabled: { type: 'boolean', default: true },
    cutoffs: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2 },
    options: { type: 'object' },
    seed: { const: 42 },
  },
}

function testUnionObjectArraysUseTheStructuredEditor() {
  assertTrue(agentFieldUsesJsonEditor({
    type: 'array',
    items: {
      oneOf: [
        { type: 'object', properties: { op: { const: 'translate' } } },
        { type: 'object', properties: { op: { const: 'wrap' } } },
      ],
    },
  }))
}

function testLargeTextUsesMultilineEditor() {
  assertTrue(agentFieldUsesMultilineEditor({ type: 'string', maxLength: 16 * 1024 * 1024 }))
  assertTrue(!agentFieldUsesMultilineEditor({ type: 'string', maxLength: 512 }))
}

function testBase64FileFieldsUseFilePickerAndExactBytes() {
  assertTrue(agentFieldUsesFilePicker({ type: 'string', contentEncoding: 'base64' }))
  assertTrue(!agentFieldUsesFilePicker({ type: 'string', maxLength: 16 * 1024 * 1024 }))
  assertEqual(encodeAgentFileBase64(Uint8Array.from([0, 1, 2, 253, 254, 255]).buffer), 'AAEC/f7/')
}

function testDefaultsAndPrimitiveCollections() {
  const draft = createAgentInputDraft(schema, {
    cutoffs: [2.5, 4],
    options: { tolerance: 0.01 },
  })
  assertEqual(draft.method, 'accurate')
  assertEqual(draft.steps, '20')
  assertEqual(draft.enabled, 'true')

  const parsed = parseAgentInputDraft(schema, draft)
  assertDeepEqual(parsed.errors, {})
  assertDeepEqual(parsed.input, {
    method: 'accurate',
    steps: 20,
    enabled: true,
    cutoffs: [2.5, 4],
    options: { tolerance: 0.01 },
    seed: 42,
  })
}

function testValidationErrorsStayAtTheirFields() {
  const parsed = parseAgentInputDraft(schema, {
    method: 'unsupported',
    steps: '0.5',
    enabled: 'sometimes',
    cutoffs: '2.5',
    options: '[]',
  })
  assertEqual(parsed.errors.method, 'Choose one of the supported values')
  assertEqual(parsed.errors.steps, 'Must be an integer')
  assertEqual(parsed.errors.enabled, 'Choose true or false')
  assertTrue(parsed.errors.cutoffs.includes('at least 2'))
  assertEqual(parsed.errors.options, 'Must be a JSON object')
}

testDefaultsAndPrimitiveCollections()
testValidationErrorsStayAtTheirFields()
testUnionObjectArraysUseTheStructuredEditor()
testLargeTextUsesMultilineEditor()
testBase64FileFieldsUseFilePickerAndExactBytes()
console.log('agent modeling input tests passed')
