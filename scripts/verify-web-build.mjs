import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(repositoryRoot, 'dist')
const MAX_INITIAL_JAVASCRIPT_GZIP_BYTES = 2_000_000
const MAX_SINGLE_JAVASCRIPT_GZIP_BYTES = 8_000_000

const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8')
const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1]
if (!csp) throw new Error('Built web app is missing its Content-Security-Policy')

const scriptSource = csp.split(';')
  .map((directive) => directive.trim().split(/\s+/))
  .find(([name]) => name === 'script-src')
if (!scriptSource) throw new Error('Built web CSP is missing script-src')
if (scriptSource.includes("'unsafe-eval'")) {
  throw new Error("Built web script-src must not grant 'unsafe-eval'")
}

const paperScriptCompilerSignature = 'abstract boolean byte char class double enum export extends final float goto implements'
const developmentOnlySignatures = ['/__zatom-cli/', 'Attach Codex or Claude Code', '.zatom/cli-bridge.json']
const assets = await readdir(path.join(outputRoot, 'assets'))
for (const name of assets.filter((entry) => entry.endsWith('.js'))) {
  const source = await readFile(path.join(outputRoot, 'assets', name), 'utf8')
  if (source.includes(paperScriptCompilerSignature)) {
    throw new Error(`Built web asset ${name} contains the PaperScript compiler runtime code generator`)
  }
  const developmentSignature = developmentOnlySignatures.find((signature) => source.includes(signature))
  if (developmentSignature) {
    throw new Error(`Built web asset ${name} contains development-only bridge code: ${developmentSignature}`)
  }
  const gzipBytes = gzipSync(Buffer.from(source), { level: 9 }).byteLength
  if (gzipBytes > MAX_SINGLE_JAVASCRIPT_GZIP_BYTES) {
    throw new Error(`Built web asset ${name} exceeds the ${MAX_SINGLE_JAVASCRIPT_GZIP_BYTES} byte gzip budget`)
  }
}

const initialEntries = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi)]
  .map((match) => path.join(outputRoot, match[1].replace(/^\/+/, '')))
const visited = new Set()
const staticImportPattern = /\b(?:import|export)\s*(?:[^'";\n]*?from\s*)?["']([^"']+\.js)["']/g

async function collectInitialJavaScript(file) {
  const normalized = path.resolve(file)
  if (visited.has(normalized)) return
  visited.add(normalized)
  const source = await readFile(normalized, 'utf8')
  for (const match of source.matchAll(staticImportPattern)) {
    if (!match[1].startsWith('.')) continue
    await collectInitialJavaScript(path.resolve(path.dirname(normalized), match[1]))
  }
}

for (const entry of initialEntries) await collectInitialJavaScript(entry)
const initialGzipBytes = [...visited].reduce((total, file) => {
  return total + gzipSync(readFileSync(file), { level: 9 }).byteLength
}, 0)

if (initialGzipBytes > MAX_INITIAL_JAVASCRIPT_GZIP_BYTES) {
  throw new Error(
    `Initial JavaScript exceeds the ${MAX_INITIAL_JAVASCRIPT_GZIP_BYTES} byte gzip budget: ${initialGzipBytes}`,
  )
}

console.log(
  `Web build verified: CSP is safe and ${visited.size} initial JavaScript chunks total ${initialGzipBytes} gzip bytes`,
)
