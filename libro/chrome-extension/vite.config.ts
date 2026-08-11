import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const PRODUCTION_API_ORIGIN = 'https://www.memorioso.xyz'
const STAGE_API_ORIGIN = 'https://worldlibro.vercel.app'

function extensionManifest(apiOrigin: string, outputDirectory: string, stage: boolean): Plugin {
  return {
    name: 'libro-extension-manifest',
    async closeBundle() {
      const source = resolve(import.meta.dirname, 'public/manifest.json')
      const output = resolve(outputDirectory, 'manifest.json')
      const manifest = JSON.parse(await readFile(source, 'utf8')) as {
        name: string
        description: string
        host_permissions: string[]
      }
      const origin = new URL(apiOrigin).origin
      manifest.host_permissions = [
        'https://worldchain-mainnet.gateway.tenderly.co/*',
        'https://480.rpc.thirdweb.com/*',
        'https://worldchain-mainnet.g.alchemy.com/*',
        'https://bridge.worldcoin.org/*',
        `${origin}/*`,
      ]
      if (stage) {
        manifest.name = `${manifest.name} (Stage)`
        manifest.description = `${manifest.description} Stage API: ${origin}.`
      }
      await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const stage = mode === 'stage'
  const apiOrigin = env.VITE_MEMORIOSO_APP_URL || (stage ? STAGE_API_ORIGIN : PRODUCTION_API_ORIGIN)
  const outputDirectory = resolve(import.meta.dirname, stage ? 'dist-stage' : 'dist')
  return {
    root: import.meta.dirname,
    publicDir: resolve(import.meta.dirname, 'public'),
    define: {
      'import.meta.env.VITE_MEMORIOSO_APP_URL': JSON.stringify(apiOrigin),
    },
    plugins: [extensionManifest(apiOrigin, outputDirectory, stage)],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
          options: resolve(import.meta.dirname, 'options.html'),
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
