import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      formats: ['iife'],
      name: 'LibroContentScript',
      fileName: () => 'content.js',
    },
  },
})
