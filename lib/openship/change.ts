// Types and pure computations for a proposed change: normalising paths, applying a patch to the
// base file list, and deriving the digest and buildId of the resulting tree.
//
// Nothing here decides whether a change is permitted. That is lib/openship/validate.ts.

import { createHash } from 'node:crypto'
import type { OpenshipEncoding, OpenshipFile } from '@/lib/openship/manifest'

export type OpenshipChangeEntry = {
  encoding: OpenshipEncoding
  content: string
}

/** `null` deletes the path. Absent paths are unchanged. */
export type OpenshipChangeFiles = Record<string, OpenshipChangeEntry | null>

export type OpenshipChangeSubmission = {
  openship?: string
  base?: string
  title?: string
  intent?: string
  files?: OpenshipChangeFiles
}

export type OpenshipChangeStatus =
  | 'queued'
  | 'building'
  | 'reviewing'
  | 'deployed'
  | 'rejected'
  | 'failed'

export type OpenshipChangeRecord = {
  changeId: string
  buildId: string
  base: string
  digest: string
  title: string
  intent: string
  status: OpenshipChangeStatus
  reason: string | null
  url: string | null
  filesChanged: number
  bytes: number
  submittedAt: string
  updatedAt: string
}

const sha256 = (input: Buffer | string): string => createHash('sha256').update(input).digest('hex')

/**
 * The digest defined in OPENSHIP.md: sha256 over `path\0sha256\n` for every file in ascending path
 * order. Computed here from a resulting tree that has never touched disk.
 */
export const digestOfFiles = (files: Pick<OpenshipFile, 'path' | 'sha256'>[]): string =>
  'sha256:' +
  sha256(
    [...files]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      .map((file) => `${file.path}\0${file.sha256}\n`)
      .join('')
  )

/**
 * The subdomain a change deploys to. Content-addressed, so the same tree always lands on the same
 * origin and an author can verify the URL by recomputing the digest of what it serves.
 *
 * Twelve hex characters: long enough that collisions are not a practical concern for a review
 * queue, short enough to type.
 */
export const buildIdOf = (digest: string): string => digest.replace(/^sha256:/, '').slice(0, 12)

// Repository paths are ASCII, and deliberately narrow. An allowlist avoids having to enumerate
// the control characters, backslashes, and separators that mean one thing to this check and
// another to a filesystem: anything not named here is simply not a path.
const SAFE_PATH = /^[A-Za-z0-9._@+()\[\]-]+(?:\/[A-Za-z0-9._@+()\[\]-]+)*$/

/**
 * Rejects anything that is not a plain repository-relative path before it reaches a comparison
 * against the allowlist. A path that normalises to something different from what was submitted is
 * rejected rather than corrected, so no rule ever sees a path the author did not write.
 */
export const normalizePath = (input: string): string | null => {
  if (typeof input !== 'string' || input.length === 0 || input.length > 512) return null
  if (input !== input.normalize('NFC')) return null
  if (!SAFE_PATH.test(input)) return null
  // SAFE_PATH already excludes empty segments and a leading or trailing slash, but `.` and `..` are
  // made of characters it allows, so they still have to be named.
  const segments = input.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return input
}

/** The path with its final extension removed, used to catch `route.ts` shadowing `route.tsx`. */
export const stripExtension = (filePath: string): string => filePath.replace(/\.[^./]+$/, '')

export const extensionOf = (filePath: string): string => {
  const match = /\.[^./]+$/.exec(filePath)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Decodes a submitted entry, or returns null if the encoding does not round trip. Buffer.from is
 * lenient with base64 — it discards characters it does not recognise rather than failing — so the
 * round trip is the only way to know the client sent what it meant to.
 */
export const decodeEntry = (entry: OpenshipChangeEntry): Buffer | null => {
  if (!entry || typeof entry.content !== 'string') return null
  if (entry.encoding === 'utf-8') return Buffer.from(entry.content, 'utf8')
  if (entry.encoding !== 'base64') return null

  const decoded = Buffer.from(entry.content, 'base64')
  const stripped = entry.content.replace(/\s+/g, '')
  const canonical = decoded.toString('base64')
  if (stripped === canonical) return decoded
  // Accept unpadded base64, which is what several HTTP clients emit.
  if (stripped === canonical.replace(/=+$/, '')) return decoded
  return null
}

export type ResultingTree = {
  files: OpenshipFile[]
  digest: string
  buildId: string
  addedBytes: number
  removedBytes: number
}

/**
 * Applies the patch to the base manifest's file list and derives the resulting tree. The content of
 * unchanged files is never needed: their hashes already stand in the base manifest.
 */
export const applyChange = (
  base: OpenshipFile[],
  patch: Map<string, Buffer | null>,
  mediaTypeOf: (filePath: string) => string
): ResultingTree => {
  const byPath = new Map(base.map((file) => [file.path, file]))
  let addedBytes = 0
  let removedBytes = 0

  for (const [filePath, body] of patch) {
    const existing = byPath.get(filePath)
    if (body === null) {
      if (existing) removedBytes += existing.size
      byPath.delete(filePath)
      continue
    }
    if (existing) removedBytes += existing.size
    addedBytes += body.length
    byPath.set(filePath, {
      path: filePath,
      size: body.length,
      sha256: sha256(body),
      encoding: body.includes(0) ? 'base64' : 'utf-8',
      mediaType: mediaTypeOf(filePath),
      // A change never produces a symlink: the patch carries bytes, not link targets.
      type: 'file',
    })
  }

  const files = [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
  const digest = digestOfFiles(files)

  return { files, digest, buildId: buildIdOf(digest), addedBytes, removedBytes }
}

export type OpenshipEncodingName = OpenshipEncoding
