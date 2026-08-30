import {
  extractReadableText,
  parseLibroPublication,
  type LibroPublicationRecord,
  type LibroPublicationSummary,
} from '@libro/core'
import { pool } from './db'

const EXCERPT_MAX = 240

function record(row: Record<string, unknown>): LibroPublicationRecord {
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    identityId: String(row.identity_id),
    signalHash: String(row.signal_hash) as `0x${string}`,
    authorshipClass: row.authorship_class === 'agent' ? 'agent' : 'human',
    signal: parseLibroPublication(row.signal),
    proof: row.proof,
    version: String(row.version),
    originClientId: row.origin_client_id ? String(row.origin_client_id) : null,
    clientReference: row.client_reference ? String(row.client_reference) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    modifiedAt: new Date(String(row.modified_at)).toISOString(),
  }
}

function summary(row: Record<string, unknown>): LibroPublicationSummary {
  const signal = parseLibroPublication(row.signal)
  const text = extractReadableText(signal.publication_content.html)
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    signalHash: String(row.signal_hash) as `0x${string}`,
    authorshipClass: row.authorship_class === 'agent' ? 'agent' : 'human',
    publicationDate: signal.publication_date,
    authorName: signal.author_name_libro,
    title: signal.publication_title,
    subtitle: signal.publication_subtitle,
    excerpt: text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text,
    publicationType: signal.publication_title.trim() ? 'article' : 'short',
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
    `SELECT * FROM libro_publications
     WHERE ($3::uuid IS NULL OR author_id = $3)
       AND ($4::text IS NULL OR origin_client_id = $4)
       AND ($5 = 'all'
         OR ($5 = 'article' AND NULLIF(BTRIM(title), '') IS NOT NULL)
         OR ($5 = 'short' AND NULLIF(BTRIM(title), '') IS NULL))
     ORDER BY date DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [input.limit, input.offset, input.authorId || null, input.originClientId || null, input.kind || 'all'],
  )
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
