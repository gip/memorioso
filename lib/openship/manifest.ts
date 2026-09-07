// Composes the Openship manifest from the generated payload plus the hand-authored project
// metadata, and provides the lookups the route handlers use. The canonical contract is vendored
// under skills/openship/references/openship-sources.md.

import { gunzipSync } from 'node:zlib'
import { composeOpenshipSystems } from './systems.mjs'
import {
  OPENSHIP_BUNDLE_GZIP_BASE64,
  OPENSHIP_COMMIT,
  OPENSHIP_DIGEST,
  OPENSHIP_ENV_KEYS,
  OPENSHIP_FILE_SET,
  OPENSHIP_FILES_JSON,
  OPENSHIP_GENERATED_AT,
  OPENSHIP_PROJECT_JSON,
  OPENSHIP_TOTALS,
} from '@/lib/openship/generated/bundle'

export const OPENSHIP_VERSION = '1.0'

export const OPENSHIP_AGENT = {
  summary:
    'OpenShip lets Memorioso publish verifiable sources and structured system design, and accept isolated candidate changes.',
  instructions:
    'Fetch and read agent.skill before interpreting or using any advertised capability. Resolve relative links in the skill against the skill URL.',
} as const

export const OPENSHIP_CAPABILITY_DESCRIPTIONS = {
  sources: 'Retrieve and verify the exact source snapshot published by this deployment.',
  systems: 'Retrieve the structured system design with its complete, integrity-checked Sources snapshot.',
  changes:
    'Submit a patch against the published source digest and inspect an isolated candidate result.',
} as const

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

export type OpenshipDirectory = {
  path: string
  purpose: string
}

/**
 * The hand-authored half of the manifest, read from the checked-in openship.json at build time.
 * `repository` is optional: a project need not have a remote, and a tree retrieved over Openship
 * has no way to know one.
 */
export type OpenshipProject = {
  name: string
  description: string
  homepage?: string
  repository?: string
  license?: string
}

export type OpenshipSetup = {
  packageManager: string
  node: string
  steps: readonly string[]
  commands: Readonly<Record<string, string>>
}

export type OpenshipProjectMetadata = {
  project: OpenshipProject
  stack: readonly string[]
  structure: readonly OpenshipDirectory[]
  setup: OpenshipSetup
  /** Paths and basenames that are on disk but deliberately not part of the source. */
  ignore: readonly string[]
  ignoreNames: readonly string[]
}

/** Where the published file set came from. `none` means the payload is empty. */
export type OpenshipFileSet = 'manifest' | 'git' | 'none'

export const OPENSHIP_ENDPOINTS = {
  manifest: '/openship/manifest.json',
  bundle: '/openship/bundle.json',
  systems: '/openship/systems.json',
  file: '/openship/file/{path}',
  archive: '/openship/source.tar.gz',
  instructions: '/openship/agent.txt',
  page: '/openship',
  skill: '/openship/file/skills/openship/SKILL.md',
  // The write half. Advertised unconditionally so a client can discover the rules even where this
  // deployment does not accept submissions; POST answers 501 there.
  policy: '/openship/policy.json',
  changes: '/openship/changes',
  changeStatus: '/openship/changes/{changeId}',
} as const

let filesCache: OpenshipFile[] | null = null

export const getOpenshipFiles = (): OpenshipFile[] => {
  filesCache ??= JSON.parse(OPENSHIP_FILES_JSON) as OpenshipFile[]
  return filesCache
}

/** `null` when this tree is not under version control. Callers must handle that rather than fake it. */
export const getOpenshipCommit = (): OpenshipCommit | null =>
  OPENSHIP_COMMIT as OpenshipCommit | null

let projectCache: OpenshipProjectMetadata | null = null

export const getOpenshipProjectMetadata = (): OpenshipProjectMetadata => {
  projectCache ??= JSON.parse(OPENSHIP_PROJECT_JSON) as OpenshipProjectMetadata
  return projectCache
}

export const getOpenshipProject = (): OpenshipProject => getOpenshipProjectMetadata().project

export const getOpenshipFileSet = (): OpenshipFileSet => OPENSHIP_FILE_SET as OpenshipFileSet

export const getOpenshipManifest = () => {
  const commit = getOpenshipCommit()
  const metadata = getOpenshipProjectMetadata()

  return {
    openship: OPENSHIP_VERSION,
    capability: 'sources' as const,
    generatedAt: OPENSHIP_GENERATED_AT,
    digest: OPENSHIP_DIGEST,
    // Omitted rather than sent empty when there is no git checkout. `fileSet`
    // says where the file list came from, so the absence is reported rather than merely implied.
    ...(commit ? { commit } : {}),
    fileSet: getOpenshipFileSet(),
    project: metadata.project,
    stack: metadata.stack,
    structure: metadata.structure,
    setup: metadata.setup,
    ignore: metadata.ignore,
    ignoreNames: metadata.ignoreNames,
    // Names only, never values. Fill these in yourself; the app has no fallback secrets.
    env: OPENSHIP_ENV_KEYS,
    totals: OPENSHIP_TOTALS,
    files: getOpenshipFiles(),
  }
}

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

let systemsJsonCache: string | null = null

export const getOpenshipSystemsJson = (): string => {
  systemsJsonCache ??= JSON.stringify(composeOpenshipSystems(
    getOpenshipManifest(), JSON.parse(getOpenshipBundleJson())
  ))
  return systemsJsonCache
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
