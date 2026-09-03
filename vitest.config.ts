import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const PROJECT_ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * The repository contains both top-level assertion tests and Vitest suites.
 * Keep collection aligned with scripts/run-modeler-tests.mjs so each file is
 * owned by exactly one runner.
 */
function collectVitestStyleTests(): string[] {
  const found: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.test\.tsx?$/.test(entry) && /from\s+['"]vitest['"]/.test(readFileSync(full, 'utf8'))) {
        found.push(relative(PROJECT_ROOT, full).split(sep).join('/'))
      }
    }
  }

  walk(join(PROJECT_ROOT, 'src'))
  return found.sort()
}

export default defineConfig({
  test: {
    include: collectVitestStyleTests(),
  },
})
