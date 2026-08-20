// Composes the Openship manifest from the generated payload plus the hand-authored project
// metadata, and provides the lookups the route handlers use. See OPENSHIP.md for the contract.

import { gunzipSync } from 'node:zlib'
import {
  OPENSHIP_BUNDLE_GZIP_BASE64,
  OPENSHIP_COMMIT,
  OPENSHIP_DIGEST,
  OPENSHIP_ENV_KEYS,
  OPENSHIP_FILES_JSON,
  OPENSHIP_GENERATED_AT,
  OPENSHIP_TOTALS,
} from '@/lib/openship/generated/bundle'
import {
  OPENSHIP_PROJECT,
  OPENSHIP_SETUP,
  OPENSHIP_STACK,
  OPENSHIP_STRUCTURE,
} from '@/lib/openship/project'

export const OPENSHIP_VERSION = '1.0'

export type OpenshipEncoding = 'utf-8' | 'base64'

export type OpenshipFile = {
  path: string
  size: number
  sha256: string
  encoding: OpenshipEncoding
  mediaType: string
  type: 'file' | 'symlink'
  target?: string
}

export type OpenshipCommit = {
  sha: string
  ref: string
  committedAt: string
  dirty: boolean
}

export const OPENSHIP_ENDPOINTS = {
  manifest: '/openship/manifest.json',
  bundle: '/openship/bundle.json',
  file: '/openship/file/{path}',
  archive: '/openship/source.tar.gz',
  instructions: '/openship/agent.txt',
  page: '/openship',
  // The write half. Advertised unconditionally so a client can discover the rules even where this
  // deployment does not accept submissions; POST answers 501 there.
  policy: '/openship/policy.json',
  changes: '/openship/changes',
} as const

let filesCache: OpenshipFile[] | null = null

export const getOpenshipFiles = (): OpenshipFile[] => {
  filesCache ??= JSON.parse(OPENSHIP_FILES_JSON) as OpenshipFile[]
  return filesCache
}

export const getOpenshipCommit = (): OpenshipCommit => OPENSHIP_COMMIT as OpenshipCommit

export const getOpenshipManifest = () => ({
  openship: OPENSHIP_VERSION,
  generatedAt: OPENSHIP_GENERATED_AT,
  digest: OPENSHIP_DIGEST,
  commit: getOpenshipCommit(),
  project: OPENSHIP_PROJECT,
  stack: OPENSHIP_STACK,
  structure: OPENSHIP_STRUCTURE,
  setup: OPENSHIP_SETUP,
  // Names only, never values. Fill these in yourself; the app has no fallback secrets.
  env: OPENSHIP_ENV_KEYS,
  endpoints: OPENSHIP_ENDPOINTS,
  totals: OPENSHIP_TOTALS,
  files: getOpenshipFiles(),
})

type BundleEntry = { encoding: OpenshipEncoding; content: string }
type Bundle = { files: Record<string, BundleEntry> }

let bundleCache: Bundle | null = null
let bundleJsonCache: string | null = null

// Decompressed once per server instance. Under cacheComponents these route handlers are
// prerendered, so in practice this runs at build time rather than per request.
const getBundle = (): Bundle => {
  if (!bundleCache) {
    bundleJsonCache = decompressBundleJson()
    bundleCache = JSON.parse(bundleJsonCache) as Bundle
  }
  return bundleCache
}

const decompressBundleJson = (): string =>
  gunzipSync(Buffer.from(OPENSHIP_BUNDLE_GZIP_BASE64, 'base64')).toString('utf8')

export const getOpenshipBundleJson = (): string => {
  getBundle()
  return bundleJsonCache as string
}

export type OpenshipFileResult = {
  metadata: OpenshipFile
  body: Buffer
}

/**
 * Looks a path up as an exact key in the decoded bundle. Nothing here touches the filesystem and
 * nothing resolves `..`, so path traversal is impossible by construction rather than by filtering.
 */
export const getOpenshipFile = (filePath: string): OpenshipFileResult | null => {
  const metadata = getOpenshipFiles().find((file) => file.path === filePath)
  if (!metadata) return null

  const entry = getBundle().files[filePath]
  if (!entry) return null

  return {
    metadata,
    body: Buffer.from(entry.content, entry.encoding === 'base64' ? 'base64' : 'utf8'),
  }
}
