/**
 * Tests for local-folder binding: format classification, path scoping, and the
 * agent tools' behavior when no folder is bound.
 *
 * FSA handles are faked. The real API needs a user gesture, so the parts worth
 * protecting here are the pure decisions — which filenames count as structures,
 * that `..` cannot escape the granted folder, and that an unbound folder yields
 * an actionable error instead of an empty listing.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { classifyLocalStructureFile } from '../services/local-structure-file'
import {
  clearLocalDirectoryBinding,
  createSessionLocalDirectoryBinding,
  getActiveLocalDirectoryBinding,
  listLocalDirectory,
  resolveLocalFile,
  resolveLocalSubdirectory,
  setActiveLocalDirectoryBinding,
} from '../host/localDirectoryBinding'
import { LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS } from '../agent/local-directory-tools'
import type { ZatomToolContext } from '../agent/contracts'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'

type FakeEntry = FakeDir | FakeFile

interface FakeFile {
  kind: 'file'
  name: string
  content?: string
}

interface FakeDir {
  kind: 'directory'
  name: string
  children: FakeEntry[]
}

function dir(name: string, children: FakeEntry[] = []): FakeDir {
  return { kind: 'directory', name, children }
}

function file(name: string, content?: string): FakeFile {
  return { kind: 'file', name, ...(content === undefined ? {} : { content }) }
}

function uploadedFile(path: string, content = ''): File {
  const name = path.split('/').at(-1) ?? path
  const uploaded = new File([content], name)
  Object.defineProperty(uploaded, 'webkitRelativePath', { value: path })
  return uploaded
}

/** Builds a handle that implements only the surface the module actually calls. */
function handleFor(node: FakeDir): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: node.name,
    async *values() {
      for (const child of node.children) {
        yield child.kind === 'directory' ? handleFor(child) : ({ kind: 'file', name: child.name } as never)
      }
    },
    async getDirectoryHandle(name: string) {
      const found = node.children.find((child) => child.kind === 'directory' && child.name === name)
      if (!found) throw new DOMException(`no directory ${name}`, 'NotFoundError')
      return handleFor(found as FakeDir)
    },
    async getFileHandle(name: string) {
      const found = node.children.find((child) => child.kind === 'file' && child.name === name)
      if (!found) throw new DOMException(`no file ${name}`, 'NotFoundError')
      return {
        kind: 'file',
        name,
        async getFile() {
          return new File([(found as FakeFile).content ?? ''], name)
        },
      } as never
    },
  }
  return handle as unknown as FileSystemDirectoryHandle
}

const emptyContext = {} as ZatomToolContext

const listTool = LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS.find((t) => t.manifest.name === 'assets_list_local_directory')!
const mountTool = LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS.find((t) => t.manifest.name === 'assets_mount_local_file')!

const MINIMAL_CUBE = [
  'Candidate density',
  'isolated parser regression',
  '1 0.0 0.0 0.0',
  '2 1.0 0.0 0.0',
  '2 0.0 1.0 0.0',
  '2 0.0 0.0 1.0',
  '1 0.0 0.0 0.0 0.0',
  '0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8',
].join('\n')

afterEach(() => {
  setActiveLocalDirectoryBinding(null)
})

describe('classifyLocalStructureFile', () => {
  it('routes suffix-identified formats through the unified importer', () => {
    // Both common mmCIF suffixes must stay aligned with the unified importer.
    for (const name of [
      'a.cif', 'a.mcif', 'a.mmcif', 'a.xyz', 'a.extxyz', 'a.pdb', 'a.mol', 'A.CIF',
      'density.cub', 'density.cube', 'orbitals.molden', 'orbitals.mld',
    ]) {
      expect(classifyLocalStructureFile(name)).toBe('unified')
    }
  })

  it('routes VASP basenames through the POSCAR reader', () => {
    // POSCAR files carry no suffix, so basename matching is the only signal.
    for (const name of ['POSCAR', 'CONTCAR', 'POSCAR_relaxed', 'POSCAR.2', 'slab.vasp']) {
      expect(classifyLocalStructureFile(name)).toBe('poscar')
    }
  })

  it('keeps XDATCAR on the unified path even though it is a VASP file', () => {
    // XDATCAR is a trajectory the unified importer handles; the POSCAR reader
    // would only see the first frame.
    expect(classifyLocalStructureFile('XDATCAR')).toBe('unified')
  })

  it('rejects files that merely mention a structure name', () => {
    for (const name of ['notes.txt', 'run.log', 'make_POSCAR.py', 'README.md', 'cif-notes.docx']) {
      expect(classifyLocalStructureFile(name)).toBeNull()
    }
  })
})

describe('listLocalDirectory', () => {
  it('separates folders from structure files and counts the rest', async () => {
    const listing = await listLocalDirectory(
      handleFor(dir('root', [file('b.cif'), file('notes.txt'), dir('relaxed'), file('POSCAR'), file('run.log')])),
    )

    expect(listing.directories.map((d) => d.name)).toEqual(['relaxed'])
    // localeCompare, not codepoint order, so lowercase sorts before uppercase.
    expect(listing.files.map((f) => f.name)).toEqual(['b.cif', 'POSCAR'])
    // Surfaced as a count so a folder of notes does not read as empty.
    expect(listing.skippedFileCount).toBe(2)
  })

  it('sorts entries by name so listings are stable across calls', async () => {
    const listing = await listLocalDirectory(
      handleFor(dir('root', [file('c.xyz'), file('a.cif'), dir('z'), dir('m')])),
    )
    expect(listing.directories.map((d) => d.name)).toEqual(['m', 'z'])
    expect(listing.files.map((f) => f.name)).toEqual(['a.cif', 'c.xyz'])
  })
})

describe('session directory fallback', () => {
  it('projects webkitRelativePath files into a filtered multi-level tree', async () => {
    const binding = createSessionLocalDirectoryBinding([
      uploadedFile('calculation/optimized.xyz', '1\nfixture\nH 0 0 0\n'),
      uploadedFile('calculation/fields/electron-density.cube', MINIMAL_CUBE),
      uploadedFile('calculation/fields/orbitals/wavefunction.molden', '[Molden Format]'),
      uploadedFile('calculation/fields/notes.txt', 'not a model'),
    ])

    expect(binding).toMatchObject({
      name: 'calculation',
      persistence: 'session',
      supportedFileCount: 3,
    })
    const root = await listLocalDirectory(binding!.handle)
    expect(root.files.map((entry) => entry.name)).toEqual(['optimized.xyz'])
    expect(root.directories.map((entry) => entry.name)).toEqual(['fields'])

    const fields = await listLocalDirectory(await resolveLocalSubdirectory(binding!.handle, 'fields'))
    expect(fields.files.map((entry) => entry.name)).toEqual(['electron-density.cube'])
    expect(fields.directories.map((entry) => entry.name)).toEqual(['orbitals'])
    const wavefunction = await resolveLocalFile(binding!.handle, 'fields/orbitals/wavefunction.molden')
    expect((await wavefunction.getFile()).name).toBe('wavefunction.molden')
  })

  it('returns null for cancel/unsupported-only input and does not replace the active binding', () => {
    const existing = { handle: handleFor(dir('existing')), name: 'existing' }
    setActiveLocalDirectoryBinding(existing)
    expect(createSessionLocalDirectoryBinding([])).toBeNull()
    expect(createSessionLocalDirectoryBinding([uploadedFile('folder/notes.txt')])).toBeNull()
    expect(getActiveLocalDirectoryBinding()).toBe(existing)
  })

  it('explicit unbind clears a session binding even without IndexedDB', async () => {
    const binding = createSessionLocalDirectoryBinding([uploadedFile('folder/model.xyz', '0\nempty\n')])
    setActiveLocalDirectoryBinding(binding)
    await clearLocalDirectoryBinding()
    expect(getActiveLocalDirectoryBinding()).toBeNull()
  })
})

describe('path scoping', () => {
  const root = () => handleFor(dir('root', [dir('a', [dir('b', [file('final.cif')])])]))

  it('descends nested paths', async () => {
    const nested = await resolveLocalSubdirectory(root(), 'a/b')
    expect(nested.name).toBe('b')
  })

  it('rejects parent traversal instead of resolving it', async () => {
    // The bound folder is the whole granted scope, so `..` can only ever be an
    // attempt to read outside it.
    await expect(resolveLocalSubdirectory(root(), 'a/../..')).rejects.toThrow(/not allowed/)
    await expect(resolveLocalFile(root(), '../secret.cif')).rejects.toThrow(/not allowed/)
  })

  it('treats the empty path as the bound root', async () => {
    const resolved = await resolveLocalSubdirectory(root(), '')
    expect(resolved.name).toBe('root')
  })

  it('resolves a file inside a nested folder', async () => {
    const resolved = await resolveLocalFile(root(), 'a/b/final.cif')
    expect(resolved.name).toBe('final.cif')
  })
})

describe('agent tools without a bound folder', () => {
  it('reports an actionable error rather than an empty listing', async () => {
    const result = await listTool.execute({}, emptyContext)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('no_bound_directory')
    // The agent cannot grant itself access, so the message must point at the user.
    expect(result.summary).toMatch(/user/i)
  })

  it('refuses to mount', async () => {
    const result = await mountTool.execute({ path: 'a.cif' }, emptyContext)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('no_bound_directory')
  })
})

describe('agent tools with a bound folder', () => {
  it('lists entries with paths relative to the bound root', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('proj', [file('a.cif'), dir('relaxed'), file('todo.txt')])),
      name: 'proj',
    })

    const result = await listTool.execute({}, emptyContext)
    expect(result.ok).toBe(true)
    const data = result.data as {
      root: string
      directories: { path: string }[]
      files: { path: string; parser: string }[]
      skippedFileCount: number
    }
    expect(data.root).toBe('proj')
    expect(data.directories.map((d) => d.path)).toEqual(['relaxed'])
    expect(data.files).toEqual([{ name: 'a.cif', path: 'a.cif', parser: 'unified' }])
    expect(data.skippedFileCount).toBe(1)
  })

  it('prefixes nested listings with the requested path', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('proj', [dir('relaxed', [file('final.cif')])])),
      name: 'proj',
    })

    const result = await listTool.execute({ path: 'relaxed' }, emptyContext)
    const data = result.data as { files: { path: string }[] }
    // Paths must round-trip into assets_mount_local_file unchanged.
    expect(data.files.map((f) => f.path)).toEqual(['relaxed/final.cif'])
  })

  it('surfaces a missing path as path_not_found', async () => {
    setActiveLocalDirectoryBinding({ handle: handleFor(dir('proj', [])), name: 'proj' })

    const result = await listTool.execute({ path: 'nope' }, emptyContext)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('path_not_found')
  })

  it('rejects traversal through the tool boundary too', async () => {
    setActiveLocalDirectoryBinding({ handle: handleFor(dir('proj', [])), name: 'proj' })

    const result = await mountTool.execute({ path: '../outside.cif' }, emptyContext)
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/not allowed/)
  })

  it('requires a non-empty path to mount', async () => {
    setActiveLocalDirectoryBinding({ handle: handleFor(dir('proj', [])), name: 'proj' })

    const result = await mountTool.execute({ path: '   ' }, emptyContext)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('missing_path')
  })

  it('parses a CUBE candidate without changing the active viewport', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('project', [file('density.cube', MINIMAL_CUBE)])),
      name: 'project',
    })
    const activeStore = getActiveViewportStoreApi()
    const before = activeStore.getState()

    const result = await mountTool.execute({ path: 'density.cube' }, emptyContext)

    expect(result.ok).toBe(true)
    expect(result.summary).toMatch(/candidate/i)
    expect(result.data).toMatchObject({ path: 'density.cube', applied: false, atomCount: 1 })
    const after = activeStore.getState()
    // Reference equality catches both a structure replacement and a CUBE
    // surface installation; candidate parsing happens in a disposable store.
    expect(after.atoms).toBe(before.atoms)
    expect(after.molecularOrbital).toBe(before.molecularOrbital)
  })

  it('applies a unified structure only through the injected reviewed writer', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('project', [file('model.xyz', '1\nfixture\nHe 1 2 3\n')])),
      name: 'project',
    })
    let written: unknown = null
    const result = await mountTool.execute({ path: 'model.xyz', applyToWorkspace: true }, {
      writeStructure: async (structure) => { written = structure },
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ applied: true })
    expect(written).toMatchObject({ atoms: [{ element: 'He', position: [1, 2, 3] }] })
  })

  it('routes Agent CUBE/Molden application to the atomic visualization bundle', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('project', [file('density.cube', MINIMAL_CUBE)])),
      name: 'project',
    })
    let writes = 0
    const result = await mountTool.execute({ path: 'density.cube', applyToWorkspace: true }, {
      writeStructure: async () => { writes += 1 },
    })

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('visualization_bundle_required')
    expect(result.summary).toMatch(/assets_mount_visualization_bundle/)
    expect(writes).toBe(0)
  })

  it('refuses to collapse an Agent trajectory mount to one structure frame', async () => {
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('project', [file('XDATCAR', 'trajectory fixture')])),
      name: 'project',
    })
    let writes = 0
    const result = await mountTool.execute({ path: 'XDATCAR', applyToWorkspace: true }, {
      writeStructure: async () => { writes += 1 },
    })

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('canonical_trajectory_import_required')
    expect(result.summary).toMatch(/every frame|complete canonical trajectory/i)
    expect(writes).toBe(0)
  })

  it('detects a multi-frame XYZ even when the parser has no trajectory format label', async () => {
    const movie = '1\nframe 1\nH 0 0 0\n1\nframe 2\nH 1 0 0\n'
    setActiveLocalDirectoryBinding({
      handle: handleFor(dir('project', [file('movie.xyz', movie)])),
      name: 'project',
    })
    let writes = 0
    const result = await mountTool.execute({ path: 'movie.xyz', applyToWorkspace: true }, {
      writeStructure: async () => { writes += 1 },
    })

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('canonical_trajectory_import_required')
    expect(result.summary).toContain('2 frames')
    expect(writes).toBe(0)
  })

  it('does not create a detached worker-backed candidate for a streaming XYZ', async () => {
    const large = new File(['not read'], 'large.xyz')
    Object.defineProperty(large, 'size', { value: 30 * 1024 * 1024 })
    const handle = {
      kind: 'directory',
      name: 'project',
      async *values() { yield { kind: 'file', name: large.name, getFile: async () => large } },
      async getFileHandle() { return { kind: 'file', name: large.name, getFile: async () => large } },
    } as unknown as FileSystemDirectoryHandle
    setActiveLocalDirectoryBinding({ handle, name: 'project' })

    const result = await mountTool.execute({ path: 'large.xyz' }, emptyContext)

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('streaming_file_requires_user_mount')
    expect(result.summary).toMatch(/file-backed|Assets > Folder/i)
  })
})

describe('active binding registry', () => {
  it('publishes and clears the binding the tools read', () => {
    expect(getActiveLocalDirectoryBinding()).toBeNull()
    const binding = { handle: handleFor(dir('proj', [])), name: 'proj' }
    setActiveLocalDirectoryBinding(binding)
    expect(getActiveLocalDirectoryBinding()).toBe(binding)
    setActiveLocalDirectoryBinding(null)
    expect(getActiveLocalDirectoryBinding()).toBeNull()
  })
})

describe('tool manifests', () => {
  it('marks mounting as a write on every axis it touches', () => {
    // Mounting replaces the viewport structure and appends an asset frame.
    // Advertising it as read-only would tell an agent it is safe to retry.
    expect(mountTool.manifest.effects).toEqual({ workspace: 'write', visual: 'write', structure: 'replace' })
  })

  it('marks listing as read-only', () => {
    expect(listTool.manifest.effects).toEqual({ workspace: 'read', visual: 'none', structure: 'none' })
  })

  it('advertises CUBE and Molden instead of hiding supported scientific inputs', () => {
    expect(mountTool.manifest.description).toMatch(/CUBE.*\.cub.*\.cube/i)
    expect(mountTool.manifest.description).toMatch(/Molden.*\.molden.*\.mld/i)
  })
})
