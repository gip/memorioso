import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        'service-worker': resolve(import.meta.dirname, 'src/service-worker.ts'),
        content: resolve(import.meta.dirname, 'src/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
