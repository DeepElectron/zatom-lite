import { expect, it } from 'vitest'

import {
  parseZatomViewportBridgeRequest,
  parseZatomViewportBridgeResponse,
  ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
  ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
} from '../viewport-contracts'

it('accepts only the closed browser viewport request contract', () => {
  const request = parseZatomViewportBridgeRequest({
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
    requestId: 'viewport:42',
    operation: 'read-structure',
  })
  expect(request).toEqual({
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
    requestId: 'viewport:42',
    operation: 'read-structure',
  })

  expect(parseZatomViewportBridgeRequest({
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
    requestId: 'viewport:43',
    operation: 'camera-look-at',
    payload: { request: { target: 'all' } },
  }).payload).toEqual({ request: { target: 'all' } })

  expect(() => parseZatomViewportBridgeRequest({ ...request, operation: 'write-file' })).toThrow()
  expect(() => parseZatomViewportBridgeRequest({ ...request, unexpected: true })).toThrow()
})

it('binds viewport responses to the exact request id', () => {
  const success = {
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
    requestId: 'viewport:42',
    ok: true,
    value: { viewportId: 'vp-1' },
  }
  expect(parseZatomViewportBridgeResponse(success, 'viewport:42').value).toEqual({ viewportId: 'vp-1' })
  expect(() => parseZatomViewportBridgeResponse(success, 'viewport:43')).toThrow()
  expect(() => parseZatomViewportBridgeResponse({ ...success, error: 'impossible' }, 'viewport:42')).toThrow()

  const failure = parseZatomViewportBridgeResponse({
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
    requestId: 'viewport:44',
    ok: false,
    error: 'stale workspace',
    errorCode: 'workspace_stale',
  }, 'viewport:44')
  expect(failure).toMatchObject({ ok: false, errorCode: 'workspace_stale' })
})
