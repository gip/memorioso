#!/usr/bin/env node
// Generates the Openship payload that app/openship/* serves. See OPENSHIP.md.
//
// The file set comes from `git ls-files` and never from a filesystem walk: that is what keeps
// .env.local, .vercel/, .gstack/, node_modules/, and .next/ structurally impossible to publish.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, constants } from 'node:zlib'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED_DIR = path.join(REPO_ROOT, 'lib', 'openship', 'generated')
const GENERATED_FILE = path.join(GENERATED_DIR, 'bundle.ts')
const ARCHIVE_DIR = path.join(REPO_ROOT, 'public', 'openship')
const ARCHIVE_FILE = path.join(ARCHIVE_DIR, 'source.tar.gz')

// Only files that cannot survive a UTF-8 round trip are base64-encoded, so the common case stays
// readable in the bundle. Everything here is served with its real media type instead of text/plain.
const BINARY_MEDIA_TYPES = {
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 }).toString()

const readTrackedPaths = () =>
  git(['ls-files', '-z']).split('\0').filter(Boolean).sort()

const readCommit = () => {
  const dirty = git(['status', '--porcelain']).trim().length > 0
  return {
    sha: git(['rev-parse', 'HEAD']).trim(),
    ref: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    committedAt: git(['log', '-1', '--format=%cI']).trim(),
    // A dirty tree means the payload does not correspond to any commit. Callers should not treat
    // the sha as a reproducible pointer when this is true.
    dirty,
  }
}

// Keys only. Values in .env.example are placeholders, but publishing them would still invite
// someone to copy a "default" secret into a real deployment.
const readEnvKeys = () => {
  const source = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter(Boolean)
}

const readEntry = (relativePath) => {
  const absolutePath = path.join(REPO_ROOT, relativePath)
  const stats = lstatSync(absolutePath)

  // CLAUDE.md is a tracked symlink to AGENTS.md. Declare it as a symlink so a faithful rebuild can
  // recreate the link, but serve the resolved content so a naive agent still gets a working repo.
  const symlinkTarget = stats.isSymbolicLink() ? readlinkSync(absolutePath) : null
  const content = readFileSync(absolutePath)
  const extension = path.extname(relativePath).toLowerCase()
  const mediaType = BINARY_MEDIA_TYPES[extension]
  const isBinary = Boolean(mediaType) || content.includes(0)

  return {
    path: relativePath,
    size: content.length,
    sha256: sha256(content),
    encoding: isBinary ? 'base64' : 'utf-8',
    mediaType: mediaType ?? 'text/plain; charset=utf-8',
    ...(symlinkTarget ? { type: 'symlink', target: symlinkTarget } : { type: 'file' }),
    body: content.toString(isBinary ? 'base64' : 'utf8'),
  }
}

// One digest over the whole payload, so a client can compare two deployments with a single value.
const digestOf = (entries) =>
  'sha256:' + sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''))

const buildPayload = () => {
  const entries = readTrackedPaths().map(readEntry)
  const commit = readCommit()
  const generatedAt = new Date().toISOString()
  const digest = digestOf(entries)

  const files = entries.map(({ body: _body, ...metadata }) => metadata)
  const contents = Object.fromEntries(
    entries.map((entry) => [entry.path, { encoding: entry.encoding, content: entry.body }])
  )

  const bundle = {
    openship: '1.0',
    generatedAt,
    commit,
    digest,
    files: contents,
  }

  return {
    commit,
    generatedAt,
    digest,
    files,
    envKeys: readEnvKeys(),
    totals: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
    },
    bundleGzip: gzipSync(Buffer.from(JSON.stringify(bundle)), { level: constants.Z_BEST_COMPRESSION }),
  }
}

const emptyPayload = () => ({
  commit: { sha: '', ref: '', committedAt: '', dirty: false },
  generatedAt: new Date().toISOString(),
  digest: '',
  files: [],
  envKeys: [],
  totals: { files: 0, bytes: 0 },
  bundleGzip: gzipSync(
    Buffer.from(JSON.stringify({ openship: '1.0', generatedAt: '', commit: {}, digest: '', files: {} }))
  ),
})

const renderModule = (payload) => `// Generated by scripts/build-openship.mjs. Do not edit.
/* eslint-disable */
export const OPENSHIP_GENERATED_AT = ${JSON.stringify(payload.generatedAt)}
export const OPENSHIP_DIGEST = ${JSON.stringify(payload.digest)}
export const OPENSHIP_COMMIT = ${JSON.stringify(payload.commit)}
export const OPENSHIP_TOTALS = ${JSON.stringify(payload.totals)}
export const OPENSHIP_ENV_KEYS = ${JSON.stringify(payload.envKeys)}
export const OPENSHIP_FILES_JSON = ${JSON.stringify(JSON.stringify(payload.files))}
export const OPENSHIP_BUNDLE_GZIP_BASE64 = ${JSON.stringify(payload.bundleGzip.toString('base64'))}
`

const writeArchive = () => {
  mkdirSync(ARCHIVE_DIR, { recursive: true })
  rmSync(ARCHIVE_FILE, { force: true })
  // Same file list as the bundle, and tar stores symlinks as links without -h, matching git.
  execFileSync('sh', ['-c', `git ls-files -z | tar --null -T - -czf ${JSON.stringify(ARCHIVE_FILE)}`], {
    cwd: REPO_ROOT,
  })
}

const main = () => {
  // A repository reconstructed from Openship itself has no .git, and building it must still work.
  // So missing git is only fatal where shipping an empty payload would be a silent regression: a
  // real deployment or CI. `postinstall` passes --lenient because it also runs before a build.
  const deploying = Boolean(process.env.VERCEL || process.env.CI)
  const lenient = process.argv.includes('--lenient') || !deploying

  let payload
  try {
    payload = buildPayload()
  } catch (error) {
    if (!lenient) {
      console.error(
        `[openship] cannot build the payload: ${error.message.split('\n')[0]}\n` +
          '[openship] This is a deployment build, so refusing to ship empty Openship endpoints.\n' +
          '[openship] The payload is derived from `git ls-files`, which needs a git checkout.'
      )
      process.exit(1)
    }
    console.warn(
      `[openship] no payload generated: ${error.message.split('\n')[0]}\n` +
        '[openship] the app will build, but its Openship endpoints will be empty. If this is a\n' +
        '[openship] copy retrieved via Openship, run `git init && git add -A` to populate them.'
    )
    mkdirSync(GENERATED_DIR, { recursive: true })
    writeFileSync(GENERATED_FILE, renderModule(emptyPayload()))
    return
  }

  mkdirSync(GENERATED_DIR, { recursive: true })
  writeFileSync(GENERATED_FILE, renderModule(payload))
  writeArchive()

  const megabytes = (payload.totals.bytes / 1024 / 1024).toFixed(2)
  const compressed = (payload.bundleGzip.length / 1024).toFixed(0)
  console.log(
    `[openship] ${payload.totals.files} files, ${megabytes} MB source, ${compressed} KB compressed` +
      `${payload.commit.dirty ? ' (working tree dirty)' : ''}`
  )
}

main()
