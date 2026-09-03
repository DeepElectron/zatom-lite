import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scanRoots = [
  'src',
  'README.md',
  'package.json',
  'vite.config.ts',
  'AGENTS.md',
  'BRANDING.md',
  'THIRD_PARTY_NOTICES.md',
  'doc',
  'docs',
  'skills',
  'deploy',
  '.github',
  'scripts',
  'bin',
  'mobile-viewer.html',
  'public/mobile-samples',
  'public/legal/THIRD_PARTY_NOTICES.txt',
  'dist',
  'desktop-assets',
  'desktop-runtime',
  'desktop-package',
  'electron-builder.yml',
]

const ignoredDirectories = new Set(['.git', 'node_modules'])
const textExtensions = new Set([
  '', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.py', '.svg', '.ts', '.tsx', '.txt', '.yml', '.yaml',
])

const forbiddenPaths = [
  /(^|\/)src\/tutorial(?:\/|$)/i,
  /(^|\/)src\/ui\/panels\/tutorial(?:[-/]|$)/i,
  /(^|\/)src\/__tests__\/(?:guideScript|tutorialLevelJudge|tutorialSession)\.test\.tsx?$/i,
  /(^|\/)src\/audio\.ts$/i,
  /(^|\/)src\/services\/[^/]*(?:audio|sound)[^/]*\.(?:ts|tsx)$/i,
  /(^|\/)src\/ui\/interaction-sound-controller\.tsx$/i,
  /(^|\/)src\/lib\/device(?:\/|$)/i,
  /(^|\/)src\/orchestration\/devicecad/i,
  /(^|\/)device-cad/i,
  /(^|\/)src\/__tests__\/device/i,
  /(^|\/)mobile-viewer\.html$/i,
  /(^|\/)src\/mobile(?:\/|$)/i,
  /(^|\/)mobile-samples(?:\/|$)/i,
  /(^|\/)mobile-viewer-[^/]*\.(?:js|css)$/i,
  /(^|\/)src\/desktop(?:\/|$)/i,
  /(^|\/)desktop-assets(?:\/|$)/i,
  /(^|\/)desktop-runtime(?:\/|$)/i,
  /(^|\/)desktop-package(?:\/|$)/i,
  /(^|\/)electron-builder\.yml$/i,
  /(^|\/)\.github\/workflows\/desktop-release\.yml$/i,
  /(^|\/)scripts\/(?:build-desktop|run-desktop-dev|electron-builder-before-build|verify-desktop-package|verify-mas-readiness|write-desktop-checksums)\.mjs$/i,
  /(^|\/)src\/ui\/desktop-title-bar\.tsx$/i,
  /(^|\/)bin\/zatom-mcp\.mjs$/i,
  /(^|\/)src\/agent\/(?:agent-node|mcp-stdio-entry|mcp-runtime-profile|workspace-context|local-process-provider)\.ts$/i,
  /(^|\/)src\/agent\/workers(?:\/|$)/i,
  /(^|\/)LITE_REVIEW\.md$/i,
  /(^|\/)docs\/frontend-operation-acceptance\.md$/i,
  /(^|\/)src\/lib\/analysis\/builders\/NOT-BUILT\.md$/i,
]

const forbiddenText = [
  { label: 'removed tutorial state or anchor', pattern: /data-tut|zatom:tutorial(?:-progress-changed)?|\bTUTORIAL_[A-Z0-9_]+\b|\b(?:TutorialEntryButton|TutorialGuideOverlay|TutorialLevelMap|TutorialPanel|TutorialTaskRail|TutorialAnchor|TutorialQuestSpec|useTutorialSession|useTutorialMapOpen|useTutorialStartingStructure|anchorAttr)\b/g },
  { label: 'removed tutorial interface', pattern: /Open tutorial|tutorial level map|Resize tutorial panel|zatom-tutorial|tutorial-sketch/gi },
  { label: 'removed tutorial font package', pattern: /@fontsource\/(?:caveat|covered-by-your-grace|walter-turncoat)\b/gi },
  { label: 'tutorial-only global font face', pattern: /@font-face\s*\{[^}]*font-family:\s*['"](?:Caveat|Covered By Your Grace|Walter Turncoat)['"][^}]*}/gis },
  { label: 'tutorial-only global font token', pattern: /--font-(?:caveat|handwriting)\b/gi },
  { label: 'removed sound package', pattern: /@inklu\/audio|@rexa-developer\/tiks|@thenormvg\/web-have-sounds|\bcuelume\b|\btone\.js\b|from\s+['"]tone['"]|["']tone["']\s*:/gi },
  { label: 'removed sound API', pattern: /\b(?:playSound|soundManager|useSound|playInkluAudio|InteractionSoundController|OrbitZoomSoundSession|ScaleZoomSoundSession|ScrollSoundAccumulator)\b/g },
  { label: 'sound-only DOM hook', pattern: /data-sound(?:-zoom-viewport)?|Mute interface sounds|Enable interface sounds/gi },
  { label: 'Device/CAD capability', pattern: /device[-_ ]?cad|\bDeviceCad\w*|\bdeviceCad\w*|\bFETMOD\b|\bGAAFET\b|\bDevice Scenes\b|\bCAD\b/gi },
  { label: 'removed mobile application', pattern: /mobile[-_/ ]?viewer|mobile-samples|\bzatomMobile\b|\bZatomMobileApi\b|\bMobileViewerApp\b|\bWKWebView\b|messageHandlers(?:\?\.|\.)zatom\b/gi },
  { label: 'removed native mobile runtime', pattern: /__VERLET_NATIVE_SHELL__|\bisNativeIosShellRuntime\b|\bNativeThermalState\b|\bnativeThermalState\b|\bsetNativeThermalState\b/gi },
  { label: 'removed native Materials Project bridge', pattern: /\bNativeMaterialsProject\w*\b|__materialsProjectNative\w*|__materialsProjectPendingRequests|messageHandlers(?:\?\.|\.)materialsProject\b/gi },
  { label: 'removed Electron dependency', pattern: /from\s+['"]electron['"]|import\(\s*['"]electron['"]\s*\)|electron-builder/gi },
  { label: 'removed desktop bridge', pattern: /\bZATOM_DESKTOP_[A-Z0-9_]+\b|\bZatomDesktop\w*\b|\bzatomDesktop\b|window\.zatomDesktop/gi },
  { label: 'removed desktop build path', pattern: /desktop-(?:runtime|package|assets)|src\/desktop|desktop:(?:build|dev|package|make|mas|checksums|start|verify)/gi },
  { label: 'removed desktop application surface', pattern: /\bMac App Store\b|\bApp-hosted MCP\b|zatom:\/\/app|Electron\s+(?:main|preload|runtime|build|package|host|window)/gi },
  { label: 'removed host platform branding', pattern: /Eleforge|LabFlow|AppShellHost|MaterialIdeShell|['"]\[v0\]/gi },
  { label: 'developer-local absolute path', pattern: /\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/g },
  { label: 'enabled application source map', pattern: /sourcemap\s*:\s*true/gi },
]

function collectFiles(path) {
  if (!existsSync(path)) return []
  const info = statSync(path)
  if (!info.isDirectory()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []
    return collectFiles(join(path, entry.name))
  })
}

const files = scanRoots.flatMap((entry) => collectFiles(join(projectRoot, entry)))
const failures = []

function verifyWebOnlyPackage() {
  const packagePath = join(projectRoot, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (manifest.private !== true) failures.push('package.json: Zatom Lite must remain private and web-only')
  if ('bin' in manifest) failures.push('package.json: executable package bins are forbidden')
  if ('exports' in manifest) failures.push('package.json: library exports are forbidden')
  if (manifest.scripts?.mcp) failures.push('package.json: standalone MCP script is forbidden')
  if (manifest.dependencies?.['@modelcontextprotocol/server']) {
    failures.push('package.json: development MCP server must not be a production dependency')
  }
}

/**
 * Public Boltz examples are a deliberately narrow, immutable viewing bundle.
 * Runtime job ledgers, remote identifiers, timestamps, cost data and unused
 * result artifacts belong in the gitignored .zatom state directory instead.
 */
function verifyPublicBoltzExamples() {
  const root = join(projectRoot, 'public', 'boltz-examples')
  const manifestPath = join(root, 'manifest.json')
  const allowedFiles = new Set(['manifest.json', 'inputs/2ptc-polymer.cif'])

  if (!existsSync(manifestPath)) {
    failures.push('public/boltz-examples/manifest.json: required example manifest is missing')
    return
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!Array.isArray(manifest)) throw new Error('top level must be an array')
    const exampleIds = new Set()
    const structurePaths = new Set()

    for (const [exampleIndex, example] of manifest.entries()) {
      if (!example || typeof example !== 'object' || Array.isArray(example)) {
        throw new Error(`example ${exampleIndex} must be an object`)
      }
      const exampleKeys = Object.keys(example).sort().join(',')
      if (exampleKeys !== 'candidates,id') {
        throw new Error(`example ${exampleIndex} has non-public fields: ${exampleKeys}`)
      }
      if (typeof example.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(example.id)) {
        throw new Error(`example ${exampleIndex} has an invalid id`)
      }
      if (exampleIds.has(example.id)) throw new Error(`duplicate example id: ${example.id}`)
      exampleIds.add(example.id)
      if (!Array.isArray(example.candidates) || example.candidates.length === 0) {
        throw new Error(`example ${example.id} has no viewable candidates`)
      }

      for (const [candidateIndex, candidate] of example.candidates.entries()) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error(`${example.id} candidate ${candidateIndex} must be an object`)
        }
        const candidateKeys = Object.keys(candidate).sort().join(',')
        if (candidateKeys !== 'score,structure') {
          throw new Error(`${example.id} candidate ${candidateIndex} has non-public fields: ${candidateKeys}`)
        }
        if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) {
          throw new Error(`${example.id} candidate ${candidateIndex} has an invalid score`)
        }
        const expected = `boltz-examples/${example.id}/${String(candidateIndex).padStart(2, '0')}-structure.cif`
        if (candidate.structure !== expected) {
          throw new Error(`${example.id} candidate ${candidateIndex} must reference ${expected}`)
        }
        const relativeStructure = candidate.structure.slice('boltz-examples/'.length)
        if (structurePaths.has(relativeStructure)) throw new Error(`duplicate structure path: ${candidate.structure}`)
        structurePaths.add(relativeStructure)
        allowedFiles.add(relativeStructure)
        if (!existsSync(join(root, relativeStructure))) {
          throw new Error(`missing structure file: ${candidate.structure}`)
        }
      }
    }
  } catch (error) {
    failures.push(`public/boltz-examples/manifest.json: ${error.message}`)
  }

  for (const absolutePath of collectFiles(root)) {
    const file = relative(root, absolutePath).replaceAll('\\', '/')
    if (!allowedFiles.has(file)) {
      failures.push(`public/boltz-examples/${file}: unpublished Boltz runtime or unused result asset`)
    }
  }
}

verifyWebOnlyPackage()
verifyPublicBoltzExamples()

for (const absolutePath of files) {
  const file = relative(projectRoot, absolutePath).replaceAll('\\', '/')
  if (file === 'scripts/verify-lite-boundary.mjs') continue
  if (/^dist\//.test(file) && file.endsWith('.map')) {
    failures.push(`${file}: generated source map is forbidden`)
    continue
  }
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden lite path`)
    continue
  }
  if (!textExtensions.has(extname(file).toLowerCase())) continue
  const text = readFileSync(absolutePath, 'utf8')
  if (!file.startsWith('dist/') && text.includes('\uFFFD')) {
    const line = text.slice(0, text.indexOf('\uFFFD')).split('\n').length
    failures.push(`${file}:${line}: corrupted replacement character`)
  }
  for (const { label, pattern } of forbiddenText) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    if (!match) continue
    const line = text.slice(0, match.index).split('\n').length
    failures.push(`${file}:${line}: ${label}: ${match[0]}`)
  }
}

if (failures.length > 0) {
  console.error(`Zatom Lite boundary verification failed with ${failures.length} finding(s):`)
  for (const failure of failures.slice(0, 200)) console.error(`- ${failure}`)
  if (failures.length > 200) console.error(`- ... ${failures.length - 200} more`)
  process.exitCode = 1
} else {
  console.log(`Zatom Lite boundary verified across ${files.length} source and build file(s).`)
}
