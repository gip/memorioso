// How a draft arrives at the API and how it is written.
//
// A draft reaches the server in one of two shapes, and the server understands
// neither of them beyond their structure. An encrypted draft is an opaque
// envelope; a plaintext draft is the legacy shape, still accepted for rows
// written before encryption and for the extension's own inline-signing drafts.
//
// The two shapes are mutually exclusive, which the drafts_encryption_shape_check
// constraint also enforces in the database: prose must never survive alongside
// the ciphertext that replaced it.

import { DRAFT_ENCRYPTION_V1 } from '@/lib/draft-crypto'
import { PUBLICATION_SUBTITLE_MAX_LENGTH } from '@/lib/publication-limits'

/** Room for a long article plus base64 overhead, without allowing unbounded rows. */
export const MAX_DRAFT_CIPHERTEXT_LENGTH = 4_000_000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DraftStorageFields =
  | { encryption: 'none'; title: string; subtitle: string | null; content: unknown }
  | { encryption: 'v1'; ciphertext: string }

export type DraftStorageParse =
  | { ok: true; fields: DraftStorageFields }
  | { ok: false; message: string }

export const isDraftId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value)

type DraftBody = {
  encryption?: unknown
  ciphertext?: unknown
  title?: unknown
  subtitle?: unknown
  content?: unknown
}

/**
 * Reads the storable half of a draft request body. Callers get back exactly one
 * of the two shapes, so the write path never has to decide which columns apply.
 */
export function parseDraftStorageFields(body: DraftBody): DraftStorageParse {
  const encryption = body.encryption ?? 'none'

  if (encryption === DRAFT_ENCRYPTION_V1) {
    if (typeof body.ciphertext !== 'string' || body.ciphertext.length === 0) {
      return { ok: false, message: 'Encrypted drafts require ciphertext' }
    }
    if (body.ciphertext.length > MAX_DRAFT_CIPHERTEXT_LENGTH) {
      return { ok: false, message: 'Draft is too large' }
    }
    // Refusing rather than dropping: a client that sends both has a bug, and
    // silently discarding half of a save is the worse failure.
    if (
      (body.title !== undefined && body.title !== null) ||
      (body.subtitle !== undefined && body.subtitle !== null) ||
      (body.content !== undefined && body.content !== null)
    ) {
      return { ok: false, message: 'Encrypted drafts must not carry plaintext' }
    }
    return { ok: true, fields: { encryption: 'v1', ciphertext: body.ciphertext } }
  }

  if (encryption !== 'none') {
    return { ok: false, message: 'Unsupported draft encryption' }
  }

  if (typeof body.title !== 'string') {
    return { ok: false, message: 'Draft title is required' }
  }
  if (body.subtitle !== undefined && body.subtitle !== null && typeof body.subtitle !== 'string') {
    return { ok: false, message: 'Draft subtitle must be a string' }
  }
  if (typeof body.subtitle === 'string' && body.subtitle.length > PUBLICATION_SUBTITLE_MAX_LENGTH) {
    return { ok: false, message: `Draft subtitle must be ${PUBLICATION_SUBTITLE_MAX_LENGTH} characters or fewer` }
  }
  if (typeof body.content !== 'object' || body.content === null) {
    return { ok: false, message: 'Draft content is required' }
  }

  return {
    ok: true,
    fields: {
      encryption: 'none',
      title: body.title,
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
      content: body.content,
    },
  }
}

/** Column values for a draft write, in the order the SQL below expects them. */
export function draftStorageColumns(fields: DraftStorageFields): {
  title: string | null
  subtitle: string | null
  content: unknown
  ciphertext: string | null
  encryption: string
} {
  return fields.encryption === 'v1'
    ? { title: null, subtitle: null, content: null, ciphertext: fields.ciphertext, encryption: 'v1' }
    : {
      title: fields.title,
      subtitle: fields.subtitle,
      content: fields.content,
      ciphertext: null,
      encryption: 'none',
    }
}
