import {
  extractReadableText,
  parseLibroPublication,
  parseLegacyPublication,
  type LibroPublicationRecord,
  type LibroPublicationSummary,
} from '@libro/core'
import { pool } from './db'

const EXCERPT_MAX = 240

export function publicationExcerpt(html: string): string {
  const text = extractReadableText(html)
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text
}

function record(row: Record<string, unknown>): LibroPublicationRecord {
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    identityId: row.identity_id == null ? null : String(row.identity_id),
    signalHash: String(row.signal_hash) as `0x${string}`,
    authorshipClass: row.authorship_class === 'agent' ? 'agent' : 'human',
    legacyProof: row.legacy_proof === true,
    signal: row.legacy_proof === true ? parseLegacyPublication(row.signal) : parseLibroPublication(row.signal),
    proof: row.proof,
    version: String(row.version),
    originClientId: row.origin_client_id ? String(row.origin_client_id) : null,
    clientReference: row.client_reference ? String(row.client_reference) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    modifiedAt: new Date(String(row.modified_at)).toISOString(),
  }
}

function summary(row: Record<string, unknown>): LibroPublicationSummary {
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    signalHash: String(row.signal_hash) as `0x${string}`,
    authorshipClass: row.authorship_class === 'agent' ? 'agent' : 'human',
    legacyProof: row.legacy_proof === true,
    publicationDate: String(row.publication_date),
    authorName: String(row.author_name),
    title: String(row.publication_title),
    subtitle: String(row.publication_subtitle ?? ''),
    excerpt: String(row.feed_excerpt),
    publicationType: String(row.publication_title).trim() ? 'article' : 'short',
    modifiedAt: new Date(String(row.modified_at)).toISOString(),
  }
}

export async function getPublication(id: string): Promise<LibroPublicationRecord | null> {
  const result = await pool.query('SELECT * FROM libro_publications WHERE id = $1', [id])
  return result.rows[0] ? record(result.rows[0]) : null
}

export async function getPublicationBySignal(signalHash: string): Promise<LibroPublicationRecord | null> {
  const result = await pool.query(
    'SELECT * FROM libro_publications WHERE LOWER(signal_hash) = LOWER($1)',
    [signalHash],
  )
  return result.rows[0] ? record(result.rows[0]) : null
}

export async function listPublications(input: {
  limit: number
  offset: number
  authorId?: string
  originClientId?: string
  kind?: 'article' | 'short' | 'all'
}): Promise<LibroPublicationSummary[]> {
  const result = await pool.query(
    `SELECT id, author_id, signal_hash, authorship_class, legacy_proof, modified_at,
       signal->>'publication_date' AS publication_date,
       signal->>'author_name_libro' AS author_name,
       signal->>'publication_title' AS publication_title,
       signal->>'publication_subtitle' AS publication_subtitle,
       feed_excerpt,
       CASE WHEN feed_excerpt IS NULL THEN signal->'publication_content'->>'html' END AS excerpt_html
     FROM libro_publications
     WHERE ($3::uuid IS NULL OR author_id = $3)
       AND ($4::text IS NULL OR origin_client_id = $4)
       AND ($5 = 'all'
         OR ($5 = 'article' AND NULLIF(BTRIM(title), '') IS NOT NULL)
         OR ($5 = 'short' AND NULLIF(BTRIM(title), '') IS NULL))
     ORDER BY date DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [input.limit, input.offset, input.authorId || null, input.originClientId || null, input.kind || 'all'],
  )
  // Old deployments and the copy command may leave this projection empty. Fill it
  // from the exact original HTML once, without changing signed data or dates.
  const missing = result.rows.filter((row) => row.feed_excerpt === null)
  for (const row of missing) row.feed_excerpt = publicationExcerpt(row.excerpt_html)
  if (missing.length) {
    await pool.query(
      `UPDATE libro_publications p SET feed_excerpt = summary.excerpt
       FROM UNNEST($1::bigint[], $2::text[], $3::text[]) AS summary(id, excerpt, signal_hash)
       WHERE p.id = summary.id AND p.signal_hash = summary.signal_hash AND p.feed_excerpt IS NULL`,
      [missing.map((row) => String(row.id)), missing.map((row) => row.feed_excerpt), missing.map((row) => row.signal_hash)],
    )
  }
  return result.rows.map(summary)
}

export async function getAuthor(idOrHandle: string) {
  const result = await pool.query(
    `SELECT id, name, handle, bio, identity_id, created_at, modified_at
     FROM libro_authors
     WHERE id::text = $1 OR handle = LOWER($1)
     LIMIT 1`,
    [idOrHandle],
  )
  return result.rows[0] || null
}
