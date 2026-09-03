import { downloadBlob } from '../lib/molecule/molecule-export'
import {
  captureViewport,
  clampViewportCaptureMaxDimension,
  hasRegisteredViewportCapture,
  VIEWPORT_CAPTURE_MAX_DIMENSION,
  type ViewportCaptureOptions,
  type ViewportCaptureResult,
} from './viewportCaptureRegistry'

export const VIEWPORT_PNG_MAX_DIMENSION = VIEWPORT_CAPTURE_MAX_DIMENSION

const PNG_MIME_TYPE = 'image/png'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const

export interface ViewportPngExportResult {
  fileName: string
  width: number
  height: number
  bytes: number
}

interface ViewportPngExportDependencies {
  capture: (
    options: ViewportCaptureOptions,
    registryKey: unknown,
  ) => Promise<ViewportCaptureResult | null>
  download: (fileName: string, blob: Blob) => void
  isRegistered: (registryKey: unknown) => boolean
}

const DEFAULT_DEPENDENCIES: ViewportPngExportDependencies = {
  capture: captureViewport,
  download: downloadBlob,
  isRegistered: hasRegisteredViewportCapture,
}

export interface ViewportPngExportOptions {
  /** Exact viewport store identity registered by ViewportCaptureRegistrar. */
  registryKey: unknown
  /** A structure-derived label or file name; unsafe path characters are removed. */
  sourceName?: string | null
  maxDim?: number
}

export function sanitizedViewportExportStem(sourceName?: string | null): string {
  const withoutExtension = (sourceName ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\.(?:pdb|cif|xyz|extxyz|mol|sdf|poscar|vasp)$/i, '')
  const safe = withoutExtension
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 96)
  return safe || 'zatom-structure'
}

export function viewportPngFileName(sourceName?: string | null): string {
  return `${sanitizedViewportExportStem(sourceName)}-view.png`
}

/**
 * Decode the browser canvas data URL without a network round-trip and reject a
 * mislabeled/corrupt payload before it is downloaded with a .png extension.
 */
export function viewportPngDataUrlToBlob(result: ViewportCaptureResult): Blob {
  if (result.mimeType.toLowerCase() !== PNG_MIME_TYPE) {
    throw new Error(`Viewport returned ${result.mimeType || 'an unknown format'} instead of PNG`)
  }
  if (!Number.isInteger(result.width) || result.width < 1
    || !Number.isInteger(result.height) || result.height < 1) {
    throw new Error('Viewport returned invalid image dimensions')
  }

  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(result.dataUrl)
  if (!match || match[1].toLowerCase() !== PNG_MIME_TYPE) {
    throw new Error('Viewport returned an invalid PNG data URL')
  }

  let binary: string
  try {
    binary = globalThis.atob(match[2].replace(/\s/g, ''))
  } catch {
    throw new Error('Viewport returned invalid base64 image data')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('Viewport returned a corrupt PNG image')
  }
  return new Blob([bytes], { type: PNG_MIME_TYPE })
}

export async function exportViewportPng(
  options: ViewportPngExportOptions,
  dependencyOverrides: Partial<ViewportPngExportDependencies> = {},
): Promise<ViewportPngExportResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  if (!dependencies.isRegistered(options.registryKey)) {
    throw new Error('The active viewport is not ready. Wait for it to render and try again.')
  }
  const maxDim = clampViewportCaptureMaxDimension(options.maxDim ?? VIEWPORT_PNG_MAX_DIMENSION)
  const capture = await dependencies.capture(
    { format: 'png', maxDim },
    options.registryKey,
  )
  if (!capture) {
    throw new Error('The active viewport is not ready. Wait for it to render and try again.')
  }

  const blob = viewportPngDataUrlToBlob(capture)
  const fileName = viewportPngFileName(options.sourceName)
  dependencies.download(fileName, blob)
  return {
    fileName,
    width: capture.width,
    height: capture.height,
    bytes: blob.size,
  }
}
