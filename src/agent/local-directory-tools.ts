/**
 * MCP tools that read the directory the user bound in the import panel.
 *
 * The binding itself is never established here. `showDirectoryPicker` and
 * `requestPermission` both require a user gesture, so an agent cannot grant
 * itself filesystem access; when no binding is active the only correct move is
 * to tell the user to bind the folder from the panel. These tools therefore
 * fail with an actionable message rather than returning an empty listing, which
 * would read as "the folder is empty" and send the agent down the wrong path.
 *
 * Scope is the bound directory. Paths are relative to it and `..` is rejected,
 * so the granted directory is the entire reachable surface.
 */

import type { ZatomToolContext, ZatomToolDefinition, ZatomToolManifest, ZatomToolResult } from './contracts'
import {
  getActiveLocalDirectoryBinding,
  listLocalDirectory,
  LocalDirectoryAccessError,
  normalizeLocalDirectoryAccessError,
  resolveLocalFile,
  resolveLocalSubdirectory,
  type LocalDirectoryBinding,
} from '../host/localDirectoryBinding'
import {
  classifyLocalStructureFile,
  mountLocalStructureFile,
  type LocalStructureMountResult,
} from '../services/local-structure-file'
import { inspectUnifiedStructureFile, STREAM_TRAJECTORY_MIN_BYTES } from '../services/unified-file-import'
import { objectSchema, toolError } from './tool-helpers'

const pathProperty = {
  type: 'string',
  maxLength: 1024,
  description: 'Path relative to the bound folder, using "/" separators. Omit or pass "" for the folder root. Parent traversal ("..") is rejected.',
}

function localDirectoryToolError<T>(tool: string, error: unknown): ZatomToolResult<T> {
  return toolError(tool, normalizeLocalDirectoryAccessError(error))
}

function requireBinding(): LocalDirectoryBinding {
  const binding = getActiveLocalDirectoryBinding()
  if (!binding) {
    throw new LocalDirectoryAccessError(
      'no_bound_directory',
      'No local folder is bound. Ask the user to open Assets > Folder and bind one; browsers only grant directory access from a user gesture, so this cannot be done from a tool call.',
    )
  }
  return binding
}

const listManifest: ZatomToolManifest = {
  name: 'assets_list_local_directory',
  title: 'List the bound local folder',
  version: '1.0.0',
  description: 'List one level of the local folder the user bound in the import panel, returning subfolders and the structure files that can be mounted. Reads a single level so large trees stay responsive; call it again with a subfolder path to descend. Requires the user to have bound a folder first.',
  inputSchema: objectSchema({ path: pathProperty }),
  effects: { workspace: 'read', visual: 'none', structure: 'none' },
  tags: ['assets', 'local-folder'],
}

const mountManifest: ZatomToolManifest = {
  name: 'assets_mount_local_file',
  title: 'Mount a structure file from the bound folder',
  version: '1.0.0',
  description: 'Read one supported file from the bound local folder and parse it in isolation. Structure files (CIF/mmCIF, XYZ/extXYZ, MOL, PDB, VASP POSCAR/CONTCAR) may be applied through the reviewed workspace writer. CUBE (.cub/.cube) and Molden (.molden/.mld) are inspect-only here; use assets_mount_visualization_bundle with presentation=density, density-esp, or bundle for an atomic visualization workspace. Call assets_list_local_directory first for exact paths.',
  inputSchema: objectSchema(
    {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description: 'Path to the file relative to the bound folder, e.g. "relaxed/final.cif".',
      },
      // Mounting replaces whatever the user currently has in the viewport, so it
      // obeys the same candidate gate as every other structure-replacing tool:
      // parse and report by default, replace only when the agent says so.
      applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true' },
    },
    ['path'],
  ),
  // Mounting replaces what the viewport shows and appends an asset frame, so it
  // is a write on every axis the registry tracks. Marking it read-only would
  // tell an agent it is safe to retry.
  effects: { workspace: 'write', visual: 'write', structure: 'replace' },
  tags: ['assets', 'local-folder', 'import'],
}

async function runList(input: Record<string, unknown>): Promise<ZatomToolResult> {
  const binding = requireBinding()
  const path = typeof input.path === 'string' ? input.path : ''
  const directory = path ? await resolveLocalSubdirectory(binding.handle, path) : binding.handle
  const listing = await listLocalDirectory(directory)

  const here = path ? `${binding.name}/${path}` : binding.name
  return {
    ok: true,
    tool: listManifest.name,
    summary: `${here}: ${listing.directories.length} subfolder(s), ${listing.files.length} structure file(s)${listing.skippedFileCount ? `, ${listing.skippedFileCount} other file(s) skipped` : ''}`,
    data: {
      root: binding.name,
      path,
      directories: listing.directories.map((entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
      })),
      files: listing.files.map((entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        // Which parser handles it. Exposed because POSCAR files are recognised
        // by basename rather than suffix, so an agent seeing `POSCAR_relaxed`
        // can tell it was understood as a structure and not guessed at.
        parser: entry.route,
      })),
      skippedFileCount: listing.skippedFileCount,
    },
  }
}

async function runMount(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomToolResult> {
  const binding = requireBinding()
  const path = typeof input.path === 'string' ? input.path.trim() : ''
  if (!path) throw new LocalDirectoryAccessError('missing_path', 'path is required and must name a file inside the bound folder')

  // Resolve the path before checking host capabilities: a traversal attempt
  // must be rejected as a boundary violation even on hosts that cannot mount.
  const fileHandle = await resolveLocalFile(binding.handle, path)

  const apply = input.applyToWorkspace === true

  const file = await fileHandle.getFile()
  const route = classifyLocalStructureFile(file.name)
  const isVolumetric = /\.(?:cub|cube|molden|mld)$/i.test(file.name)
  const isStreamingFile = /\.spectraj$/i.test(file.name)
    || (/\.(?:xyz|extxyz)$/i.test(file.name) && file.size >= STREAM_TRAJECTORY_MIN_BYTES)
  const isTrajectoryFile = isStreamingFile || /xdatcar|\.(?:dump|lammpstrj|traj)$/i.test(file.name)
  if (isStreamingFile) {
    throw new LocalDirectoryAccessError(
      'streaming_file_requires_user_mount',
      'Streaming trajectories retain a live file-backed source. Open this file from Assets > Folder so the page owns its lifetime; the Agent will not create a detached worker-backed candidate.',
    )
  }
  if (apply && isVolumetric) {
    throw new LocalDirectoryAccessError(
      'visualization_bundle_required',
      'Agent application of an individual CUBE/Molden file is disabled because it would bypass the atomic visualization review. Use assets_mount_visualization_bundle with presentation=density, density-esp, or bundle, or let the user open one file from Assets > Folder.',
    )
  }
  if (apply && isTrajectoryFile) {
    throw new LocalDirectoryAccessError(
      'canonical_trajectory_import_required',
      'Agent application of a local trajectory must preserve every frame and its time semantics. Use structure_import_text for extXYZ/XDATCAR or an explicit Chemfiles provider instead of mounting it as one structure.',
    )
  }

  // Candidate inspection is safe without a writer. An explicit structure
  // application must use the host writer so late CAS, queueing, animation and
  // Keep/Revert are identical to every other Agent structure change.
  const writeStructure = context.writeStructure
  if (apply && !writeStructure) {
    throw new LocalDirectoryAccessError('write_unavailable', 'This host cannot write structures, so local files cannot be mounted')
  }
  let mounted: LocalStructureMountResult
  if (apply && route === 'unified') {
    const inspected = await inspectUnifiedStructureFile(file)
    if (!inspected.result.success) {
      throw new LocalDirectoryAccessError('structure_parse_failed', inspected.result.error)
    }
    const viewer = await import('./viewer-context')
    const structure = viewer.readViewportStructure(inspected.store)
    const trajectory = viewer.readViewportTrajectory(inspected.store)
    if (!structure) throw new LocalDirectoryAccessError('structure_parse_failed', `${file.name} did not produce a structure`)
    const importedState = inspected.store.getState()
    const importedTrajectoryKind = importedState.trajectoryFormatKind
    const importedFrameCount = importedState.trajectoryFrames?.length ?? 0
    const importedStreamingTrajectory = !!(
      importedState.compactTrajectory
      || importedState.compactTrajectorySource
      || importedState.compactSpeciesSource
    )
    if (!trajectory && (importedTrajectoryKind || importedFrameCount > 1 || importedStreamingTrajectory)) {
      const trajectoryLabel = importedTrajectoryKind
        ?? (importedFrameCount > 1 ? `${importedFrameCount} frames` : 'a streaming trajectory')
      throw new LocalDirectoryAccessError(
        'canonical_trajectory_import_required',
        `${file.name} parsed as ${trajectoryLabel}, but this path cannot preserve its complete canonical trajectory; no frame was mounted.`,
      )
    }
    if (trajectory) {
      if (!context.writeWorkspace) {
        throw new LocalDirectoryAccessError('write_unavailable', 'This host cannot atomically mount a structure and trajectory')
      }
      await context.writeWorkspace(structure, trajectory, context.expectedWorkspace, context.signal)
    } else {
      await writeStructure!(structure, context.expectedWorkspace, context.signal)
    }
    mounted = {
      ok: true,
      message: `Mounted ${file.name} (${structure.atoms.length} atoms) through the reviewed workspace writer`,
      atomCount: structure.atoms.length,
    }
  } else {
    mounted = await mountLocalStructureFile(
      file,
      async (structure) => writeStructure!(structure, context.expectedWorkspace, context.signal),
      { applyToWorkspace: apply },
    )
  }

  // A parse failure is reported as a failed tool call, not a successful call
  // carrying ok:false, so the agent's normal error handling applies.
  if (!mounted.ok) {
    throw new LocalDirectoryAccessError('structure_parse_failed', mounted.message)
  }

  const source = `${binding.name}/${path}`
  if (apply) {
    return {
      ok: true,
      tool: mountManifest.name,
      summary: mounted.message,
      data: { path, source, applied: true },
    }
  }
  return {
    ok: true,
    tool: mountManifest.name,
    summary: `${mounted.message} Call again with applyToWorkspace true to mount it.`,
    data: { path, source, applied: false, atomCount: mounted.atomCount ?? null },
  }
}

export const LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  {
    manifest: listManifest,
    async execute(input: Record<string, unknown>, _context: ZatomToolContext): Promise<ZatomToolResult> {
      try {
        return await runList(input)
      } catch (error) {
        return localDirectoryToolError(listManifest.name, error)
      }
    },
  },
  {
    manifest: mountManifest,
    async execute(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomToolResult> {
      try {
        return await runMount(input, context)
      } catch (error) {
        return localDirectoryToolError(mountManifest.name, error)
      }
    },
  },
]
