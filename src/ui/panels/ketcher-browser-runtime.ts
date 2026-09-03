import { Buffer } from 'buffer'
import browserProcess from 'process'

/** Install only the browser globals used by Ketcher's lazy-loaded bundles. */
export function installKetcherBrowserRuntime(): void {
  const runtime = globalThis as typeof globalThis & Record<string, unknown>
  if (runtime.Buffer === undefined) runtime.Buffer = Buffer
  if (runtime.global === undefined) runtime.global = globalThis
  if (runtime.process === undefined) runtime.process = browserProcess
}
