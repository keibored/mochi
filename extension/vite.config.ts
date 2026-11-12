import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    target: 'chrome120',
    rollupOptions: {
      input: { background: `${root}src/background.ts`, popup: `${root}popup.html`, options: `${root}options.html` },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
