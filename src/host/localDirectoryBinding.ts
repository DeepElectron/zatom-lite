/**
 * Binds a local directory as a read-only structure source in the browser.
 *
 * Chromium's File System Access API provides the durable path. Every browser
 * also gets a session-only directory-upload fallback: a user selects a folder
 * through `<input type=file webkitdirectory>`, and its FileList is projected as
 * an in-memory read-only FileSystemDirectoryHandle tree. Keeping both behind
 * one handle contract lets the panel and Agent tools browse identically.
 *
 * The handle survives a reload in IndexedDB (handles are structured-cloneable),
 * but the permission grant does not: after a restart the browser returns
 * `'prompt'` and only a user gesture can call `requestPermission`. So the
 * binding is remembered by name and reconnecting is an explicit user action —
 * there is no way to silently restore it, and pretending otherwise would show a
 * bound directory whose reads all fail.
 *
 * Directories are read one level at a time. A recursive scan would block on
 * large trees before showing anything, and it would read folders the user never
 * opens.
 */

import { classifyLocalStructureFile, type LocalStructureRoute } from '../services/local-structure-file'

const DB_NAME = 'zatom-modeler-local-directory'
const DB_VERSION = 1
const STORE_NAME = 'bindings'
/** Single binding for now; the key exists so adding named bindings stays a data change. */
const BINDING_KEY = 'active'
let activeBinding: LocalDirectoryBinding | null = null

interface BindingRecord {
  key: string
  handle: FileSystemDirectoryHandle
  name: string
  boundAt: number
}

export class LocalDirectoryAccessError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LocalDirectoryAccessError'
    this.code = code
  }
}

/** Translate browser filesystem failures into actionable Agent-facing errors. */
export function normalizeLocalDirectoryAccessError(error: unknown): unknown {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return new LocalDirectoryAccessError(
      'directory_permission_lost',
      `Read access to the selected folder was lost (${error.name}). Ask the user to reconnect it from Assets > Folder.`,
    )
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return new LocalDirectoryAccessError('path_not_found', 'That path does not exist inside the selected folder.')
  }
  return error
}

/** Durable handle support; requires Chromium's File System Access API. */
export function isPersistentLocalDirectoryBindingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Session fallback used by browsers that only expose a directory file input. */
export function isSessionLocalDirectoryBindingSupported(): boolean {
  return typeof document !== 'undefined' && typeof File !== 'undefined'
}

export function isLocalDirectoryBindingSupported(): boolean {
  return isPersistentLocalDirectoryBindingSupported() || isSessionLocalDirectoryBindingSupported()
}

function openBindingDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readBindingRecord(): Promise<BindingRecord | null> {
  const db = await openBindingDb()
  if (!db) return null
  return new Promise<BindingRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(BINDING_KEY)
    request.onsuccess = () => resolve((request.result as BindingRecord | undefined) ?? null)
    request.onerror = () => reject(request.error)
    tx.onerror = () => reject(tx.error)
  }).finally(() => db.close())
}

async function writeBindingRecord(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openBindingDb()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({
      key: BINDING_KEY,
      handle,
      name: handle.name,
      boundAt: Date.now(),
    } satisfies BindingRecord)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }).finally(() => db.close())
}

export async function clearLocalDirectoryBinding(): Promise<void> {
  // Session-upload bindings live only here; clear them even when IndexedDB is
  // absent. A native remembered handle, if any, is removed below as well.
  activeBinding = null
  const db = await openBindingDb()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(BINDING_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }).finally(() => db.close())
}

export interface LocalDirectoryBinding {
  handle: FileSystemDirectoryHandle
  name: string
  /** Native handles may be remembered; uploaded FileLists die with the page. */
  persistence?: 'persistent' | 'session'
  /** Known for a session FileList; native handles stay lazily enumerated. */
  supportedFileCount?: number
}

/** What the UI can know before any user gesture has happened. */
export type RememberedBindingState =
  /** Nothing stored, or the browser cannot bind directories at all. */
  | { status: 'none' }
  /** Stored and still granted — readable without another prompt. */
  | { status: 'granted'; binding: LocalDirectoryBinding }
  /** Stored but the grant lapsed; needs a click to call requestPermission. */
  | { status: 'needs-reconnect'; name: string }

export async function readRememberedBinding(): Promise<RememberedBindingState> {
  if (!isPersistentLocalDirectoryBindingSupported()) return { status: 'none' }
  const record = await readBindingRecord().catch(() => null)
  if (!record) return { status: 'none' }

  let permission: PermissionState
  try {
    permission = await record.handle.queryPermission({ mode: 'read' })
  } catch {
    return { status: 'needs-reconnect', name: record.name }
  }
  if (permission === 'granted') {
    return { status: 'granted', binding: { handle: record.handle, name: record.name, persistence: 'persistent' } }
  }
  // 'denied' is offered for reconnect too: the user can still re-grant from the
  // browser prompt, and the alternative is a dead entry with no way forward.
  return { status: 'needs-reconnect', name: record.name }
}

/** Opens the directory picker. Must be called from a user gesture. */
export async function bindLocalDirectory(): Promise<LocalDirectoryBinding> {
  if (!isPersistentLocalDirectoryBindingSupported()) {
    throw new Error('This browser cannot bind a local directory (File System Access API unavailable)')
  }
  const handle = await window.showDirectoryPicker({ id: 'zatom-structures', mode: 'read' })
  try {
    await writeBindingRecord(handle)
    return { handle, name: handle.name, persistence: 'persistent' }
  } catch {
    // The user already granted a valid handle. Private browsing or a blocked
    // IndexedDB must only remove cross-visit persistence, not make this click
    // look like a failed folder selection.
    return { handle, name: handle.name, persistence: 'session' }
  }
}

/**
 * Re-grants read access to the remembered directory. Must be called from a user
 * gesture, and returns null when the user dismisses the prompt.
 */
export async function reconnectLocalDirectory(): Promise<LocalDirectoryBinding | null> {
  const record = await readBindingRecord()
  if (!record) return null
  const permission = await record.handle.requestPermission({ mode: 'read' })
  if (permission !== 'granted') return null
  return { handle: record.handle, name: record.name, persistence: 'persistent' }
}

interface MemoryDirectoryNode {
  name: string
  directories: Map<string, MemoryDirectoryNode>
  files: Map<string, File>
}

function notFound(kind: 'file' | 'directory', name: string): DOMException {
  return new DOMException(`No ${kind} named ${name}`, 'NotFoundError')
}

function memoryFileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
  } as unknown as FileSystemFileHandle
}

function memoryDirectoryHandle(node: MemoryDirectoryNode): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: node.name,
    async *values(): AsyncGenerator<FileSystemHandle> {
      for (const directory of node.directories.values()) yield memoryDirectoryHandle(directory)
      for (const file of node.files.values()) yield memoryFileHandle(file)
    },
    async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
      const directory = node.directories.get(name)
      if (!directory) throw notFound('directory', name)
      return memoryDirectoryHandle(directory)
    },
    async getFileHandle(name: string): Promise<FileSystemFileHandle> {
      const file = node.files.get(name)
      if (!file) throw notFound('file', name)
      return memoryFileHandle(file)
    },
  }
  return handle as unknown as FileSystemDirectoryHandle
}

function uploadPath(file: File): string[] {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim()
  const raw = (relative || file.name).replace(/\\/g, '/')
  const segments = raw.split('/').map((segment) => segment.trim()).filter(Boolean)
  return segments.some((segment) => segment === '.' || segment === '..') ? [] : segments
}

/**
 * Build a session-only folder binding from a directory-upload FileList.
 *
 * Empty/cancelled selections return null and never touch the active binding;
 * the caller replaces active state only after receiving a non-null result.
 * Unsupported files are omitted at construction, so every file reachable by
 * the resulting virtual handle is understood by the canonical classifier.
 */
export function createSessionLocalDirectoryBinding(
  selected: FileList | readonly File[],
): LocalDirectoryBinding | null {
  const files = Array.from(selected)
  if (files.length === 0) return null
  const paths = files.map((file) => ({ file, segments: uploadPath(file) })).filter((entry) => entry.segments.length > 0)
  if (paths.length === 0) return null

  const hasCommonFolder = paths.every((entry) => entry.segments.length > 1)
    && paths.every((entry) => entry.segments[0] === paths[0].segments[0])
  const rootName = hasCommonFolder ? paths[0].segments[0] : 'Selected folder'
  const root: MemoryDirectoryNode = { name: rootName, directories: new Map(), files: new Map() }
  let supportedFileCount = 0

  for (const { file, segments: originalSegments } of paths) {
    if (!classifyLocalStructureFile(file.name)) continue
    const segments = hasCommonFolder ? originalSegments.slice(1) : originalSegments
    const fileName = segments.pop()
    if (!fileName) continue
    let directory = root
    for (const segment of segments) {
      let child = directory.directories.get(segment)
      if (!child) {
        child = { name: segment, directories: new Map(), files: new Map() }
        directory.directories.set(segment, child)
      }
      directory = child
    }
    directory.files.set(fileName, file)
    supportedFileCount += 1
  }

  if (supportedFileCount === 0) return null
  return {
    handle: memoryDirectoryHandle(root),
    name: rootName,
    persistence: 'session',
    supportedFileCount,
  }
}

/**
 * The binding the UI currently holds, exposed so agent tools can reach it.
 *
 * Kept in a module variable rather than passed through the tool context: the
 * handle only becomes available after a user gesture inside the panel, and the
 * agent's tool context is built per call with no path back to that React state.
 *
 * Agent tools cannot establish a binding themselves — `showDirectoryPicker` and
 * `requestPermission` both require a user gesture — so when this is null the
 * only correct move is to tell the user to bind the folder.
 */
export function setActiveLocalDirectoryBinding(binding: LocalDirectoryBinding | null): void {
  activeBinding = binding
}

export function getActiveLocalDirectoryBinding(): LocalDirectoryBinding | null {
  return activeBinding
}

/** Splits a `a/b` path, tolerating leading, trailing and doubled separators. */
function pathSegments(path: string): string[] {
  return path.split('/').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
}

/**
 * Walks a relative path to a subdirectory of the bound root.
 *
 * `..` is rejected rather than resolved: the bound directory is the entire
 * granted scope, so a parent traversal can only ever be an attempt to read
 * outside it.
 */
export async function resolveLocalSubdirectory(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  let current = root
  for (const segment of pathSegments(path)) {
    if (segment === '..' || segment === '.') {
      throw new Error(`Path segment "${segment}" is not allowed; paths are relative to the bound folder`)
    }
    current = await current.getDirectoryHandle(segment)
  }
  return current
}

/** Resolves a file path relative to the bound root. */
export async function resolveLocalFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const segments = pathSegments(path)
  const fileName = segments.pop()
  if (!fileName) throw new Error('path must name a file inside the bound folder')
  const directory = await resolveLocalSubdirectory(root, segments.join('/'))
  return directory.getFileHandle(fileName)
}

export interface LocalDirectoryNode {
  name: string
  kind: 'directory'
  handle: FileSystemDirectoryHandle
}

export interface LocalStructureFileNode {
  name: string
  kind: 'file'
  handle: FileSystemFileHandle
  route: LocalStructureRoute
}

export interface LocalDirectoryListing {
  directories: LocalDirectoryNode[]
  files: LocalStructureFileNode[]
  /**
   * Files present but not structure files. Surfaced as a count so a folder full
   * of notes and logs does not read as empty, without listing what cannot be
   * mounted.
   */
  skippedFileCount: number
}

export async function listLocalDirectory(handle: FileSystemDirectoryHandle): Promise<LocalDirectoryListing> {
  const directories: LocalDirectoryNode[] = []
  const files: LocalStructureFileNode[] = []
  let skippedFileCount = 0

  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      directories.push({ name: entry.name, kind: 'directory', handle: entry })
      continue
    }
    const route = classifyLocalStructureFile(entry.name)
    if (!route) {
      skippedFileCount += 1
      continue
    }
    files.push({ name: entry.name, kind: 'file', handle: entry, route })
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  directories.sort(byName)
  files.sort(byName)
  return { directories, files, skippedFileCount }
}
