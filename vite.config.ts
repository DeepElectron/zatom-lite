import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'

import { BOLTZ_API_ORIGIN, BOLTZ_ARTIFACT_ORIGIN } from './src/services/boltz-endpoints.ts'

export default defineConfig(async ({ command, isPreview }) => {
  const plugins: PluginOption[] = [tailwindcss(), react()]
  if (command === 'serve' && !isPreview) {
    // The loopback bridge is development-only and must not enter the production
    // configuration graph or deployment bundle.
    const { zatomCliBridge } = await import('./src/devbridge/vite-plugin.ts')
    plugins.push(zatomCliBridge())
  }

  return {
    plugins,
    resolve: {
      // Ketcher only needs Paper.js geometry/rendering. The full build also embeds
      // the PaperScript compiler, whose Acorn keyword table is generated with
      // Function(...) at runtime and therefore cannot run under the web CSP.
      alias: { paper: 'paper/dist/paper-core.js' },
      // R3F/drei must be pre-bundled into the same chunk as three. When Vite
      // re-optimises and splits them, drei's useThree cannot see fiber's context and
      // every viewport fails with "R3F: Hooks can only be used within the Canvas
      // component!" even though the component hierarchy is correct.
      // Deliberately no '@' alias, matching tsconfig.json: every import is either
      // relative or a declared dependency, so a stray reach outside the tree fails to
      // resolve instead of quietly working in the bundler and not in the typechecker.
      dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
    },
    optimizeDeps: {
      include: ['three', '@react-three/fiber', '@react-three/drei'],
    },
    worker: { format: 'es' },
    server: {
      proxy: {
        // Boltz does not handle CORS preflight requests. The development proxy
        // keeps authenticated JSON requests same-origin without persisting keys.
        '/boltz-api': {
          target: BOLTZ_API_ORIGIN,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/boltz-api/, ''),
        },
        // Signed artifacts also use a fixed same-origin proxy so the page CSP can
        // remain connect-src 'self'. The fixed upstream prevents an open proxy.
        '/boltz-artifact': {
          target: BOLTZ_ARTIFACT_ORIGIN,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/boltz-artifact/, ''),
        },
      },
    },
    build: {
      // Ketcher is an intentional on-demand editor chunk. Transfer budgets are
      // enforced on gzip output by scripts/verify-web-build.mjs.
      chunkSizeWarningLimit: 22_000,
    },
  }
})
