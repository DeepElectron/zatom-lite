/**
 * One-shot local quantum-chemistry visualisation bundle.
 *
 * A bound folder commonly contains a density CUBE, an ESP CUBE, HOMO/LUMO
 * CUBEs and optionally a Molden wavefunction. Those five files are one user
 * task, not five unrelated imports. This tool resolves their roles, validates
 * their shared coordinate/grid frame, prepares four independent viewport
 * stores off-screen, and swaps the complete 2x2 workspace in one synchronous
 * transaction. No partially-mounted state is ever visible.
 */

import type { CubData } from '../lib/molecular-orbitals/CubParser'
import { CubParser } from '../lib/molecular-orbitals/CubParser'
import type { MoldenData } from '../lib/molecular-orbitals/MoldenParser'
import { MoldenParser } from '../lib/molecular-orbitals/MoldenParser'
import { getHomoIndex, getLumoIndex, type MolecularOrbitalState } from '../lib/molecular-orbitals/state'
import {
  getActiveLocalDirectoryBinding,
  listLocalDirectory,
  normalizeLocalDirectoryAccessError,
  resolveLocalFile,
  resolveLocalSubdirectory,
  type LocalDirectoryBinding,
} from '../host/localDirectoryBinding'
import {
  assertAgentMayMutateWorkspace,
  assertAgentMayMutateWorkspaceNow,
  useAgentOperationReview,
} from '../orchestration/agentOperationReviewStore'
import { createCrystalStore } from '../orchestration/crystalStore'
import {
  captureViewportManagerTransaction,
  DEFAULT_COLUMN_SPLIT,
  restoreViewportManagerTransaction,
  useViewportManager,
  type CrystalSlot,
  type ViewportSlot,
  type ViewportManagerTransactionSnapshot,
} from '../orchestration/viewportManager'
import {
  installCubDataIntoStore,
  installMoldenDataIntoStore,
  ZATOM_VOLUMETRIC_FILE_MAX_BYTES,
  type UnifiedImportStore,
} from '../services/unified-file-import'
import type {
  ValidationCheck,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomToolResult,
  ZatomWorkspaceIdentity,
} from './contracts'
import { objectSchema, toolError } from './tool-helpers'

const TOOL_NAME = 'assets_mount_visualization_bundle'
const TARGET_IDS = ['vp-1', 'vp-2', 'vp-3', 'vp-4'] as const
const ROLE_NAMES = ['density', 'esp', 'homo', 'lumo', 'orbitals'] as const
const PRESENTATIONS = ['bundle', 'density', 'density-esp'] as const
const MAX_FILE_BYTES = ZATOM_VOLUMETRIC_FILE_MAX_BYTES
const MAX_TOTAL_BYTES = 96 * 1024 * 1024
const POSITION_TOLERANCE_A = 1e-3
const GRID_TOLERANCE_A = 1e-6

type BundleRole = typeof ROLE_NAMES[number]
export type VisualizationPresentation = typeof PRESENTATIONS[number]
type BundleStore = UnifiedImportStore
type BundleState = ReturnType<BundleStore['getState']>

interface ViewerIdentityReaders {
  readStore(store: BundleStore, viewportId: string): ZatomWorkspaceIdentity
}

/**
 * Load browser identity access only when the tool executes so the static tool
 * registry remains independent of React viewport state.
 */
async function loadViewerIdentityReaders(): Promise<ViewerIdentityReaders> {
  const viewer = await import('./viewer-context')
  return {
    readStore: (store, viewportId) => viewer.readViewportWorkspaceIdentityForId(store, viewportId),
  }
}

export interface VisualizationBundleInput {
  directoryPath?: string
  roles?: Partial<Record<BundleRole, string>>
  /**
   * bundle keeps the original four-pane workflow. The two single-pane modes
   * are deliberately explicit: density never attaches a discovered ESP file,
   * while density-esp requires and attaches one.
   */
  presentation?: VisualizationPresentation
  applyToWorkspace?: boolean
}

export interface VisualizationBundleAssignment {
  slotId: string
  label: 'Density' | 'Density + ESP' | 'HOMO' | 'LUMO'
  surfaceSource: string
  colorFieldSource?: string
  orbitalIndex?: number
}

export interface VisualizationBundlePlan {
  root: string
  directoryPath: string
  ready: boolean
  presentation: VisualizationPresentation
  layout: '1x1' | '2x2'
  roles: Partial<Record<BundleRole, string>>
  assignments: VisualizationBundleAssignment[]
  ignoredFiles: string[]
}

interface ResolvedBundle {
  plan: VisualizationBundlePlan
  checks: ValidationCheck[]
  cube: Partial<Record<'density' | 'esp' | 'homo' | 'lumo', CubData>>
  molden?: MoldenData
  homoIndex?: number
  lumoIndex?: number
}

interface PreparedPane {
  slotId: typeof TARGET_IDS[number]
  label: VisualizationBundleAssignment['label']
  store: BundleStore
}

interface PreparedExpectation {
  slotId: typeof TARGET_IDS[number]
  store: BundleStore
  identity: ZatomWorkspaceIdentity
  surface: MolecularOrbitalState
  plane: BundleState['constructedPlane']
}

interface ReplacedSlotExpectation {
  slotId: typeof TARGET_IDS[number]
  slot: ViewportSlot
  identity?: ZatomWorkspaceIdentity
  surface?: MolecularOrbitalState
  plane?: BundleState['constructedPlane']
}

class VisualizationBundleError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'VisualizationBundleError'
    this.code = code
  }
}

const rolePathSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 1024,
  description: 'File path relative to the bound folder.',
}

const manifest: ZatomToolManifest = {
  name: TOOL_NAME,
  title: 'Mount a local quantum visualization',
  version: '1.1.0',
  description: 'Plan or atomically mount quantum-chemistry visualization files from the folder the user already bound. presentation=bundle keeps the four-pane Density / Density+ESP / HOMO / LUMO workflow. presentation=density mounts only the Density cube in one pane and never attaches ESP implicitly. presentation=density-esp mounts Density colored by the required ESP cube in one pane. With directoryPath only, the tool scans that folder level and recognizes canonical CUBE/Molden names; explicit roles override discovery. The default applyToWorkspace=false validates without changing the workspace; true opens one Keep/Revert review.',
  inputSchema: objectSchema({
    directoryPath: {
      type: 'string',
      maxLength: 1024,
      description: 'One folder level, relative to the bound folder, to scan automatically. Empty or omitted means the bound-folder root.',
    },
    roles: objectSchema(Object.fromEntries(ROLE_NAMES.map((role) => [role, rolePathSchema]))),
    presentation: {
      type: 'string',
      enum: [...PRESENTATIONS],
      default: 'bundle',
      description: 'bundle mounts four panes; density mounts only the Density surface; density-esp mounts one Density surface explicitly colored by ESP.',
    },
    applyToWorkspace: {
      type: 'boolean',
      default: false,
      description: 'False returns the resolved plan and checks without changing the viewport. True atomically mounts the selected presentation.',
    },
  }),
  // Like viewport_mount_structures: this is a reversible workspace
  // presentation, not an unreviewed direct structure edit.
  effects: { structure: 'none', workspace: 'read', visual: 'write' },
  tags: ['assets', 'local-folder', 'cube', 'molden', 'visualization', 'bundle'],
}

function requestedPresentation(input: VisualizationBundleInput): VisualizationPresentation {
  const value = input.presentation ?? 'bundle'
  if ((PRESENTATIONS as readonly string[]).includes(value)) return value
  throw new VisualizationBundleError(
    'invalid_presentation',
    `presentation must be one of ${PRESENTATIONS.join(', ')}`,
  )
}

function rolesForPresentation(presentation: VisualizationPresentation): readonly BundleRole[] {
  if (presentation === 'density') return ['density']
  if (presentation === 'density-esp') return ['density', 'esp']
  return ROLE_NAMES
}

function targetIdsForPresentation(presentation: VisualizationPresentation): readonly typeof TARGET_IDS[number][] {
  return presentation === 'bundle' ? TARGET_IDS : ['vp-1']
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Visualization bundle mount was cancelled')
}

/** Let paint/input run between independent synchronous scientific parsers. */
const yieldToMainThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function requireBinding(): LocalDirectoryBinding {
  const binding = getActiveLocalDirectoryBinding()
  if (binding) return binding
  throw new VisualizationBundleError(
    'no_bound_directory',
    'No local folder is bound. Ask the user to open Assets > Folder and bind it once; browser folder permission requires a user gesture.',
  )
}

function joinedPath(directoryPath: string, name: string): string {
  return directoryPath ? `${directoryPath.replace(/\/+$/, '')}/${name}` : name
}

function cubeName(name: string): boolean {
  return /\.(?:cub|cube)$/i.test(name)
}

/** Conservative role recognition: unknown orbital cubes stay ignored rather than being guessed. */
export function inferVisualizationBundleRole(name: string, header = ''): BundleRole | null {
  const lower = `${name}\n${header}`.toLowerCase()
  if (/\.(?:molden|mld)$/i.test(name)) return 'orbitals'
  if (!cubeName(name)) return null
  if (/electrostatic[\s._-]*potential|\b(?:esp|mep|potential)\b/.test(lower)) return 'esp'
  if (/lumo/.test(lower) && !/nto/.test(lower)) return 'lumo'
  if (/homo/.test(lower) && !/nto/.test(lower)) return 'homo'
  if (/electron[\s._-]*density|charge[\s._-]*density|total[\s._-]*density|\b(?:density|rho)\b/.test(lower)
    && !/spin|magnetization|difference|\bdiff\b/.test(lower)) return 'density'
  return null
}

function sameWorkspace(left: ZatomWorkspaceIdentity, right: ZatomWorkspaceIdentity): boolean {
  return left.viewportId === right.viewportId
    && left.revision === right.revision
    && left.structureFingerprint === right.structureFingerprint
    && left.trajectoryFingerprint === right.trajectoryFingerprint
}

function sameNumber(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance
}

function validateCube(role: string, data: CubData, checks: ValidationCheck[]): boolean {
  const dimensions = [data.voxels.x, data.voxels.y, data.voxels.z]
  const expectedValues = dimensions.reduce((product, value) => product * value, 1)
  const validDimensions = dimensions.every((value) => Number.isSafeInteger(value) && value > 1)
  const finiteAtoms = data.atoms.length > 0 && data.atoms.every((atom) => (
    Number.isSafeInteger(atom.atomicNumber)
    && atom.atomicNumber > 0
    && [atom.x, atom.y, atom.z].every(Number.isFinite)
  ))
  let finiteValues = data.volumeData.length === expectedValues
  for (let index = 0; finiteValues && index < data.volumeData.length; index += 1) {
    if (!Number.isFinite(data.volumeData[index])) finiteValues = false
  }
  const axisAligned = Math.abs(data.vectors.x.y) <= GRID_TOLERANCE_A
    && Math.abs(data.vectors.x.z) <= GRID_TOLERANCE_A
    && Math.abs(data.vectors.y.x) <= GRID_TOLERANCE_A
    && Math.abs(data.vectors.y.z) <= GRID_TOLERANCE_A
    && Math.abs(data.vectors.z.x) <= GRID_TOLERANCE_A
    && Math.abs(data.vectors.z.y) <= GRID_TOLERANCE_A
  const passed = validDimensions && finiteAtoms && finiteValues && axisAligned
  checks.push({
    id: `visualization_bundle.${role}.cube`,
    status: passed ? 'pass' : 'fail',
    message: passed
      ? `${role}: ${data.atoms.length} atoms on a ${dimensions.join('×')} finite, axis-aligned grid`
      : `${role}: CUBE needs atoms, finite values, dimensions > 1 and an axis-aligned grid supported by the renderer`,
    metrics: { atomCount: data.atoms.length, nx: dimensions[0], ny: dimensions[1], nz: dimensions[2] },
  })
  return passed
}

type SpatialAtom = { atomicNumber: number; x: number; y: number; z: number }

function compareAtoms(
  label: string,
  reference: readonly SpatialAtom[],
  candidate: readonly SpatialAtom[],
  checks: ValidationCheck[],
): boolean {
  let maxDisplacementA = 0
  let same = reference.length === candidate.length
  for (let index = 0; same && index < reference.length; index += 1) {
    const left = reference[index]
    const right = candidate[index]
    if (left.atomicNumber !== right.atomicNumber) {
      same = false
      break
    }
    const displacement = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
    maxDisplacementA = Math.max(maxDisplacementA, displacement)
    if (displacement > POSITION_TOLERANCE_A) same = false
  }
  checks.push({
    id: `visualization_bundle.${label}.atoms`,
    status: same ? 'pass' : 'fail',
    message: same
      ? `${label} uses the same ordered atoms as Density (max Δ ${maxDisplacementA.toExponential(2)} Å)`
      : `${label} atom order/elements/coordinates do not match Density within ${POSITION_TOLERANCE_A} Å`,
    metrics: { referenceAtoms: reference.length, candidateAtoms: candidate.length, maxDisplacementA },
  })
  return same
}

function compareDensityEspGrid(density: CubData, esp: CubData, checks: ValidationCheck[]): boolean {
  const scalarPairs: Array<[number, number]> = [
    [density.voxels.x, esp.voxels.x], [density.voxels.y, esp.voxels.y], [density.voxels.z, esp.voxels.z],
    [density.origin.x, esp.origin.x], [density.origin.y, esp.origin.y], [density.origin.z, esp.origin.z],
    [density.vectors.x.x, esp.vectors.x.x], [density.vectors.x.y, esp.vectors.x.y], [density.vectors.x.z, esp.vectors.x.z],
    [density.vectors.y.x, esp.vectors.y.x], [density.vectors.y.y, esp.vectors.y.y], [density.vectors.y.z, esp.vectors.y.z],
    [density.vectors.z.x, esp.vectors.z.x], [density.vectors.z.y, esp.vectors.z.y], [density.vectors.z.z, esp.vectors.z.z],
  ]
  const same = scalarPairs.every(([left, right], index) => (
    index < 3 ? left === right : sameNumber(left, right, GRID_TOLERANCE_A)
  ))
  checks.push({
    id: 'visualization_bundle.esp.grid_alignment',
    status: same ? 'pass' : 'fail',
    message: same
      ? 'Density and ESP share the same grid origin, dimensions and voxel vectors'
      : 'Density and ESP grids are not aligned; ESP coloring was blocked instead of sampling the wrong space',
  })
  return same
}

async function fileHeader(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile()
  return file.slice(0, 1024).text()
}

async function resolveBundleFiles(
  binding: LocalDirectoryBinding,
  input: VisualizationBundleInput,
): Promise<{
  paths: Partial<Record<BundleRole, string>>
  files: Map<string, File>
  ignoredFiles: string[]
  checks: ValidationCheck[]
}> {
  const presentation = requestedPresentation(input)
  const relevantRoles = new Set<BundleRole>(rolesForPresentation(presentation))
  const directoryPath = input.directoryPath?.trim() ?? ''
  const directory = directoryPath
    ? await resolveLocalSubdirectory(binding.handle, directoryPath)
    : binding.handle
  const listing = await listLocalDirectory(directory)
  const files = new Map<string, File>()
  const candidates = new Map<BundleRole, string[]>()
  const ignoredFiles: string[] = []

  await Promise.all(listing.files.map(async (entry) => {
    const path = joinedPath(directoryPath, entry.name)
    const header = cubeName(entry.name) ? await fileHeader(entry.handle) : ''
    const role = inferVisualizationBundleRole(entry.name, header)
    if (!role) {
      ignoredFiles.push(path)
      return
    }
    if (!relevantRoles.has(role)) {
      ignoredFiles.push(path)
      return
    }
    candidates.set(role, [...(candidates.get(role) ?? []), path])
    files.set(path, await entry.handle.getFile())
  }))

  const explicit = input.roles ?? {}
  const paths: Partial<Record<BundleRole, string>> = {}
  const checks: ValidationCheck[] = []
  for (const role of rolesForPresentation(presentation)) {
    const explicitPath = explicit[role]?.trim()
    if (explicitPath) {
      const handle = await resolveLocalFile(binding.handle, explicitPath)
      paths[role] = explicitPath
      if (!files.has(explicitPath)) files.set(explicitPath, await handle.getFile())
      checks.push({ id: `visualization_bundle.role.${role}`, status: 'pass', message: `${role}: explicit ${explicitPath}` })
      continue
    }
    const found = candidates.get(role) ?? []
    if (found.length === 1) {
      paths[role] = found[0]
      checks.push({ id: `visualization_bundle.role.${role}`, status: 'pass', message: `${role}: detected ${found[0]}` })
    } else if (found.length > 1) {
      checks.push({
        id: `visualization_bundle.role.${role}`,
        status: 'fail',
        message: `${role}: ${found.length} candidates (${found.join(', ')}); pass roles.${role} explicitly`,
        metrics: { candidateCount: found.length },
      })
    }
  }

  const duplicatePaths = new Map<string, BundleRole[]>()
  for (const role of rolesForPresentation(presentation)) {
    const path = paths[role]
    if (path) duplicatePaths.set(path, [...(duplicatePaths.get(path) ?? []), role])
  }
  for (const [path, roles] of duplicatePaths) {
    if (roles.length <= 1) continue
    checks.push({
      id: 'visualization_bundle.roles.distinct',
      status: 'fail',
      message: `${path} was assigned to ${roles.join(', ')}; scalar-field roles must use distinct files`,
    })
  }

  const required: Array<{ role: BundleRole; satisfied: boolean; fallback?: string }> = presentation === 'density'
    ? [{ role: 'density', satisfied: !!paths.density }]
    : presentation === 'density-esp'
      ? [
          { role: 'density', satisfied: !!paths.density },
          { role: 'esp', satisfied: !!paths.esp },
        ]
      : [
          { role: 'density', satisfied: !!paths.density },
          { role: 'esp', satisfied: !!paths.esp },
          { role: 'homo', satisfied: !!paths.homo || !!paths.orbitals, fallback: paths.orbitals },
          { role: 'lumo', satisfied: !!paths.lumo || !!paths.orbitals, fallback: paths.orbitals },
        ]
  for (const item of required) {
    if (!item.satisfied) {
      checks.push({
        id: `visualization_bundle.required.${item.role}`,
        status: 'fail',
        message: `${item.role} is required; provide roles.${item.role}${item.role === 'homo' || item.role === 'lumo' ? ' or roles.orbitals' : ''}`,
      })
    } else if (!paths[item.role] && item.fallback) {
      checks.push({
        id: `visualization_bundle.required.${item.role}`,
        status: 'pass',
        message: `${item.role} will be derived from ${item.fallback}`,
      })
    }
  }

  return { paths, files, ignoredFiles: ignoredFiles.sort(), checks }
}

async function parseResolvedBundle(
  binding: LocalDirectoryBinding,
  input: VisualizationBundleInput,
  signal?: AbortSignal,
): Promise<ResolvedBundle> {
  throwIfCancelled(signal)
  const presentation = requestedPresentation(input)
  const resolved = await resolveBundleFiles(binding, input)
  throwIfCancelled(signal)
  // An optional Molden file is irrelevant when explicit HOMO and LUMO CUBEs
  // already won role resolution. Do not make an unused 100 MB wavefunction
  // consume this operation's read budget or block the four valid CUBEs.
  const selectedPaths = [...new Set((presentation === 'density'
    ? [resolved.paths.density]
    : presentation === 'density-esp'
      ? [resolved.paths.density, resolved.paths.esp]
      : [
          resolved.paths.density,
          resolved.paths.esp,
          resolved.paths.homo ?? resolved.paths.orbitals,
          resolved.paths.lumo ?? resolved.paths.orbitals,
        ]
  ).filter((path): path is string => !!path))]
  let totalBytes = 0
  for (const path of selectedPaths) {
    const file = resolved.files.get(path)
    if (!file) throw new VisualizationBundleError('bundle_file_missing', `Could not resolve ${path} inside the bound folder`)
    if (file.size > MAX_FILE_BYTES) {
      throw new VisualizationBundleError('bundle_file_too_large', `${path} exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`)
    }
    totalBytes += file.size
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new VisualizationBundleError('bundle_too_large', `Selected files exceed the ${MAX_TOTAL_BYTES / 1024 / 1024} MB bundle limit`)
  }

  const cube: ResolvedBundle['cube'] = {}
  const cubeRoles = presentation === 'density'
    ? ['density'] as const
    : presentation === 'density-esp'
      ? ['density', 'esp'] as const
      : ['density', 'esp', 'homo', 'lumo'] as const
  for (const role of cubeRoles) {
    const path = resolved.paths[role]
    if (!path) continue
    try {
      await yieldToMainThread()
      throwIfCancelled(signal)
      const text = await resolved.files.get(path)!.text()
      throwIfCancelled(signal)
      cube[role] = new CubParser().parse(text)
      validateCube(role, cube[role]!, resolved.checks)
    } catch (error) {
      resolved.checks.push({
        id: `visualization_bundle.${role}.parse`,
        status: 'fail',
        message: `${role}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  let molden: MoldenData | undefined
  let homoIndex: number | undefined
  let lumoIndex: number | undefined
  const orbitalsPath = resolved.paths.orbitals
  const needsMolden = presentation === 'bundle'
    && !!orbitalsPath
    && (!resolved.paths.homo || !resolved.paths.lumo)
  if (needsMolden) {
    try {
      await yieldToMainThread()
      throwIfCancelled(signal)
      const text = await resolved.files.get(orbitalsPath)!.text()
      throwIfCancelled(signal)
      molden = new MoldenParser(text).parse()
      homoIndex = getHomoIndex(molden)
      lumoIndex = getLumoIndex(molden)
      const valid = molden.atoms.length > 0 && molden.gtos.length > 0 && homoIndex >= 0 && lumoIndex >= 0
      resolved.checks.push({
        id: 'visualization_bundle.orbitals.molden',
        status: valid ? 'pass' : 'fail',
        message: valid
          ? `Molden provides ${molden.orbitals.length} orbitals (HOMO ${homoIndex + 1}, LUMO ${lumoIndex + 1})`
          : 'Molden must contain atoms, basis functions, and identifiable occupied/unoccupied orbitals',
        metrics: { atoms: molden.atoms.length, orbitals: molden.orbitals.length, basisFunctions: molden.gtos.length },
      })
    } catch (error) {
      resolved.checks.push({
        id: 'visualization_bundle.orbitals.parse',
        status: 'fail',
        message: `orbitals: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  } else if (presentation === 'bundle' && orbitalsPath) {
    resolved.checks.push({
      id: 'visualization_bundle.orbitals.molden',
      status: 'skipped',
      message: `${orbitalsPath} was not parsed because explicit HOMO and LUMO CUBEs take precedence`,
    })
  }

  const density = cube.density
  if (density) {
    if (cube.esp) {
      compareAtoms('ESP', density.atoms, cube.esp.atoms, resolved.checks)
      compareDensityEspGrid(density, cube.esp, resolved.checks)
    }
    if (cube.homo) compareAtoms('HOMO', density.atoms, cube.homo.atoms, resolved.checks)
    if (cube.lumo) compareAtoms('LUMO', density.atoms, cube.lumo.atoms, resolved.checks)
    if (molden && (!cube.homo || !cube.lumo)) {
      compareAtoms('Molden', density.atoms, molden.atoms, resolved.checks)
    }
  }

  const roles = resolved.paths
  const assignments: VisualizationBundleAssignment[] = []
  if (presentation === 'density' && roles.density) {
    assignments.push({ slotId: 'vp-1', label: 'Density', surfaceSource: roles.density })
  } else if (presentation === 'density-esp' && roles.density && roles.esp) {
    assignments.push({ slotId: 'vp-1', label: 'Density + ESP', surfaceSource: roles.density, colorFieldSource: roles.esp })
  } else if (presentation === 'bundle' && roles.density) {
    assignments.push({ slotId: 'vp-1', label: 'Density', surfaceSource: roles.density })
    if (roles.esp) assignments.push({ slotId: 'vp-2', label: 'Density + ESP', surfaceSource: roles.density, colorFieldSource: roles.esp })
    const homoSource = roles.homo ?? roles.orbitals
    const lumoSource = roles.lumo ?? roles.orbitals
    if (homoSource) assignments.push({ slotId: 'vp-3', label: 'HOMO', surfaceSource: homoSource, ...(!roles.homo && homoIndex !== undefined ? { orbitalIndex: homoIndex } : {}) })
    if (lumoSource) assignments.push({ slotId: 'vp-4', label: 'LUMO', surfaceSource: lumoSource, ...(!roles.lumo && lumoIndex !== undefined ? { orbitalIndex: lumoIndex } : {}) })
  }
  const expectedAssignments = presentation === 'bundle' ? 4 : 1
  const ready = assignments.length === expectedAssignments && !resolved.checks.some((check) => check.status === 'fail')
  const plan: VisualizationBundlePlan = {
    root: binding.name,
    directoryPath: input.directoryPath?.trim() ?? '',
    ready,
    presentation,
    layout: presentation === 'bundle' ? '2x2' : '1x1',
    roles: { ...roles },
    assignments,
    ignoredFiles: resolved.ignoredFiles,
  }
  return { plan, checks: resolved.checks, cube, molden, homoIndex, lumoIndex }
}

function preparePanes(bundle: ResolvedBundle): PreparedPane[] {
  const { cube, plan, molden, homoIndex, lumoIndex } = bundle
  if (!plan.ready || !cube.density) {
    throw new VisualizationBundleError('bundle_not_ready', 'The visualization bundle is incomplete or failed validation')
  }
  const role = plan.roles
  const densityStore = createCrystalStore()
  installCubDataIntoStore(cube.density, role.density!, densityStore)

  if (plan.presentation === 'density') {
    return [{ slotId: 'vp-1', label: 'Density', store: densityStore }]
  }

  if (!cube.esp || !role.esp) {
    throw new VisualizationBundleError('bundle_not_ready', 'The selected visualization requires an aligned ESP cube')
  }

  const espStore = createCrystalStore()
  installCubDataIntoStore(cube.density, role.density!, espStore)
  espStore.getState().setSurfaceColorField(cube.esp, role.esp!)
  espStore.getState().setSurfaceColormap('rwb')
  espStore.getState().setSurfaceShowExtrema(true)

  if (plan.presentation === 'density-esp') {
    return [{ slotId: 'vp-1', label: 'Density + ESP', store: espStore }]
  }

  const orbitalStore = (
    cubeData: CubData | undefined,
    cubePath: string | undefined,
    index: number | undefined,
  ): BundleStore => {
    const store = createCrystalStore()
    if (cubeData && cubePath) {
      installCubDataIntoStore(cubeData, cubePath, store)
      return store
    }
    if (!molden || !role.orbitals || index === undefined || index < 0) {
      throw new VisualizationBundleError('bundle_orbital_missing', 'HOMO/LUMO source could not be prepared')
    }
    installMoldenDataIntoStore(molden, role.orbitals, store)
    store.getState().setMolecularOrbitalSelectedOrbital(index)
    return store
  }

  return [
    { slotId: 'vp-1', label: 'Density', store: densityStore },
    { slotId: 'vp-2', label: 'Density + ESP', store: espStore },
    { slotId: 'vp-3', label: 'HOMO', store: orbitalStore(cube.homo, role.homo, homoIndex) },
    { slotId: 'vp-4', label: 'LUMO', store: orbitalStore(cube.lumo, role.lumo, lumoIndex) },
  ]
}

function surfaceStillMatches(current: MolecularOrbitalState, expected: MolecularOrbitalState): boolean {
  return current.sourceType === expected.sourceType
    && current.sourceName === expected.sourceName
    && current.cubData === expected.cubData
    && current.moldenData === expected.moldenData
    && current.selectedOrbitalIndex === expected.selectedOrbitalIndex
    && current.isoValue === expected.isoValue
    && current.resolution === expected.resolution
    && current.opacity === expected.opacity
    && current.positiveColor === expected.positiveColor
    && current.negativeColor === expected.negativeColor
    && current.visible === expected.visible
    && current.colorField?.cubData === expected.colorField?.cubData
    && current.colorField?.sourceName === expected.colorField?.sourceName
    && current.colorField?.colormap === expected.colorField?.colormap
    && JSON.stringify(current.colorField?.range ?? null) === JSON.stringify(expected.colorField?.range ?? null)
    && current.colorField?.showExtrema === expected.colorField?.showExtrema
    && JSON.stringify(current.fieldSlice) === JSON.stringify(expected.fieldSlice)
}

function planeStillMatches(
  current: BundleState['constructedPlane'],
  expected: BundleState['constructedPlane'],
): boolean {
  return JSON.stringify(current) === JSON.stringify(expected)
}

function managerStillMatches(snapshot: ViewportManagerTransactionSnapshot): boolean {
  const current = useViewportManager.getState()
  return current.layout === snapshot.layout
    && current.activeViewportId === snapshot.activeViewportId
    && current.viewports === snapshot.viewports
    && current.columnSplit === snapshot.columnSplit
    && current.maximizedViewportId === snapshot.maximizedViewportId
    && JSON.stringify(current.freeLayout) === JSON.stringify(snapshot.freeLayout)
}

function captureReplacedSlotExpectations(
  snapshot: ViewportManagerTransactionSnapshot,
  readIdentity: ViewerIdentityReaders['readStore'],
  targetIds: readonly typeof TARGET_IDS[number][],
): ReplacedSlotExpectation[] {
  const expectations: ReplacedSlotExpectation[] = []
  for (const slotId of targetIds) {
    const slot = snapshot.viewports[slotId]
    if (!slot) continue
    if (slot.kind !== 'crystal') {
      expectations.push({ slotId, slot })
      continue
    }
    const store = slot.storeInstance as unknown as BundleStore
    expectations.push({
      slotId,
      slot,
      identity: readIdentity(store, slotId),
      surface: store.getState().molecularOrbital,
      plane: store.getState().constructedPlane,
    })
  }
  return expectations
}

function replacedSlotsStillMatch(
  expectations: ReplacedSlotExpectation[],
  readIdentity: ViewerIdentityReaders['readStore'],
): boolean {
  const current = useViewportManager.getState().viewports
  for (const expectation of expectations) {
    const slot = current[expectation.slotId]
    if (slot !== expectation.slot) return false
    if (slot.kind !== 'crystal') continue
    const store = slot.storeInstance as unknown as BundleStore
    if (!expectation.identity || !sameWorkspace(readIdentity(store, expectation.slotId), expectation.identity)) return false
    if (!expectation.surface || !surfaceStillMatches(store.getState().molecularOrbital, expectation.surface)) return false
    if (!planeStillMatches(store.getState().constructedPlane, expectation.plane ?? null)) return false
  }
  return true
}

function visualizationStillMatches(
  expectations: PreparedExpectation[],
  readIdentity: ViewerIdentityReaders['readStore'],
): boolean {
  const current = useViewportManager.getState()
  // Active pane, split ratio, camera and maximization are inspection choices:
  // the user must be able to examine the mounted presentation and still press
  // Revert. Only changed/replaced pane contents or a different pane set block
  // restoring the pre-bundle workspace.
  const expectedIds = expectations.map((expectation) => expectation.slotId).sort()
  if (JSON.stringify(Object.keys(current.viewports).sort()) !== JSON.stringify(expectedIds)) return false
  for (const expectation of expectations) {
    const slot = current.viewports[expectation.slotId]
    if (!slot || slot.kind !== 'crystal'
      || (slot.storeInstance as unknown) !== (expectation.store as unknown)) return false
    if (!sameWorkspace(readIdentity(expectation.store, expectation.slotId), expectation.identity)) return false
    if (!surfaceStillMatches(expectation.store.getState().molecularOrbital, expectation.surface)) return false
    if (!planeStillMatches(expectation.store.getState().constructedPlane, expectation.plane)) return false
  }
  return true
}

function buildManagerSnapshot(
  before: ViewportManagerTransactionSnapshot,
  panes: PreparedPane[],
): ViewportManagerTransactionSnapshot {
  const viewports: Record<string, CrystalSlot> = {}
  for (const pane of panes) {
    viewports[pane.slotId] = {
      id: pane.slotId,
      kind: 'crystal',
      label: pane.label,
      structureName: pane.label,
      storeInstance: pane.store as unknown as CrystalSlot['storeInstance'],
    }
  }
  const paneIds = new Set(panes.map((pane) => pane.slotId))
  const detached = new Map(before.detached)
  for (const [id, slot] of Object.entries(before.viewports)) {
    if (!paneIds.has(id as typeof TARGET_IDS[number])) detached.set(id, slot)
  }
  for (const id of paneIds) detached.delete(id)
  return {
    layout: panes.length === 1 ? '1x1' : '2x2',
    activeViewportId: 'vp-1',
    viewports,
    columnSplit: DEFAULT_COLUMN_SPLIT,
    maximizedViewportId: null,
    freeLayout: null,
    detached: [...detached.entries()],
  }
}

function presentationCopy(plan: VisualizationBundlePlan): {
  label: string
  reviewSummary: string
  planSummary: string
  mountedSummary: string
} {
  if (plan.presentation === 'density') {
    return {
      label: 'Density',
      reviewSummary: 'Mounted one electron-density view in a 1×1 layout',
      planSummary: 'Ready: Density will mount alone in 1×1; discovered ESP/orbital files will not be attached.',
      mountedSummary: 'Mounted Density atomically in 1×1; ESP was not attached and one Keep/Revert review is waiting.',
    }
  }
  if (plan.presentation === 'density-esp') {
    return {
      label: 'Density + ESP',
      reviewSummary: 'Mounted one electron-density view colored by aligned ESP in a 1×1 layout',
      planSummary: 'Ready: Density explicitly colored by ESP will mount in 1×1.',
      mountedSummary: 'Mounted Density + ESP atomically in 1×1; one Keep/Revert review is waiting.',
    }
  }
  return {
    label: 'Density / ESP / HOMO / LUMO',
    reviewSummary: 'Mounted four aligned quantum-chemistry views in a 2×2 layout',
    planSummary: 'Ready: Density, density-colored-by-ESP, HOMO and LUMO will mount together in 2×2.',
    mountedSummary: 'Mounted Density, Density + ESP, HOMO and LUMO atomically in 2×2; one Keep/Revert review is waiting.',
  }
}

async function mountPreparedBundle(
  bundle: ResolvedBundle,
  context: ZatomToolContext,
  beforeManager: ViewportManagerTransactionSnapshot,
  beforeSlots: ReplacedSlotExpectation[],
  identities: ViewerIdentityReaders,
): Promise<void> {
  const expectedWorkspace = context.expectedWorkspace
  if (!expectedWorkspace) {
    throw new VisualizationBundleError(
      'expected_workspace_required',
      'Applying the bundle requires expectedWorkspace from viewer_observe so user changes during file parsing fail closed.',
    )
  }
  await assertAgentMayMutateWorkspace('mount the visualization bundle', { signal: context.signal })
  throwIfCancelled(context.signal)
  if (!managerStillMatches(beforeManager) || !replacedSlotsStillMatch(beforeSlots, identities.readStore)) {
    throw new VisualizationBundleError('workspace_conflict', 'The viewport layout or active pane changed while the bundle was being prepared; re-observe and retry.')
  }
  const activeManager = useViewportManager.getState()
  const activeSlot = activeManager.viewports[activeManager.activeViewportId]
  if (!activeSlot || activeSlot.kind !== 'crystal') {
    throw new VisualizationBundleError('workspace_conflict', 'The active viewport is no longer a crystal pane; re-observe and retry.')
  }
  const actualWorkspace = identities.readStore(
    activeSlot.storeInstance as unknown as BundleStore,
    activeManager.activeViewportId,
  )
  if (!sameWorkspace(actualWorkspace, expectedWorkspace)) {
    throw new VisualizationBundleError('workspace_conflict', 'The active workspace changed while the bundle was being prepared; re-observe and retry.')
  }
  assertAgentMayMutateWorkspaceNow('mount the visualization bundle', { signal: context.signal })

  const panes = preparePanes(bundle)
  throwIfCancelled(context.signal)
  const nextManager = buildManagerSnapshot(beforeManager, panes)
  const copy = presentationCopy(bundle.plan)
  useAgentOperationReview.getState().beginAnimation({
    label: copy.label,
    viewportId: expectedWorkspace.viewportId,
  })
  try {
    restoreViewportManagerTransaction(nextManager)
    const expectations: PreparedExpectation[] = panes.map((pane) => ({
      slotId: pane.slotId,
      store: pane.store,
      identity: identities.readStore(pane.store, pane.slotId),
      surface: pane.store.getState().molecularOrbital,
      plane: pane.store.getState().constructedPlane,
    }))
    useAgentOperationReview.getState().openReview({
      label: copy.label,
      subject: {
        kind: 'workspace',
        summary: copy.reviewSummary,
        revert: () => {
          if (!visualizationStillMatches(expectations, identities.readStore)) {
            throw new Error('A mounted pane changed after this bundle was shown; newer user changes were kept.')
          }
          restoreViewportManagerTransaction(beforeManager)
        },
      },
    })
  } catch (error) {
    restoreViewportManagerTransaction(beforeManager)
    useAgentOperationReview.getState().clearAnimation()
    throw error
  }
}

export async function executeVisualizationBundle(
  input: VisualizationBundleInput,
  context: ZatomToolContext,
): Promise<ZatomToolResult<{
  status: 'plan' | 'mounted'
  plan: VisualizationBundlePlan
}>> {
  try {
    const binding = requireBinding()
    const presentation = requestedPresentation(input)
    const apply = input.applyToWorkspace === true
    const identities = apply ? await loadViewerIdentityReaders() : null
    // Bind the complete manager state before asynchronous file reads. The
    // exact same state must still be current at the commit boundary.
    const beforeManager = apply ? captureViewportManagerTransaction() : null
    const beforeSlots = beforeManager && identities
      ? captureReplacedSlotExpectations(
          beforeManager,
          identities.readStore,
          targetIdsForPresentation(presentation),
        )
      : []
    const resolved = await parseResolvedBundle(binding, input, context.signal)
    if (!resolved.plan.ready) {
      const message = 'Visualization bundle is not ready; resolve the failing role/alignment checks before mounting.'
      if (apply) {
        return {
          ok: false,
          tool: TOOL_NAME,
          summary: message,
          error: { code: 'bundle_not_ready', message },
          data: { status: 'plan', plan: resolved.plan },
          checks: resolved.checks,
        }
      }
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: message,
        data: { status: 'plan', plan: resolved.plan },
        checks: resolved.checks,
      }
    }
    const copy = presentationCopy(resolved.plan)
    if (!apply) {
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: `${copy.planSummary} Nothing was changed.`,
        data: { status: 'plan', plan: resolved.plan },
        checks: resolved.checks,
      }
    }
    await mountPreparedBundle(resolved, context, beforeManager!, beforeSlots, identities!)
    return {
      ok: true,
      tool: TOOL_NAME,
      summary: copy.mountedSummary,
      data: { status: 'mounted', plan: resolved.plan },
      checks: resolved.checks,
    }
  } catch (error) {
    return toolError(TOOL_NAME, normalizeLocalDirectoryAccessError(error))
  }
}

export const LOCAL_VISUALIZATION_BUNDLE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [{
  manifest,
  execute: async (input, context) => executeVisualizationBundle(input as VisualizationBundleInput, context),
}]
