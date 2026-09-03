/**
 * Mounts the CLI bridge on the dev server, on the dev server's own port.
 *
 * A second listener would mean a second origin and therefore CORS for the page
 * half of the bridge; sharing the Vite port keeps `/stream` and `/result`
 * same-origin and leaves exactly one thing for a CLI to be pointed at.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Plugin, ViteDevServer } from 'vite'

import { createZatomDevMcpBridge, type ZatomDevMcpBridge } from './dev-mcp-bridge'

const SESSION_FILE = '.zatom/cli-bridge.json'

function resolvedPort(server: ViteDevServer): number | null {
  const address = server.httpServer?.address() as AddressInfo | string | null | undefined
  if (!address || typeof address === 'string') return server.config.server.port ?? null
  return address.port
}

export function zatomCliBridge(options: {
  /**
   * Tool domains offered at connect time. Omit for the default set; agents widen
   * it at runtime with `zatom_enable_domains`.
   */
  domains?: readonly string[]
} = {}): Plugin {
  let bridge: ZatomDevMcpBridge | null = null

  return {
    name: 'zatom-cli-bridge',
    apply: 'serve',
    configureServer(server) {
      bridge = createZatomDevMcpBridge({
        onerror: (error) => server.config.logger.error(`[zatom-cli-bridge] ${error.message}`),
        ...(options.domains ? { domains: options.domains } : {}),
      })
      const instance = bridge
      server.middlewares.use((request, response, next) => instance.middleware(request, response, next))

      server.httpServer?.once('listening', () => {
        const port = resolvedPort(server)
        if (port === null) return
        const session = instance.session(port)
        const file = resolve(server.config.root, SESSION_FILE)
        try {
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        } catch (error) {
          server.config.logger.warn(`[zatom-cli-bridge] could not write ${SESSION_FILE}: ${String(error)}`)
        }
        server.config.logger.info([
          '',
          '  zatom CLI bridge (loopback only, new token each start)',
          `  MCP endpoint  ${session.endpoint}`,
          `  Codex         ${session.registerCodex}`,
          `  Claude Code   ${session.registerClaude}`,
          `  Session file  ${SESSION_FILE}`,
          '',
        ].join('\n'))
      })

      server.httpServer?.once('close', () => { void instance.close() })
    },
    async closeBundle() {
      await bridge?.close()
      bridge = null
    },
  }
}
