import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // The standalone service has its own alias root, setup, and Vitest configuration.
    exclude: [...configDefaults.exclude, 'libro/service/**'],
  },
})
