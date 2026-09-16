import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

// The repo root (Mural/) relative to this config file (demo/).
const repo = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url))

// The renderer bundles mural from its BUILT dist (never src — NodeNext `.js`
// specifiers break Vite's resolver). These aliases mirror the old importmap in
// platform.html one-for-one. Order matters: the trailing-slash prefix aliases
// (deep imports like framework/shell/services/x.js) come before the exact-entry
// aliases so they win for deep paths.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: [
        { find: /^@pragmatic-tech-ai\/mural\/framework\//, replacement: repo('dist/framework/') },
        { find: /^@pragmatic-tech-ai\/mural\/runtime\//, replacement: repo('dist/runtime/') },
        { find: /^@pragmatic-tech-ai\/mural\/basic\//, replacement: repo('dist/basic/') },
        { find: /^@pragmatic-tech-ai\/mural\/visual-engine\//, replacement: repo('dist/visual-engine/') },
        { find: '@pragmatic-tech-ai/mural/runtime', replacement: repo('dist/runtime/index.js') },
        { find: '@pragmatic-tech-ai/mural/basic', replacement: repo('dist/basic/index.js') },
        { find: '@pragmatic-tech-ai/mural/framework', replacement: repo('dist/framework/index.js') },
        { find: '@pragmatic-tech-ai/mural/resources/material', replacement: repo('dist/resources/material/index.js') },
        { find: '@pragmatic-tech-ai/mural/visual-engine', replacement: repo('dist/visual-engine/index.js') },
        { find: /^@pragmatic-tech-ai\/todl-runtime$/, replacement: repo('node_modules/@pragmatic-tech-ai/todl-runtime/dist/index.js') },
      ],
    },
    build: {
      rollupOptions: {
        input: { index: resolve(fileURLToPath(new URL('./src/renderer/index.html', import.meta.url))) },
      },
    },
  },
})
