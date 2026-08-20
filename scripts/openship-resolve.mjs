// Lets the build worker import the app's TypeScript modules directly.
//
// The worker re-runs the same validator the endpoint runs, from the same source file, because a
// gate with two implementations is a gate with two behaviours. That means resolving the `@/` alias
// this repo uses everywhere, which Node does not know about. Node 24 strips the types itself.
//
// Used as `node --import ./scripts/openship-resolve.mjs scripts/openship-worker.mjs`.

import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Mirrors what tsconfig's paths and the bundler do: try the file, then its extensions, then an
// index inside a directory of that name.
const CANDIDATES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.js']

const resolveAlias = (specifier) => {
  const target = path.join(REPO_ROOT, specifier.slice(2))
  for (const suffix of CANDIDATES) {
    const candidate = `${target}${suffix}`
    if (suffix !== '' && existsSync(candidate)) return pathToFileURL(candidate).href
    if (suffix === '' && existsSync(candidate) && path.extname(candidate)) {
      return pathToFileURL(candidate).href
    }
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const resolved = resolveAlias(specifier)
      if (resolved) return { url: resolved, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
