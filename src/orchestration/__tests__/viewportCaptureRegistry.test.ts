import { assertEqual, assertTrue } from '../../testing/assert'
import {
  clampViewportCaptureMaxDimension,
  captureViewport,
  getViewportPose,
  hasRegisteredViewportCapture,
  isUniformViewportCapturePixels,
  measureViewportTarget,
  registerViewportCapture,
  resolveViewportCapturePixelRatio,
  type ViewportCaptureResult,
} from '../viewportCaptureRegistry'

function result(label: string): ViewportCaptureResult {
  return {
    dataUrl: `data:image/png;base64,${label}`,
    mimeType: 'image/png',
    width: 2,
    height: 2,
  }
}

async function run() {
  assertEqual(clampViewportCaptureMaxDimension(), 768)
  assertEqual(clampViewportCaptureMaxDimension(99999), 8192)
  assertEqual(clampViewportCaptureMaxDimension(1), 64)
  assertEqual(resolveViewportCapturePixelRatio({
    logicalWidth: 800,
    logicalHeight: 600,
    currentPixelRatio: 2,
    maxDim: 768,
    maxFramebufferWidth: 8192,
    maxFramebufferHeight: 8192,
  }), 2)
  assertEqual(resolveViewportCapturePixelRatio({
    logicalWidth: 800,
    logicalHeight: 600,
    currentPixelRatio: 2,
    maxDim: 4096,
    maxFramebufferWidth: 8192,
    maxFramebufferHeight: 8192,
  }), 5.12)
  assertEqual(resolveViewportCapturePixelRatio({
    logicalWidth: 800,
    logicalHeight: 600,
    currentPixelRatio: 2,
    maxDim: 4096,
    maxFramebufferWidth: 2048,
    maxFramebufferHeight: 2048,
  }), 2.56)
  assertEqual(resolveViewportCapturePixelRatio({
    logicalWidth: 2000,
    logicalHeight: 1200,
    currentPixelRatio: 2,
    maxDim: 4096,
    maxFramebufferWidth: 2048,
    maxFramebufferHeight: 2048,
  }), 1.024)
  const uniformPixels = new Uint8ClampedArray(128 * 128 * 4)
  for (let offset = 0; offset < uniformPixels.length; offset += 4) {
    uniformPixels[offset] = 255
    uniformPixels[offset + 1] = 255
    uniformPixels[offset + 2] = 255
    uniformPixels[offset + 3] = 255
  }
  assertTrue(isUniformViewportCapturePixels(uniformPixels))
  // One tiny molecule-colored contribution anywhere in the downsampled frame
  // must make the capture non-uniform; the old sparse point grid missed this.
  uniformPixels[(73 * 128 + 61) * 4] = 12
  assertTrue(!isUniformViewportCapturePixels(uniformPixels))
  uniformPixels[(73 * 128 + 61) * 4] = 255
  uniformPixels[(91 * 128 + 37) * 4 + 3] = 0
  assertTrue(!isUniformViewportCapturePixels(uniformPixels))
  const wrongKey = {}
  const activeKey = {}
  let wrongCaptures = 0
  let activeCaptures = 0
  let wrongMeasurements = 0
  let activeMeasurements = 0
  const unregisterWrong = registerViewportCapture(wrongKey, {
    capture: async () => {
      wrongCaptures++
      return result('wrong')
    },
    measureTarget: () => {
      wrongMeasurements++
      return null
    },
  })

  const pending = captureViewport({ format: 'png' }, activeKey)
  assertTrue(!hasRegisteredViewportCapture(activeKey))
  await new Promise((resolve) => setTimeout(resolve, 10))
  const unregisterActive = registerViewportCapture(activeKey, {
    capture: async () => {
      activeCaptures++
      return result('active')
    },
    measureTarget: () => {
      activeMeasurements++
      return {
        centerNdc: [0, 0, 0.5],
        centerPx: [100, 75],
        viewportSizePx: [200, 150],
        projectedRadiusPx: 20,
        centerVisible: true,
        regionVisible: true,
      }
    },
    getPose: () => ({ position: [4, 5, 6], lookAt: [1, 2, 3], zoom: 27 }),
  })

  try {
    assertTrue(hasRegisteredViewportCapture(activeKey))
    const capture = await pending
    assertEqual(capture?.dataUrl, 'data:image/png;base64,active')
    assertEqual(wrongCaptures, 0)
    assertEqual(activeCaptures, 1)
    assertTrue(capture?.width === 2 && capture.height === 2)
    const placement = await measureViewportTarget({ center: [1, 2, 3], radius: 2 }, activeKey)
    assertEqual(placement?.centerPx[0], 100)
    assertEqual(wrongMeasurements, 0)
    assertEqual(activeMeasurements, 1)
    const pose = getViewportPose(activeKey)
    assertEqual(pose?.lookAt[1], 2)
    assertEqual(pose?.zoom, 27)
    console.log('  ✓ capture waits for and uses the exact active viewport')
  } finally {
    unregisterActive()
    unregisterWrong()
    assertTrue(!hasRegisteredViewportCapture(activeKey))
  }
}

void run()
