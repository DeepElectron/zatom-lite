// Runner for the assert-style test suite (src/testing/assert.ts).
//
// These files run assertions at module scope instead of using describe/it. Running one file
// therefore means importing it and observing whether it throws. This runner discovers files,
// loads each in isolation, and reports failures through a non-zero exit code.
//
// Loading uses the project's Vite ssrLoadModule path instead of a separate ts-node/tsx setup,
// so TypeScript transforms, aliases, and dependency deduplication match development and builds.
//
// Files importing Vitest rely on its injected hooks and are left to `vitest run`. The package
// test script runs both suites in sequence.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

/** Recursively collect *.test.ts and *.test.tsx files under src. */
function collectTestFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectTestFiles(full))
    } else if (/\.test\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

/** Leave Vitest-style files to the Vitest runner. */
function isVitestStyle(file) {
  return /from\s+['"]vitest['"]/.test(readFileSync(file, 'utf8'))
}

/**
 * Clear the SSR module cache so each test file receives fresh module instances.
 * Vite 8 exposes environments.ssr.moduleGraph; server.moduleGraph remains a compatibility
 * fallback for nearby Vite versions.
 */
function invalidateModules(server) {
  const graph = server.environments?.ssr?.moduleGraph ?? server.moduleGraph
  graph.invalidateAll()
}

function formatError(error) {
  if (error instanceof Error) {
    // Keep only the useful head of Vite's deep SSR stack.
    const stack = (error.stack ?? '').split('\n').slice(0, 4).join('\n')
    return stack || error.message
  }
  return String(error)
}

async function main() {
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const all = collectTestFiles(SRC).sort()
  const candidates = all.filter((file) => !isVitestStyle(file))
  const selected = filters.length
    ? candidates.filter((file) => {
        const rel = relative(ROOT, file).split(sep).join('/')
        return filters.some((filter) => rel.includes(filter))
      })
    : candidates

  if (selected.length === 0) {
    console.error(
      filters.length
        ? `No assert-style test files matched: ${filters.join(', ')}`
        : 'No assert-style test files found under src/.',
    )
    process.exit(1)
  }

  const skipped = all.length - candidates.length
  console.log(
    `Running ${selected.length} assert-style test file(s)` +
      (skipped > 0 ? ` (${skipped} vitest-style file(s) deferred to \`vitest run\`)` : ''),
  )

  // Middleware mode provides SSR transforms without opening a port.
  const server = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  })

  const failures = []
  let passedFiles = 0
  let passedCases = 0
  let currentFile = null

  // Some files call main() at module scope without awaiting it. Their rejection can arrive after
  // ssrLoadModule resolves, so attribute unhandled rejections to the current file and continue.
  process.on('unhandledRejection', (reason) => {
    failures.push({ file: currentFile ?? '(unknown file)', case: 'async top-level', error: reason })
  })

  for (const file of selected) {
    const rel = relative(ROOT, file).split(sep).join('/')
    currentFile = rel
    try {
      // Reset the module graph per file. These tests rely on module-level stores, registries,
      // and IndexedDB handles, so shared instances would leak state between files.
      invalidateModules(server)

      const mod = await server.ssrLoadModule(file)

      // Module-scope assertions have already run; explicitly invoke exported test* functions.
      const exported = Object.entries(mod).filter(
        ([name, value]) => typeof value === 'function' && /^test/.test(name),
      )
      for (const [name, fn] of exported) {
        try {
          await fn()
          passedCases += 1
        } catch (error) {
          failures.push({ file: rel, case: name, error })
        }
      }

      // Let fire-and-forget chains settle before advancing, so failures keep the correct file.
      await new Promise((resolve) => setTimeout(resolve, 0))

      if (!failures.some((failure) => failure.file === rel)) {
        passedFiles += 1
        console.log(`  PASS ${rel}${exported.length ? ` (${exported.length} case(s))` : ''}`)
      }
    } catch (error) {
      failures.push({ file: rel, error })
    }

    if (failures.some((failure) => failure.file === rel)) {
      console.log(`  FAIL ${rel}`)
    }
  }

  await server.close()

  console.log('')
  console.log(`Files:  ${passedFiles} passed, ${failures.length ? new Set(failures.map((f) => f.file)).size : 0} failed, ${selected.length} total`)
  if (passedCases > 0) console.log(`Cases:  ${passedCases} passed (exported test* functions)`)

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log('')
      console.log(`  ${failure.file}${failure.case ? ` › ${failure.case}` : ''}`)
      console.log(
        formatError(failure.error)
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      )
    }
    process.exit(1)
  }

  console.log('')
  console.log('All assert-style tests passed.')

  // The suite imports application modules that may own long-lived timers or
  // file watchers. At this point every test has settled and Vite is closed, so
  // those handles must not keep the assert runner alive and prevent the
  // package script from advancing to `vitest run`.
  await new Promise((resolve) => process.stdout.write('', resolve))
  process.exit(0)
}

main().catch((error) => {
  console.error('Test runner crashed before running any test:')
  console.error(formatError(error))
  process.exit(1)
})
