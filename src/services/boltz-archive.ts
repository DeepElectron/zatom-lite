/**
 * Decode Boltz result archives from tar.gz members into PAE matrices stored as .npz files.
 *
 * PAE matrices exist only inside the archive; job JSON contains summary metrics only.
 *
 * Use the platform DecompressionStream without zlib, tar, or npy dependencies:
 * - tar.gz outer stream -> `gzip`
 * - npz member -> `deflate-raw` because ZIP deflate has no zlib header
 *
 * Verified byte-for-byte against a real prediction archive and sample_0_pae.npz:
 * - npz is a ZIP containing pae.npy with compression method 8 (deflate).
 * - NumPy streaming ZIPs put 0xFFFFFFFF size placeholders in local headers; real sizes must be
 *   read from the central directory found by scanning backward from EOCD.
 * - Observed dtype is `<f4` with shape `(ntokens, ntokens)`; PAE is asymmetric.
 */

async function decompress(bytes: Uint8Array, format: 'gzip' | 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream(format))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

export interface BoltzArchiveEntry {
  /** Path within the archive, for example prediction/sample_0_pae.npz. */
  name: string
  bytes: Uint8Array
}

const TAR_BLOCK = 512

/** Read an ASCII octal tar header field terminated by NUL or space. */
function readOctal(header: Uint8Array, offset: number, length: number): number {
  let text = ''
  for (let index = offset; index < offset + length; index += 1) {
    const code = header[index]
    if (code === 0 || code === 0x20) break
    text += String.fromCharCode(code)
  }
  return text ? Number.parseInt(text, 8) : 0
}

function readString(header: Uint8Array, offset: number, length: number): string {
  let text = ''
  for (let index = offset; index < offset + length; index += 1) {
    const code = header[index]
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return text
}

/** Read regular tar entries and skip directories and metadata blocks. */
export function readTar(bytes: Uint8Array): BoltzArchiveEntry[] {
  const entries: BoltzArchiveEntry[] = []
  let offset = 0
  while (offset + TAR_BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK)
    // A zero block marks the end; valid archives normally contain two consecutive blocks.
    if (header.every((byte) => byte === 0)) break

    const name = readString(header, 0, 100)
    const size = readOctal(header, 124, 12)
    const typeFlag = String.fromCharCode(header[156] || 0x30)
    // The ustar prefix field carries paths longer than 100 characters.
    const prefix = readString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name

    offset += TAR_BLOCK
    if (typeFlag === '0' || typeFlag === '\0') {
      entries.push({ name: fullName, bytes: bytes.subarray(offset, offset + size) })
    }
    // Tar data regions are padded to 512-byte boundaries.
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return entries
}

export async function readTarGz(bytes: Uint8Array): Promise<BoltzArchiveEntry[]> {
  return readTar(await decompress(bytes, 'gzip'))
}

export interface NpyArray {
  shape: number[]
  values: Float32Array
}

/**
 * Decode .npy headers and C-order floating-point arrays. Reject unsupported layouts and dtypes
 * explicitly instead of returning plausible but incorrect values.
 */
export function parseNpy(bytes: Uint8Array): NpyArray {
  const magic = String.fromCharCode(...bytes.subarray(0, 6))
  if (magic !== '\x93NUMPY') throw new Error('Not a NPY array')
  const major = bytes[6]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Version 1 uses a two-byte header length; version 2 and later use four bytes.
  const headerLength = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true)
  const headerStart = major >= 2 ? 12 : 10
  const header = String.fromCharCode(...bytes.subarray(headerStart, headerStart + headerLength))

  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1]
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1]
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1]
  if (!descr || shapeText === undefined) throw new Error('NPY header is missing descr/shape')
  if (fortran === 'True') throw new Error('Fortran-ordered NPY arrays are not supported')

  const shape = (shapeText ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number.parseInt(part, 10))

  const count = shape.reduce((product, dimension) => product * dimension, 1)
  const dataStart = headerStart + headerLength
  const values = new Float32Array(count)

  // Real prediction archives use `<f4`; also accept little-endian f8 and reject all other dtypes.
  if (descr === '<f4' || descr === '=f4' || descr === 'f4') {
    for (let index = 0; index < count; index += 1) {
      values[index] = view.getFloat32(dataStart + index * 4, true)
    }
  } else if (descr === '<f8' || descr === '=f8' || descr === 'f8') {
    for (let index = 0; index < count; index += 1) {
      values[index] = view.getFloat64(dataStart + index * 8, true)
    }
  } else {
    throw new Error(`Unsupported NPY dtype ${descr}`)
  }

  return { shape, values }
}

/**
 * Decode the .npz ZIP through its central directory because NumPy local headers contain
 * 0xFFFFFFFF size placeholders.
 */
export async function readNpz(bytes: Uint8Array): Promise<Record<string, NpyArray>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Scan backward for the EOCD signature; ZIP comments are limited to 64 KiB.
  let eocd = -1
  const scanFloor = Math.max(0, bytes.length - 66_000)
  for (let index = bytes.length - 22; index >= scanFloor; index -= 1) {
    if (view.getUint32(index, true) === 0x0605_4b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('NPZ is missing its ZIP end-of-central-directory record')

  const entryCount = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const arrays: Record<string, NpyArray> = {}

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (view.getUint32(pointer, true) !== 0x0201_4b50) {
      throw new Error('NPZ central directory entry has a bad signature')
    }
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = readString(bytes, pointer + 46, nameLength)

    // Use the local header only to locate data; its size fields are unreliable here.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const stored = bytes.subarray(dataStart, dataStart + compressedSize)

    let npy: Uint8Array
    if (method === 0) npy = stored
    else if (method === 8) npy = await decompress(stored, 'deflate-raw')
    else throw new Error(`NPZ member ${name} uses unsupported compression method ${method}`)

    arrays[name.replace(/\.npy$/, '')] = parseNpy(npy)
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return arrays
}

export interface BoltzPaeMatrix {
  /** Source filename used to associate the matrix with a prediction sample. */
  source: string
  tokenCount: number
  /** Row-major tokenCount x tokenCount matrix in angstroms. */
  values: Float32Array
  maxValue: number
}

export interface BoltzDecodedArchive {
  /** Structure filename to mmCIF text. */
  structures: Record<string, string>
  /** PAE matrices keyed by source filename. */
  pae: Record<string, BoltzPaeMatrix>
  /** Parsed metrics.json when present. */
  metrics: unknown
}

/**
 * Decode a tar.gz archive into directly consumable structures, PAE matrices, and metrics.
 */
export async function decodeBoltzArchive(bytes: Uint8Array): Promise<BoltzDecodedArchive> {
  const entries = await readTarGz(bytes)
  const decoder = new TextDecoder()
  const structures: Record<string, string> = {}
  const pae: Record<string, BoltzPaeMatrix> = {}
  let metrics: unknown = null

  for (const entry of entries) {
    const leaf = entry.name.split('/').pop() ?? entry.name
    if (leaf.endsWith('.cif')) {
      structures[leaf] = decoder.decode(entry.bytes)
    } else if (leaf.endsWith('.npz')) {
      const arrays = await readNpz(entry.bytes)
      for (const array of Object.values(arrays)) {
        if (array.shape.length !== 2 || array.shape[0] !== array.shape[1]) continue
        let maxValue = 0
        for (const value of array.values) if (value > maxValue) maxValue = value
        pae[leaf] = {
          source: leaf,
          tokenCount: array.shape[0],
          values: array.values,
          maxValue,
        }
      }
    } else if (leaf === 'metrics.json') {
      try {
        metrics = JSON.parse(decoder.decode(entry.bytes))
      } catch {
        metrics = null
      }
    }
  }

  return { structures, pae, metrics }
}
