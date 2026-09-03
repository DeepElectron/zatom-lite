import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'

const projectRoot = resolve(import.meta.dirname, '..')
const scanRoots = ['src', 'scripts', 'deploy', 'index.html', 'vite.config.ts', 'vitest.config.ts']
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const styleExtensions = new Set(['.css', '.html'])
const lineCommentExtensions = new Set(['', '.sh', '.yaml', '.yml'])
const han = /\p{Script=Han}/u
const findings = []

function collect(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) return []
    return collect(join(path, entry.name))
  })
}

function report(file, text, offset, comment) {
  if (!han.test(comment)) return
  const line = text.slice(0, offset).split('\n').length
  findings.push(`${relative(projectRoot, file)}:${line}`)
}

for (const file of scanRoots.flatMap((entry) => collect(join(projectRoot, entry)))) {
  const extension = extname(file).toLowerCase()
  const text = readFileSync(file, 'utf8')
  if (sourceExtensions.has(extension)) {
    const plugins = []
    if (extension === '.ts' || extension === '.tsx' || extension === '.mts') plugins.push('typescript')
    if (extension === '.tsx' || extension === '.jsx') plugins.push('jsx')
    const ast = parse(text, { sourceType: 'unambiguous', plugins })
    for (const comment of ast.comments ?? []) {
      report(file, text, comment.start ?? 0, text.slice(comment.start ?? 0, comment.end ?? 0))
    }
    continue
  }
  if (styleExtensions.has(extension)) {
    const pattern = extension === '.html' ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\//g
    for (const match of text.matchAll(pattern)) report(file, text, match.index, match[0])
    continue
  }
  if (lineCommentExtensions.has(extension)) {
    let offset = 0
    for (const line of text.split('\n')) {
      if (line.trimStart().startsWith('#')) report(file, text, offset, line)
      offset += line.length + 1
    }
  }
}

if (findings.length > 0) {
  console.error(`Non-English code comments found in ${findings.length} location(s):`)
  for (const finding of findings.slice(0, 200)) console.error(`- ${finding}`)
  if (findings.length > 200) console.error(`- ... ${findings.length - 200} more`)
  process.exitCode = 1
} else {
  console.log('Code comment language verified: no Han-script comments found.')
}
