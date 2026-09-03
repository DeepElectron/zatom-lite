import { assertEqual, assertTrue } from '../../testing/assert'
import {
  exportViewportPng,
  sanitizedViewportExportStem,
  VIEWPORT_PNG_MAX_DIMENSION,
  viewportPngDataUrlToBlob,
  viewportPngFileName,
} from '../viewportPngExport'
import type { ViewportCaptureResult } from '../viewportCaptureRegistry'

// A valid 1×1 transparent PNG. The exact pixels are irrelevant; the PNG
// signature proves that a .png download cannot silently contain another type.
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function pngResult(): ViewportCaptureResult {
  return {
    dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    mimeType: 'image/png',
    width: 1,
    height: 1,
  }
}

async function run() {
  assertEqual(viewportPngFileName('1UBQ.pdb'), '1UBQ-view.png')
  assertEqual(viewportPngFileName(' alpha/beta: final?.cif '), 'alpha-beta-final-view.png')
  assertEqual(viewportPngFileName(null), 'zatom-structure-view.png')
  assertTrue(sanitizedViewportExportStem('a'.repeat(200)).length <= 96)

  const blob = viewportPngDataUrlToBlob(pngResult())
  assertEqual(blob.type, 'image/png')
  assertTrue(blob.size > 8)

  let rejectedCorruptPayload = false
  try {
    viewportPngDataUrlToBlob({
      ...pngResult(),
      dataUrl: 'data:image/png;base64,bm90IGEgcG5n',
    })
  } catch {
    rejectedCorruptPayload = true
  }
  assertTrue(rejectedCorruptPayload, 'corrupt image bytes must not be downloaded as PNG')

  const activeViewportKey = {}
  let captureKey: unknown = null
  let captureMaxDim = 0
  let downloadedName = ''
  let downloadedMimeType = ''
  const exported = await exportViewportPng(
    { registryKey: activeViewportKey, sourceName: 'protein.pdb', maxDim: 9999 },
    {
      capture: async (options, key) => {
        captureKey = key
        captureMaxDim = options.maxDim ?? 0
        return pngResult()
      },
      download: (name, value) => {
        downloadedName = name
        downloadedMimeType = value.type
      },
      isRegistered: (key) => key === activeViewportKey,
    },
  )
  assertTrue(captureKey === activeViewportKey, 'capture must remain pinned to the requested viewport')
  assertEqual(captureMaxDim, VIEWPORT_PNG_MAX_DIMENSION)
  assertEqual(downloadedName, 'protein-view.png')
  assertEqual(downloadedMimeType, 'image/png')
  assertEqual(exported.width, 1)
  assertEqual(exported.height, 1)

  let rejectedMissingViewport = false
  try {
    await exportViewportPng(
      { registryKey: activeViewportKey },
      { capture: async () => null, download: () => undefined, isRegistered: () => false },
    )
  } catch (error) {
    rejectedMissingViewport = error instanceof Error && /not ready/i.test(error.message)
  }
  assertTrue(rejectedMissingViewport, 'missing active capture must produce actionable failure feedback')

  console.log('  ✓ viewport PNG export validates bytes, names files, and pins the active viewport')
}

void run()
