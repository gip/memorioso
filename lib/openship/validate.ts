// Gates 1 to 5 of OPENSHIP-CHANGES.md: envelope, paths, size, content, tree.
//
// Every rule here is a pure function of the submission and the base manifest, which is what lets
// the endpoint answer a bad submission immediately instead of queueing a build that will fail. The
// build host re-runs this before building, because the policy may have tightened in between and
// because a gate that only ever runs in one place is a gate with one place to go wrong.
//
// This file is not the security boundary. See "What actually protects the site" in
// OPENSHIP-CHANGES.md.

import {
  applyChange,
  decodeEntry,
  extensionOf,
  normalizePath,
  stripExtension,
  type OpenshipChangeEntry,
  type OpenshipChangeSubmission,
  type ResultingTree,
} from '@/lib/openship/change'
import type { OpenshipFile } from '@/lib/openship/manifest'
import { matchesAny } from '@/lib/openship/paths'
import {
  getProtectedPaths,
  getWritablePaths,
  OPENSHIP_CHANGES_VERSION,
  OPENSHIP_CONTENT_RULES,
  OPENSHIP_LIMITS,
  OPENSHIP_MAX_BASE64_LITERAL,
  OPENSHIP_MEDIA_EXTENSIONS,
  OPENSHIP_TEXT_EXTENSIONS,
} from '@/lib/openship/policy'

export type Violation = {
  /** The gate that rejected it, for the author and for the reviewer's context. */
  gate: 'envelope' | 'path' | 'size' | 'content' | 'tree'
  rule: string
  path?: string
  line?: number
  message: string
}

export type ValidationResult =
  | { ok: true; tree: ResultingTree; patch: Map<string, Buffer | null>; changedPaths: string[] }
  | { ok: false; violations: Violation[] }

const violation = (
  gate: Violation['gate'],
  rule: string,
  message: string,
  extra: { path?: string; line?: number } = {}
): Violation => ({ gate, rule, message, ...extra })

/**
 * A framework resolves `route.ts` and `route.tsx` to the same route, so protection is applied to
 * the extensionless path as well. Without this, `app/api/foo/route.mjs` would sail past a denylist
 * that only knows about the file that exists today.
 */
const isProtected = (filePath: string, patterns: readonly string[]): boolean =>
  matchesAny(filePath, patterns) || matchesAny(stripExtension(filePath), patterns)

const BASE64_LITERAL = /['"`]([A-Za-z0-9+/=]{64,})['"`]/g

const scanContent = (filePath: string, body: Buffer): Violation[] => {
  const found: Violation[] = []
  const text = body.toString('utf8')

  // A file that does not survive a UTF-8 round trip is not source, whatever its extension says.
  if (Buffer.compare(Buffer.from(text, 'utf8'), body) !== 0) {
    return [
      violation('content', 'encoding', 'A text file must be valid UTF-8.', { path: filePath }),
    ]
  }

  const lines = text.split('\n')
  for (const rule of OPENSHIP_CONTENT_RULES) {
    for (let index = 0; index < lines.length; index += 1) {
      if (rule.pattern.test(lines[index])) {
        found.push(
          violation('content', rule.rule, rule.message, { path: filePath, line: index + 1 })
        )
        // One report per rule per file. An author fixing a rule fixes every instance of it.
        break
      }
    }
  }

  BASE64_LITERAL.lastIndex = 0
  let match = BASE64_LITERAL.exec(text)
  while (match) {
    if (match[1].length > OPENSHIP_MAX_BASE64_LITERAL) {
      found.push(
        violation(
          'content',
          'Obfuscation',
          `An encoded literal of ${match[1].length} bytes cannot be reviewed. Add the asset to public/ instead.`,
          { path: filePath, line: text.slice(0, match.index).split('\n').length }
        )
      )
      break
    }
    match = BASE64_LITERAL.exec(text)
  }

  return found
}

const validateEnvelope = (submission: OpenshipChangeSubmission, baseDigest: string): Violation[] => {
  const found: Violation[] = []

  if (submission.openship !== '1.0') {
    found.push(
      violation('envelope', 'openship', `Expected "openship": "1.0"; got ${JSON.stringify(submission.openship)}.`)
    )
  }
  if (typeof submission.base !== 'string' || submission.base.length === 0) {
    found.push(violation('envelope', 'base', 'A submission must carry the manifest digest it applies to.'))
  } else if (submission.base !== baseDigest) {
    found.push(
      violation(
        'envelope',
        'base',
        `This server is serving ${baseDigest}. Re-fetch /openship/manifest.json and rebase.`
      )
    )
  }
  if (typeof submission.title !== 'string' || submission.title.trim().length === 0) {
    found.push(violation('envelope', 'title', 'A submission must carry a title.'))
  } else if (submission.title.length > OPENSHIP_LIMITS.titleChars) {
    found.push(
      violation('envelope', 'title', `A title may be at most ${OPENSHIP_LIMITS.titleChars} characters.`)
    )
  }
  // The reviewer reads this against the diff, so an empty one is not a formality to skip.
  if (typeof submission.intent !== 'string' || submission.intent.trim().length < 20) {
    found.push(
      violation('envelope', 'intent', 'Describe what the change does and why, in at least 20 characters.')
    )
  } else if (submission.intent.length > OPENSHIP_LIMITS.intentChars) {
    found.push(
      violation('envelope', 'intent', `An intent may be at most ${OPENSHIP_LIMITS.intentChars} characters.`)
    )
  }
  if (!submission.files || typeof submission.files !== 'object' || Array.isArray(submission.files)) {
    found.push(violation('envelope', 'files', 'A submission must carry a "files" object.'))
  } else if (Object.keys(submission.files).length === 0) {
    found.push(violation('envelope', 'files', 'A submission must change at least one file.'))
  }

  return found
}

export type ValidateOptions = {
  base: OpenshipFile[]
  baseDigest: string
  mediaTypeOf: (filePath: string) => string
}

/**
 * Runs gates 1 to 5 and stops at the first gate that produced a violation, so an author is not
 * handed content complaints about a file they were never allowed to write in the first place.
 */
export const validateChange = (
  submission: OpenshipChangeSubmission,
  { base, baseDigest, mediaTypeOf }: ValidateOptions
): ValidationResult => {
  const envelope = validateEnvelope(submission, baseDigest)
  if (envelope.length > 0) return { ok: false, violations: envelope }

  const files = submission.files as Record<string, OpenshipChangeEntry | null>
  const entries = Object.entries(files)
  const writable = getWritablePaths()
  const protectedPaths = getProtectedPaths()
  const basePaths = new Set(base.map((file) => file.path))

  // Gate 2: paths.
  const pathViolations: Violation[] = []
  const normalized: { path: string; entry: OpenshipChangeEntry | null }[] = []
  const seenStems = new Map<string, string>()

  for (const [rawPath, entry] of entries) {
    const filePath = normalizePath(rawPath)
    if (!filePath) {
      pathViolations.push(
        violation('path', 'shape', 'Not a repository-relative path.', { path: rawPath })
      )
      continue
    }
    if (isProtected(filePath, protectedPaths)) {
      pathViolations.push(
        violation('path', 'protected', 'This path is protected. See OPENSHIP-CHANGES.md.', {
          path: filePath,
        })
      )
      continue
    }
    if (!matchesAny(filePath, writable)) {
      pathViolations.push(
        violation('path', 'writable', `Outside the writable set (${writable.join(', ')}).`, {
          path: filePath,
        })
      )
      continue
    }

    const extension = extensionOf(filePath)
    const isText = (OPENSHIP_TEXT_EXTENSIONS as readonly string[]).includes(extension)
    if (entry !== null) {
      if (filePath.startsWith('public/')) {
        if (!(OPENSHIP_MEDIA_EXTENSIONS as readonly string[]).includes(extension)) {
          pathViolations.push(
            violation('path', 'media', `public/ accepts ${OPENSHIP_MEDIA_EXTENSIONS.join(', ')}.`, {
              path: filePath,
            })
          )
          continue
        }
      } else if (!isText) {
        pathViolations.push(
          violation('path', 'extension', `${extension || 'This file'} is not source. Put assets in public/.`, {
            path: filePath,
          })
        )
        continue
      }
    }

    // Two submitted paths that differ only by extension resolve to one route.
    const stem = stripExtension(filePath)
    const rival = seenStems.get(stem)
    if (rival && entry !== null) {
      pathViolations.push(
        violation('path', 'shadowing', `Resolves to the same route as ${rival}.`, { path: filePath })
      )
      continue
    }
    if (entry !== null) seenStems.set(stem, filePath)

    normalized.push({ path: filePath, entry })
  }

  if (pathViolations.length > 0) return { ok: false, violations: pathViolations }

  if (normalized.length > OPENSHIP_LIMITS.filesPerChange) {
    return {
      ok: false,
      violations: [
        violation(
          'size',
          'filesPerChange',
          `${normalized.length} files changed; the limit is ${OPENSHIP_LIMITS.filesPerChange}. Split the change.`
        ),
      ],
    }
  }

  // Gate 3: size, and the decode that size depends on.
  const sizeViolations: Violation[] = []
  const patch = new Map<string, Buffer | null>()
  let totalBytes = 0

  for (const { path: filePath, entry } of normalized) {
    if (entry === null) {
      if (!basePaths.has(filePath)) {
        sizeViolations.push(
          violation('tree', 'deletion', 'Cannot delete a file that is not in the base tree.', {
            path: filePath,
          })
        )
        continue
      }
      patch.set(filePath, null)
      continue
    }

    const body = decodeEntry(entry)
    if (!body) {
      sizeViolations.push(
        violation('envelope', 'encoding', 'Content does not decode as the declared encoding.', {
          path: filePath,
        })
      )
      continue
    }
    if (body.length > OPENSHIP_LIMITS.bytesPerFile) {
      sizeViolations.push(
        violation('size', 'bytesPerFile', `${body.length} bytes; the limit is ${OPENSHIP_LIMITS.bytesPerFile}.`, {
          path: filePath,
        })
      )
      continue
    }
    totalBytes += body.length
    patch.set(filePath, body)
  }

  if (sizeViolations.length > 0) return { ok: false, violations: sizeViolations }

  if (totalBytes > OPENSHIP_LIMITS.bytesPerChange) {
    return {
      ok: false,
      violations: [
        violation('size', 'bytesPerChange', `${totalBytes} bytes; the limit is ${OPENSHIP_LIMITS.bytesPerChange}.`),
      ],
    }
  }

  // Gate 4: content. Media files under public/ are exempt unless they are SVG, which is a script
  // host and is therefore scanned like any other source file.
  const contentViolations: Violation[] = []
  for (const [filePath, body] of patch) {
    if (body === null) continue
    const extension = extensionOf(filePath)
    if (!(OPENSHIP_TEXT_EXTENSIONS as readonly string[]).includes(extension)) continue
    contentViolations.push(...scanContent(filePath, body))
  }

  if (contentViolations.length > 0) return { ok: false, violations: contentViolations }

  // Gate 5: tree.
  const tree = applyChange(base, patch, mediaTypeOf)

  const treeViolations: Violation[] = []
  if (tree.files.length > OPENSHIP_LIMITS.filesInTree) {
    treeViolations.push(
      violation('tree', 'filesInTree', `${tree.files.length} files; the limit is ${OPENSHIP_LIMITS.filesInTree}.`)
    )
  }
  if (tree.addedBytes - tree.removedBytes > OPENSHIP_LIMITS.treeGrowthBytes) {
    treeViolations.push(
      violation(
        'tree',
        'treeGrowthBytes',
        `The tree grows by ${tree.addedBytes - tree.removedBytes} bytes; the limit is ${OPENSHIP_LIMITS.treeGrowthBytes}.`
      )
    )
  }
  if (tree.digest === baseDigest) {
    treeViolations.push(violation('tree', 'noop', 'The resulting tree is identical to the base.'))
  }

  if (treeViolations.length > 0) return { ok: false, violations: treeViolations }

  return { ok: true, tree, patch, changedPaths: [...patch.keys()].sort() }
}

export const OPENSHIP_CHANGES = OPENSHIP_CHANGES_VERSION
