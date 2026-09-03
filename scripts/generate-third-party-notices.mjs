import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = path.join(repositoryRoot, 'package-lock.json')
const outputPath = path.join(repositoryRoot, 'public', 'legal', 'THIRD_PARTY_NOTICES.txt')

// These published packages predate package-lock's current `license` field but
// ship a readable license file. Keep the explicit mapping narrow and fail on
// any newly missing metadata instead of guessing.
const verifiedLicenseOverrides = new Map([
  ['eve-raphael@0.5.0', 'Apache-2.0'],
  ['asap@1.0.0', 'MIT'],
  ['webgl-constants@1.1.1', 'MIT'],
])

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/'
  return packagePath.slice(packagePath.lastIndexOf(marker) + marker.length)
}

function normalizedText(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

async function bundledNoticeFiles(packagePath) {
  const directory = path.join(repositoryRoot, packagePath)
  let entries
  try {
    entries = await readdir(directory)
  } catch {
    // Optional packages for other operating systems legitimately appear in the
    // lockfile without being installed on this machine. Their verified SPDX
    // metadata remains in the inventory below.
    return []
  }

  const names = entries
    .filter((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const files = []
  for (const name of names) {
    const filePath = path.join(directory, name)
    if (!(await stat(filePath)).isFile()) continue
    const text = normalizedText(await readFile(filePath, 'utf8'))
    if (text) files.push({ name, text })
  }
  return files
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const packages = []
for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!packagePath || metadata.dev || !metadata.version || !packagePath.includes('node_modules/')) continue
  const name = packageNameFromPath(packagePath)
  const identity = `${name}@${metadata.version}`
  const license = metadata.license ?? verifiedLicenseOverrides.get(identity)
  if (!license) {
    throw new Error(`Missing verified license metadata for ${identity} (${packagePath})`)
  }
  packages.push({
    identity,
    license,
    packagePath,
    resolved: metadata.resolved,
    notices: await bundledNoticeFiles(packagePath),
  })
}

packages.sort((left, right) => left.identity.localeCompare(right.identity, 'en'))

const lines = [
  'ZATOM THIRD-PARTY SOFTWARE NOTICES',
  '',
  'Copyright © 2026 zauq tech. Zatom includes third-party software.',
  'Each package below remains subject to its own copyright notices and license terms.',
  '',
  'This deterministic inventory was generated from package-lock.json by',
  'scripts/generate-third-party-notices.mjs. It includes production dependency',
  'records and the license/notice files present in the installed packages.',
  'Optional packages for other platforms may have metadata only on this machine.',
  '',
  `PACKAGE INVENTORY (${packages.length})`,
  '',
]

for (const entry of packages) {
  lines.push(`${entry.identity} | ${entry.license}`)
  if (typeof entry.resolved === 'string') lines.push(`  Source package: ${entry.resolved}`)
}

const noticeGroups = new Map()
for (const entry of packages) {
  for (const notice of entry.notices) {
    const digest = createHash('sha256').update(notice.text).digest('hex')
    const existing = noticeGroups.get(digest)
    if (existing) {
      existing.packages.push(`${entry.identity} (${notice.name})`)
    } else {
      noticeGroups.set(digest, {
        packages: [`${entry.identity} (${notice.name})`],
        text: notice.text,
      })
    }
  }
}

lines.push('', `UPSTREAM LICENSE AND NOTICE TEXTS (${noticeGroups.size} unique files)`, '')
for (const [digest, notice] of [...noticeGroups.entries()].sort((left, right) => (
  left[1].packages[0].localeCompare(right[1].packages[0], 'en')
))) {
  lines.push('='.repeat(78))
  lines.push(`SHA-256: ${digest}`)
  lines.push(`Used by: ${notice.packages.join(', ')}`)
  lines.push('-'.repeat(78), notice.text, '')
}

lines.push(
  '='.repeat(78),
  'END OF THIRD-PARTY SOFTWARE NOTICES',
  '',
)

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, lines.join('\n'), 'utf8')
console.log(`Wrote ${path.relative(repositoryRoot, outputPath)} for ${packages.length} packages (${noticeGroups.size} unique notice files)`)
