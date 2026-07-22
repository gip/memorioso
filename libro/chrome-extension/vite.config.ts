import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function extensionManifest(apiOrigin: string): Plugin {
  return {
    name: 'libro-extension-manifest',
    async closeBundle() {
      const source = resolve(import.meta.dirname, 'public/manifest.json')
      const output = resolve(import.meta.dirname, 'dist/manifest.json')
      const manifest = JSON.parse(await readFile(source, 'utf8')) as { host_permissions: string[] }
      const origin = new URL(apiOrigin).origin
      manifest.host_permissions = [
        'https://worldchain-mainnet.g.alchemy.com/*',
        'https://bridge.worldcoin.org/*',
        `${origin}/*`,
      ]
      await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const apiOrigin = env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz'
  return {
    root: import.meta.dirname,
    publicDir: resolve(import.meta.dirname, 'public'),
    plugins: [extensionManifest(apiOrigin)],
    build: {
      outDir: resolve(import.meta.dirname, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
          'service-worker': resolve(import.meta.dirname, 'src/service-worker.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  }
})
