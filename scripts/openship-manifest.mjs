#!/usr/bin/env node
// Reads, verifies, and regenerates openship.json — the checked-in declaration of which files make
// up this repository. See the "Manifest source" section of OPENSHIP.md.
//
// This file is the source of truth for the *file set*. The checked-in manifest lists paths and
// nothing else: sizes and hashes are derived at build time, so a committed manifest can never
// disagree with the bytes beside it, and it changes only when a path is added, removed, or renamed.
//
// A manifest that *does* carry `size`/`sha256` — which `/openship/manifest.json` serves, and which
// a client saves as its openship.json — has them verified against disk too. So the same command is
// a path-level check in this repository and a full offline integrity check of a retrieved copy.
//
//   node scripts/openship-manifest.mjs           verify, exit 1 on drift
//   node scripts/openship-manifest.mjs --write   regenerate files[] from disk

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchesAny } from '../lib/openship/paths.ts'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MANIFEST_PATH = path.join(REPO_ROOT, 'openship.json')

/** The manifest describes the tree; it is not in the tree it describes. See OPENSHIP.md. */
export const MANIFEST_NAME = 'openship.json'

// Refused even when a manifest names them explicitly. `files[]` is an allowlist, so nothing leaks
// by omission — but it is one JSON edit away from publishing a secret, and this is the edit that
// would do it. `.env.example` is the deliberate exception: it is tracked, it is published today,
// and it carries names without values.
const REFUSED_PATTERNS = ['.env**']
const REFUSED_EXCEPTIONS = ['.env.example']
// Refused at any depth, which the prefix grammar cannot express: a pnpm workspace has a
// node_modules under every package.
const REFUSED_SEGMENTS = ['node_modules', '.git']

const isRefused = (filePath) => {
  if (REFUSED_EXCEPTIONS.includes(filePath)) return false
  if (filePath.split('/').some((segment) => REFUSED_SEGMENTS.includes(segment))) return true
  return matchesAny(filePath, REFUSED_PATTERNS)
}

export const readManifest = (root = REPO_ROOT) => {
  const file = path.join(root, MANIFEST_NAME)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Every file under `root`, depth first, excluding the manifest itself. Directories covered by
 * `ignore` or `ignoreNames` are pruned on the way down, so an ignored `node_modules/` is never
 * descended into rather than walked and discarded.
 *
 * Files are *not* filtered here. `files[]` takes precedence over `ignore`, so the decision about
 * an individual file belongs to the caller: `.env.example` is both matched by the `.env**` ignore
 * pattern and a published source file, and only the manifest can settle that.
 */
export const scanTree = (root, ignore = [], ignoreNames = []) => {
  const found = []

  const walk = (relativeDir) => {
    const absoluteDir = relativeDir ? path.join(root, relativeDir) : root
    const entries = readdirSync(absoluteDir, { withFileTypes: true })

    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (relativePath === MANIFEST_NAME) continue
      if (ignoreNames.includes(entry.name)) continue

      // A symlink to a directory is a file entry, not a directory to descend into: the dirent
      // reports the link itself, so the link is what gets classified.
      if (entry.isSymbolicLink()) {
        found.push({
          path: relativePath,
          type: 'symlink',
          target: readlinkSync(path.join(root, relativePath)),
        })
        continue
      }
      if (entry.isDirectory()) {
        if (!matchesAny(relativePath, ignore)) walk(relativePath)
        continue
      }
      if (entry.isFile()) found.push({ path: relativePath, type: 'file' })
    }
  }

  walk('')
  return found.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

const ignoreOf = (manifest) => ({
  ignore: Array.isArray(manifest.ignore) ? manifest.ignore : [],
  ignoreNames: Array.isArray(manifest.ignoreNames) ? manifest.ignoreNames : [],
})

/**
 * Compares the manifest's file set against disk. Returns a list of human-readable problems; an
 * empty list means the two are in bijection.
 */
const collect = (manifest, root) => {
  const problems = []
  const report = (kind, message) => problems.push({ kind, message })

  if (!manifest) {
    return [{ kind: 'invalid', message: 'openship.json is missing. Run `pnpm openship:manifest` to create it.' }]
  }
  if (!Array.isArray(manifest.files)) {
    return [{ kind: 'invalid', message: 'openship.json has no `files` array.' }]
  }

  const { ignore, ignoreNames } = ignoreOf(manifest)
  const declared = new Map()

  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
      report('invalid', `openship.json has a files[] entry with no path: ${JSON.stringify(entry)}`)
      continue
    }
    if (entry.path === MANIFEST_NAME) {
      report(
        'invalid',
        'openship.json lists itself. The manifest describes the tree and is not part of it; ' +
          'remove the entry.'
      )
      continue
    }
    if (declared.has(entry.path)) {
      report('invalid', `openship.json lists ${entry.path} twice.`)
      continue
    }
    if (isRefused(entry.path)) {
      report(
        'invalid',
        `openship.json lists ${entry.path}. Openship publishes every file it lists, and this path ` +
          'is refused outright. Remove it.'
      )
      continue
    }
    declared.set(entry.path, entry)
  }

  const onDisk = new Map(scanTree(root, ignore, ignoreNames).map((entry) => [entry.path, entry]))

  // files[] wins over ignore: a path the manifest publishes is published even where a pattern
  // would otherwise skip it. So an undeclared file is a problem only when nothing ignores it.
  for (const filePath of onDisk.keys()) {
    if (declared.has(filePath)) continue
    if (matchesAny(filePath, ignore)) continue
    report(
      'undeclared',
      `${filePath} is on disk but not in openship.json. Add it, add it to \`ignore\`, or run ` +
        '`pnpm openship:manifest`.'
    )
  }

  for (const [filePath, entry] of declared) {
    const actual = onDisk.get(filePath)
    if (!actual) {
      report('missing', `${filePath} is in openship.json but not on disk.`)
      continue
    }
    const declaredType = entry.type ?? 'file'

    // A declared symlink is satisfied by a regular file too. OPENSHIP.md has the file and bundle
    // endpoints serve a symlink's *resolved* content precisely so that a client which ignores
    // `type` still reconstructs a working tree, so a retrieval that did exactly that must verify.
    if (declaredType === 'symlink') {
      if (actual.type === 'symlink' && entry.target !== actual.target) {
        report(
          'type',
          `${filePath} is declared as a symlink to ${entry.target} but points at ${actual.target}.`
        )
      }
      continue
    }

    // The reverse is not tolerated: a path declared as a regular file that is a link on disk is a
    // substitution the manifest never described, and the link may leave the tree entirely.
    if (actual.type === 'symlink') {
      report(
        'type',
        `${filePath} is declared as a regular file but is a symlink to ${actual.target} on disk.`
      )
    }
  }

  problems.push(...verifyContents(declared, onDisk, root))

  return problems
}

/**
 * Problems as `{ kind, message }`. `kind` is what lets a caller decide severity: an `undeclared`
 * file — on disk, named by neither `files` nor `ignore` — is never published, so it is a hygiene
 * signal rather than a correctness failure. Everything else means the manifest and the tree
 * genuinely disagree about a path the manifest claims to describe.
 */
export const verifyManifestDetailed = (manifest, root = REPO_ROOT) => collect(manifest, root)

export const verifyManifest = (manifest, root = REPO_ROOT) =>
  collect(manifest, root).map((problem) => problem.message)

/**
 * Sizes and hashes are optional in a checked-in manifest — they are derived at build time, so
 * committing them would only create a second thing to keep in step. But `/openship/manifest.json`
 * carries them, and a client that saved that document as its openship.json can therefore check the
 * bytes it retrieved without the network and without git. Where they are present, they are
 * verified; where they are absent, nothing is claimed and nothing is checked.
 */
const verifyContents = (declared, onDisk, root) => {
  const problems = []

  for (const [filePath, entry] of declared) {
    const hasSize = typeof entry.size === 'number'
    const hasHash = typeof entry.sha256 === 'string'
    if (!hasSize && !hasHash) continue
    if (!onDisk.has(filePath)) continue

    // A symlink entry describes the resolved target's bytes, which is what both the bundle and the
    // file endpoint serve, so following the link is the correct read either way.
    const body = readFileSync(path.join(root, filePath))
    if (hasSize && body.length !== entry.size) {
      problems.push({
        kind: 'content',
        message: `${filePath} is ${body.length} bytes but the manifest declares ${entry.size}.`,
      })
      continue
    }
    if (hasHash) {
      const actual = createHash('sha256').update(body).digest('hex')
      if (actual !== entry.sha256) {
        problems.push({
          kind: 'content',
          message:
            `${filePath} hashes to ${actual.slice(0, 12)}… but the manifest declares ` +
            `${entry.sha256.slice(0, 12)}…. The retrieval is corrupt or the file was modified.`,
        })
      }
    }
  }

  return problems
}

/** Regenerates `files[]` from disk, preserving every other member exactly as written. */
export const writeManifest = (root = REPO_ROOT) => {
  const manifest = readManifest(root)
  if (!manifest) throw new Error('openship.json is missing; nothing to regenerate.')

  const { ignore, ignoreNames } = ignoreOf(manifest)
  const published = new Set(manifest.files.map((entry) => entry?.path))

  manifest.files = scanTree(root, ignore, ignoreNames)
    // An ignored file stays out unless the manifest already published it. That keeps
    // `.env.example` — matched by the `.env**` ignore pattern — from silently disappearing on a
    // regeneration, without regeneration ever pulling in something ignored for the first time.
    .filter((entry) => published.has(entry.path) || !matchesAny(entry.path, ignore))
    .filter((entry) => !isRefused(entry.path))
    .map((entry) =>
      entry.type === 'symlink'
        ? { path: entry.path, type: 'symlink', target: entry.target }
        : { path: entry.path }
    )

  writeFileSync(path.join(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const main = () => {
  if (process.argv.includes('--write')) {
    const manifest = writeManifest()
    console.log(`[openship] openship.json lists ${manifest.files.length} files`)
    return
  }

  const problems = verifyManifest(readManifest())
  if (problems.length === 0) {
    console.log('[openship] openship.json agrees with the working tree')
    return
  }

  console.error('[openship] openship.json disagrees with the working tree:')
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`)
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`)
  console.error('[openship] Run `pnpm openship:manifest` to regenerate the file list.')
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
