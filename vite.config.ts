import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Release pipeline: Rolldown bundler + Oxc (TS/JSX transform + JS minify)
 * + Lightning CSS (CSS transform + minify). No Babel, no esbuild, no PostCSS.
 */
// COOP/COEP make the page crossOriginIsolated -> SharedArrayBuffer for the physics worker.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: { chrome: 120 << 16, firefox: 120 << 16, safari: 17 << 16 },
      drafts: { customMedia: true },
    },
  },
  worker: { format: 'es' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    target: 'es2023',
    minify: 'oxc',
    cssMinify: 'lightningcss',
    sourcemap: false,
    reportCompressedSize: true,
    // three.js core is ~530 kB min; it is isolated in its own long-cached chunk.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'ui', test: /node_modules[\\/](preact|@preact)/ },
          ],
        },
      },
    },
  },
})
