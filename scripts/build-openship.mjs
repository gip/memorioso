#!/usr/bin/env node
// Generates the OpenShip Sources payload that app/openship/* serves.
//
// The file set comes from openship.json — the checked-in manifest — and never from an unfiltered
// filesystem walk. That is what keeps .env.local, .vercel/, .gstack/, node_modules/, and .next/
// structurally impossible to publish: the manifest is an allowlist, so a path nobody listed is a
// path nobody serves. Where openship.json is absent, `git ls-files` is the fallback, which fails
// closed the same way.
//
// Git is optional throughout. A repository retrieved over Openship has no .git, and it must still
// be able to build and serve its own source; that is the whole point of the checked-in manifest.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, constants } from 'node:zlib'
import { computeSourcesDigest } from '@openship/protocol'
import { readManifest, verifyManifestDetailed } from './openship-manifest.mjs'

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

// stderr is discarded: every call here is optional, and a tree with no .git would otherwise print
// `fatal: not a git repository` on an entirely successful build.
const git = (args) =>
  execFileSync('git', args, {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString()

/** Every git read is optional: null means "this tree is not under version control", not an error. */
const tryGit = (args) => {
  try {
    return git(args).trim()
  } catch {
    return null
  }
}

/**
 * The published file set, and where it came from. The manifest is authoritative; git is the
 * fallback for a checkout that predates openship.json. Returns null when neither is available.
 */
const readFileSet = (manifest) => {
  if (manifest && Array.isArray(manifest.files)) {
    return { fileSet: 'manifest', paths: manifest.files.map((entry) => entry.path).sort() }
  }

  const tracked = tryGit(['ls-files'])
  if (tracked === null) return null
  return { fileSet: 'git', paths: tracked.split('\n').filter(Boolean).sort() }
}

const readCommit = () => {
  const sha = tryGit(['rev-parse', 'HEAD'])
  if (sha === null) return null

  return {
    sha,
    ref: tryGit(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '',
    committedAt: tryGit(['log', '-1', '--format=%cI']) ?? '',
    // A dirty tree means the payload does not correspond to any commit. Callers should not treat
    // the sha as a reproducible pointer when this is true.
    dirty: (tryGit(['status', '--porcelain']) ?? '').length > 0,
  }
}

/** `git@github.com:owner/repo.git` and `https://…/repo.git` both become a browsable https URL. */
const normalizeRemote = (remote) => {
  if (!remote) return null
  const scp = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(remote)
  if (scp) return `https://${scp[1]}/${scp[2]}`
  return remote.replace(/\.git$/, '')
}

/**
 * The hand-authored half of the manifest. `repository` is optional: taken from openship.json when
 * set, otherwise from the git remote, otherwise omitted rather than guessed.
 */
const readProject = (manifest) => {
  const project = { ...(manifest?.project ?? {}) }
  if (!project.repository) {
    const remote = normalizeRemote(tryGit(['remote', 'get-url', 'origin']))
    if (remote) project.repository = remote
    else delete project.repository
  }

  return {
    project,
    stack: manifest?.stack ?? [],
    structure: manifest?.structure ?? [],
    setup: manifest?.setup ?? {},
    // Published so that a client which saves /openship/manifest.json as its openship.json gets a
    // working `pnpm openship:check`. Without these, a retrieved copy would flag node_modules/ and
    // every other build artefact as an undeclared file.
    ignore: manifest?.ignore ?? [],
    ignoreNames: manifest?.ignoreNames ?? [],
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
// Defined by OpenShip Sources; `entries` arrives sorted by path, which makes it canonical.
const digestOf = (entries) => computeSourcesDigest(entries)

const buildPayload = () => {
  const manifest = readManifest(REPO_ROOT)
  const fileSet = readFileSet(manifest)
  if (!fileSet) {
    throw new Error('no openship.json and no git checkout, so there is no file set to publish')
  }

  const entries = fileSet.paths.map(readEntry)
  const generatedAt = new Date().toISOString()
  const digest = digestOf(entries)

  const files = entries.map(({ body: _body, ...metadata }) => metadata)
  const contents = Object.fromEntries(
    entries.map((entry) => [entry.path, { encoding: entry.encoding, content: entry.body }])
  )

  const commit = readCommit()
  const bundle = {
    openship: '1.0',
    capability: 'sources',
    generatedAt,
    ...(commit ? { commit } : {}),
    digest,
    files: contents,
  }

  return {
    commit,
    fileSet: fileSet.fileSet,
    ...readProject(manifest),
    generatedAt,
    digest,
    paths: fileSet.paths,
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
  commit: null,
  fileSet: 'none',
  project: {},
  stack: [],
  structure: [],
  setup: {},
  ignore: [],
  ignoreNames: [],
  generatedAt: new Date().toISOString(),
  digest: '',
  paths: [],
  files: [],
  envKeys: [],
  totals: { files: 0, bytes: 0 },
  bundleGzip: gzipSync(
    Buffer.from(JSON.stringify({ openship: '1.0', capability: 'sources', generatedAt: '', digest: '', files: {} }))
  ),
})

const renderModule = (payload) => `// Generated by scripts/build-openship.mjs. Do not edit.
/* eslint-disable */
export const OPENSHIP_GENERATED_AT = ${JSON.stringify(payload.generatedAt)}
export const OPENSHIP_DIGEST = ${JSON.stringify(payload.digest)}
export const OPENSHIP_COMMIT = ${JSON.stringify(payload.commit)}
export const OPENSHIP_FILE_SET = ${JSON.stringify(payload.fileSet)}
export const OPENSHIP_TOTALS = ${JSON.stringify(payload.totals)}
export const OPENSHIP_ENV_KEYS = ${JSON.stringify(payload.envKeys)}
export const OPENSHIP_PROJECT_JSON = ${JSON.stringify(
  JSON.stringify({
    project: payload.project,
    stack: payload.stack,
    structure: payload.structure,
    setup: payload.setup,
    ignore: payload.ignore,
    ignoreNames: payload.ignoreNames,
  })
)}
export const OPENSHIP_FILES_JSON = ${JSON.stringify(JSON.stringify(payload.files))}
export const OPENSHIP_BUNDLE_GZIP_BASE64 = ${JSON.stringify(payload.bundleGzip.toString('base64'))}
`

// Exactly the manifest's file set, and tar stores symlinks as links without -h, matching what the
// manifest declares. Driven from the same path list as the bundle rather than from git, so the two
// cannot drift.
const writeArchive = (paths) => {
  mkdirSync(ARCHIVE_DIR, { recursive: true })
  rmSync(ARCHIVE_FILE, { force: true })
  execFileSync('tar', ['--null', '-T', '-', '-czf', ARCHIVE_FILE], {
    cwd: REPO_ROOT,
    input: `${paths.join('\0')}\0`,
  })
}

const describe = (problems, headline) =>
  `[openship] ${headline} (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
  problems.slice(0, 10).map((problem) => `[openship]   - ${problem.message}`).join('\n') +
  '\n[openship] Run `pnpm openship:manifest` to regenerate the file list.'

/**
 * A manifest that disagrees with disk means the payload is not the source. Fatal where shipping the
 * wrong file set would go unnoticed; a warning locally, where the fix is one command away.
 *
 * An *undeclared* file — on disk, named by neither `files` nor `ignore` — is the one case that
 * never blocks. `files` is an allowlist, so an undeclared file is simply not published: there is
 * nothing incorrect about the payload, only something stale about the manifest. Build platforms
 * materialise files into the workspace that were never in the repository (Vercel writes a
 * `vercel.json` from project settings), and a deployment that dies because the platform added a
 * file it owns is a deployment that dies for no reason.
 */
const checkManifest = (lenient) => {
  const manifest = readManifest(REPO_ROOT)
  if (!manifest) return

  const problems = verifyManifestDetailed(manifest, REPO_ROOT)
  if (problems.length === 0) return

  const undeclared = problems.filter((problem) => problem.kind === 'undeclared')
  const blocking = problems.filter((problem) => problem.kind !== 'undeclared')

  if (!lenient && blocking.length > 0) {
    console.error(describe(blocking, 'openship.json disagrees with the working tree'))
    console.error('[openship] This is a deployment build, so refusing to ship a manifest that lies.')
    process.exit(1)
  }

  if (blocking.length > 0) console.warn(describe(blocking, 'openship.json disagrees with the working tree'))
  if (undeclared.length > 0) {
    console.warn(
      describe(undeclared, 'openship.json does not list every file on disk, so these are not published')
    )
  }
}

const main = () => {
  // A repository reconstructed from Openship itself has no .git, and building it must still work.
  // So a missing file set is only fatal where shipping an empty payload would be a silent
  // regression: a real deployment or CI. `postinstall` passes --lenient because it also runs
  // before a build.
  const deploying = Boolean(process.env.VERCEL || process.env.CI)
  const lenient = process.argv.includes('--lenient') || !deploying

  checkManifest(lenient)

  let payload
  try {
    payload = buildPayload()
  } catch (error) {
    if (!lenient) {
      console.error(
        `[openship] cannot build the payload: ${error.message.split('\n')[0]}\n` +
          '[openship] This is a deployment build, so refusing to ship empty Openship endpoints.\n' +
          '[openship] The payload is derived from openship.json, falling back to `git ls-files`.'
      )
      process.exit(1)
    }
    console.warn(
      `[openship] no payload generated: ${error.message.split('\n')[0]}\n` +
        '[openship] the app will build, but its Openship endpoints will be empty. If this is a\n' +
        '[openship] copy retrieved via Openship, save /openship/manifest.json as openship.json.'
    )
    mkdirSync(GENERATED_DIR, { recursive: true })
    writeFileSync(GENERATED_FILE, renderModule(emptyPayload()))
    return
  }

  mkdirSync(GENERATED_DIR, { recursive: true })
  writeFileSync(GENERATED_FILE, renderModule(payload))
  writeArchive(payload.paths)

  const megabytes = (payload.totals.bytes / 1024 / 1024).toFixed(2)
  const compressed = (payload.bundleGzip.length / 1024).toFixed(0)
  console.log(
    `[openship] ${payload.totals.files} files from ${payload.fileSet}, ${megabytes} MB source, ` +
      `${compressed} KB compressed` +
      `${payload.commit ? (payload.commit.dirty ? ' (working tree dirty)' : '') : ' (no git)'}`
  )
}

main()
