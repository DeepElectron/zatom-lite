/**
 * Register capture for one viewport store. Captures request a normal R3F frame
 * before reading the preserved drawing buffer; manual gl.render would bypass
 * frame-loop updates. JPEG output receives an explicit opaque background.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  clampViewportCaptureMaxDimension,
  isUniformViewportCapturePixels,
  registerViewportCapture,
  resolveViewportCapturePixelRatio,
} from '../../../orchestration/viewportCaptureRegistry';
import { useViewportStoreApi } from '../../../orchestration/ViewportContext';

function waitForFrame(timeoutMs = 150): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

export function ViewportCaptureRegistrar({ registryKey }: { registryKey?: unknown } = {}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls as { target?: THREE.Vector3 } | null);
  const invalidate = useThree((s) => s.invalidate);
  const storeApi = useViewportStoreApi();
  const key = registryKey ?? storeApi;

  useEffect(() => {
    return registerViewportCapture(key, {
      getPose: () => {
        try {
          const position = camera.position;
          const dir = camera.getWorldDirection(new (position.constructor as new () => typeof position)());
          const target = controls?.target;
          const up = camera.up;
          return {
            position: [position.x, position.y, position.z],
            lookAt: target
              ? [target.x, target.y, target.z]
              : [position.x + dir.x * 20, position.y + dir.y * 20, position.z + dir.z * 20],
            up: [up.x, up.y, up.z],
            ...(camera instanceof THREE.OrthographicCamera ? { zoom: camera.zoom } : {}),
          };
        } catch {
          return null;
        }
      },
      getViewportSize: () => {
        try {
          const rendererSize = gl.getSize(new THREE.Vector2());
          const width = gl.domElement.clientWidth || rendererSize.x;
          const height = gl.domElement.clientHeight || rendererSize.y;
          return width > 0 && height > 0 ? { width, height } : null;
        } catch {
          return null;
        }
      },
      measureTarget: (target) => {
        try {
          const width = gl.domElement.clientWidth || gl.domElement.width;
          const height = gl.domElement.clientHeight || gl.domElement.height;
          if (!(width > 0) || !(height > 0)) return null;
          camera.updateMatrixWorld();
          const center = new THREE.Vector3(...target.center);
          const projectedCenter = center.clone().project(camera);
          const cameraRight = new THREE.Vector3()
            .setFromMatrixColumn(camera.matrixWorld, 0)
            .normalize();
          const radiusPoint = center.clone().addScaledVector(cameraRight, Math.max(target.radius, 1e-6)).project(camera);
          const centerPx: [number, number] = [
            (projectedCenter.x + 1) * width / 2,
            (1 - projectedCenter.y) * height / 2,
          ];
          const radiusPxPoint: [number, number] = [
            (radiusPoint.x + 1) * width / 2,
            (1 - radiusPoint.y) * height / 2,
          ];
          const projectedRadiusPx = Math.hypot(
            radiusPxPoint[0] - centerPx[0],
            radiusPxPoint[1] - centerPx[1],
          );
          const centerVisible = projectedCenter.x >= -1 && projectedCenter.x <= 1
            && projectedCenter.y >= -1 && projectedCenter.y <= 1
            && projectedCenter.z >= -1 && projectedCenter.z <= 1;
          const framingMarginPx = 4;
          return {
            centerNdc: [projectedCenter.x, projectedCenter.y, projectedCenter.z],
            centerPx,
            viewportSizePx: [width, height],
            projectedRadiusPx,
            centerVisible,
            regionVisible: centerVisible
              && centerPx[0] - projectedRadiusPx >= framingMarginPx
              && centerPx[0] + projectedRadiusPx <= width - framingMarginPx
              && centerPx[1] - projectedRadiusPx >= framingMarginPx
              && centerPx[1] + projectedRadiusPx <= height - framingMarginPx,
          };
        } catch {
          return null;
        }
      },
      renderFrameSequence: async (opts, run) => {
        let originalPixelRatio: number | null = null;
        let changedPixelRatio = false;
        let originalSceneBackground: THREE.Scene['background'] | undefined;
        let clearedSceneBackground = false;
        try {
          if (opts.transparent) {
            originalSceneBackground = scene.background;
            scene.background = null;
            clearedSceneBackground = true;
          }
          const rendererSize = gl.getSize(new THREE.Vector2());
          const logicalWidth = gl.domElement.clientWidth || rendererSize.x;
          const logicalHeight = gl.domElement.clientHeight || rendererSize.y;
          if (logicalWidth > 0 && logicalHeight > 0 && opts.maxDim) {
            originalPixelRatio = gl.getPixelRatio();
            const context = gl.getContext();
            const maxViewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null;
            const maxTexture = gl.capabilities.maxTextureSize;
            const sessionPixelRatio = resolveViewportCapturePixelRatio({
              logicalWidth,
              logicalHeight,
              currentPixelRatio: originalPixelRatio,
              maxDim: clampViewportCaptureMaxDimension(opts.maxDim),
              maxFramebufferWidth: Math.min(maxTexture, maxViewport?.[0] ?? maxTexture),
              maxFramebufferHeight: Math.min(maxTexture, maxViewport?.[1] ?? maxTexture),
            });
            if (Math.abs(sessionPixelRatio - originalPixelRatio) > 1e-6) {
              gl.setPixelRatio(sessionPixelRatio);
              changedPixelRatio = true;
            }
          }
          return await run(async () => {
            invalidate();
            await waitForFrame();
            const source = gl.domElement;
            return source.width > 0 && source.height > 0 ? source : null;
          });
        } finally {
          if (clearedSceneBackground) {
            try {
              scene.background = originalSceneBackground ?? null;
            } catch {
              // Scene may already be disposed if the viewport unmounted mid-session.
            }
          }
          if (changedPixelRatio && originalPixelRatio != null) {
            try {
              gl.setPixelRatio(originalPixelRatio);
            } catch {
              // Renderer unmounted while the session was in flight.
            }
          }
          if (clearedSceneBackground || changedPixelRatio) {
            try {
              invalidate();
            } catch {
              // Nothing left to redraw.
            }
          }
        }
      },
      capture: async (opts) => {
        let originalPixelRatio: number | null = null;
        let changedPixelRatio = false;
        let originalSceneBackground: THREE.Scene['background'] | undefined;
        let clearedSceneBackground = false;
        try {
          const format = opts?.format === 'png' ? 'png' : 'jpeg';
          if (format === 'png' && opts?.background === 'transparent') {
            originalSceneBackground = scene.background;
            scene.background = null;
            clearedSceneBackground = true;
          }
          const maxDim = clampViewportCaptureMaxDimension(opts?.maxDim);
          const source = gl.domElement;
          const rendererSize = gl.getSize(new THREE.Vector2());
          const logicalWidth = source.clientWidth || rendererSize.x;
          const logicalHeight = source.clientHeight || rendererSize.y;
          if (!(logicalWidth > 0) || !(logicalHeight > 0)) return null;

          // A PNG export may request more pixels than the live DPR buffer.
          // Render those pixels in WebGL, rather than scaling the old bitmap.
          // setPixelRatio keeps the CSS size/camera aspect intact; finally
          // restores the interactive renderer even on capture failure.
          originalPixelRatio = gl.getPixelRatio();
          const context = gl.getContext();
          const maxViewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null;
          const maxTexture = gl.capabilities.maxTextureSize;
          const capturePixelRatio = resolveViewportCapturePixelRatio({
            logicalWidth,
            logicalHeight,
            currentPixelRatio: originalPixelRatio,
            maxDim,
            maxFramebufferWidth: Math.min(maxTexture, maxViewport?.[0] ?? maxTexture),
            maxFramebufferHeight: Math.min(maxTexture, maxViewport?.[1] ?? maxTexture),
          });
          if (Math.abs(capturePixelRatio - originalPixelRatio) > 1e-6) {
            gl.setPixelRatio(capturePixelRatio);
            changedPixelRatio = true;
          }
          for (let attempt = 0; attempt < 15; attempt++) {
            invalidate();
            await waitForFrame(attempt === 0 ? 150 : 500);
            const src = gl.domElement;
            if (!src.width || !src.height) continue;
            const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
            const width = Math.max(1, Math.round(src.width * scale));
            const height = Math.max(1, Math.round(src.height * scale));
            const background = opts?.background
              ?? (format === 'jpeg' ? '#ffffff' : 'transparent');
            const fill = format === 'jpeg' && background === 'transparent'
              ? '#ffffff'
              : background;
            // Downsample the complete frame before checking uniformity. Point
            // sampling used to miss a centered three-atom molecule whenever
            // every atom fell between the 16×16 probe coordinates. Resampling
            // makes every source region contribute to a bounded 128×128 probe,
            // while keeping empty-frame retries cheap even for 8K exports. The
            // full-size output canvas is allocated only after this probe passes.
            {
              const probeCanvas = document.createElement('canvas');
              probeCanvas.width = Math.min(128, width);
              probeCanvas.height = Math.min(128, height);
              const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
              if (!probeContext) return null;
              if (fill !== 'transparent') {
                probeContext.fillStyle = fill;
                probeContext.fillRect(0, 0, probeCanvas.width, probeCanvas.height);
              }
              probeContext.drawImage(src, 0, 0, probeCanvas.width, probeCanvas.height);
              const probe = probeContext.getImageData(0, 0, probeCanvas.width, probeCanvas.height);
              if (isUniformViewportCapturePixels(probe.data)) continue;
            }
            const out = document.createElement('canvas');
            out.width = width;
            out.height = height;
            const ctx = out.getContext('2d');
            if (!ctx) return null;
            if (fill !== 'transparent') {
              ctx.fillStyle = fill;
              ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(src, 0, 0, width, height);
            const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
            const dataUrl = out.toDataURL(mimeType, 0.85);
            return { dataUrl, mimeType, width, height };
          }
          return null;
        } catch {
          return null;
        } finally {
          if (clearedSceneBackground) {
            try {
              scene.background = originalSceneBackground ?? null;
            } catch {
              // Scene may already be disposed if the viewport unmounted mid-capture.
            }
          }
          if (changedPixelRatio && originalPixelRatio != null) {
            try {
              gl.setPixelRatio(originalPixelRatio);
            } catch {
              // The renderer may have unmounted while an asynchronous capture
              // was in flight; there is then no live canvas left to restore.
            }
          }
          if (clearedSceneBackground || changedPixelRatio) {
            try {
              invalidate();
            } catch {
              // Nothing left to redraw.
            }
          }
        }
      },
    });
  }, [gl, scene, camera, controls, invalidate, key]);

  return null;
}
