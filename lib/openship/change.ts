// Types and pure computations for a proposed change: normalising paths, applying a patch to the
// base file list, and deriving the digest and buildId of the resulting tree.
//
// Nothing here decides whether a change is permitted. That is lib/openship/validate.ts.

import {
  assertSafePath,
  computeSourcesDigest,
  decodeOpenShipBase64,
  sha256Hex,
} from '@openshipdev/protocol'
import type { OpenshipEncoding, OpenshipFile } from '@/lib/openship/manifest'

export type OpenshipChangeEntry = {
  encoding: OpenshipEncoding
  content: string
}

/** `null` deletes the path. Absent paths are unchanged. */
export type OpenshipChangeFiles = Record<string, OpenshipChangeEntry | null>

export type OpenshipChangeSubmission = {
  openship?: string
  capability?: string
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

export type OpenshipPublicChangeStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'failed'

export const publicChangeStatus = (
  status: OpenshipChangeStatus
): { status: OpenshipPublicChangeStatus; phase?: OpenshipChangeStatus } => {
  switch (status) {
    case 'queued':
      return { status: 'pending', phase: status }
    case 'building':
    case 'reviewing':
      return { status: 'processing', phase: status }
    case 'deployed':
      return { status: 'ready', phase: status }
    case 'rejected':
    case 'failed':
      return { status }
  }
}

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

const sha256 = (input: Buffer | string): string => sha256Hex(
  typeof input === 'string' ? input : new Uint8Array(input)
)

/**
 * The Sources digest: sha256 over `path\0sha256\n` for every file in ascending path
 * order. Computed here from a resulting tree that has never touched disk.
 */
export const digestOfFiles = (files: Pick<OpenshipFile, 'path' | 'sha256'>[]): string =>
  computeSourcesDigest(
    [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))) as OpenshipFile[]
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
/**
 * Rejects anything that is not a plain repository-relative path before it reaches a comparison
 * against the allowlist. A path that normalises to something different from what was submitted is
 * rejected rather than corrected, so no rule ever sees a path the author did not write.
 */
export const normalizePath = (input: string): string | null => {
  try {
    return assertSafePath(input)
  } catch {
    return null
  }
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

  try {
    return Buffer.from(decodeOpenShipBase64(entry.content))
  } catch {
    return null
  }
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
