import { pool } from './index'
import { cache } from 'react'
import { Author, PublicationRecord, Proof, PublicationInfo } from '@/types'
import { extractReadableText } from '@libro/core'
import {
  publicationKindFromTitle,
  type PublicationFeedKind,
  type PublicationKind,
} from '@/lib/publication-kind'

export type { Author, PublicationRecord, Proof, PublicationInfo }

type PublicationRow = {
  signal: Omit<PublicationRecord, 'version'>
  version: string
}

type PublicationInfoRow = {
  id: string
  signal: Omit<PublicationRecord, 'version'>
  proof: Proof
}

export type PublicationBySignalHash = {
  publicationId: string
  publication: PublicationRecord
}

export function mapPublicationRow(row: PublicationRow): PublicationRecord {
  return {
    ...row.signal,
    version: row.version,
  }
}

export function mapPublicationInfoRow(row: PublicationInfoRow): PublicationInfo {
  return {
    id: row.id,
    author_id_libro: row.signal.author_id_libro,
    publication_date: row.signal.publication_date,
    author_name_libro: row.signal.author_name_libro,
    publication_title: row.signal.publication_title,
    publication_subtitle: row.signal.publication_subtitle,
    publication_excerpt: extractReadableText(row.signal.publication_content.html),
    authorship_label: 'proof_type' in row.proof
      && row.proof.proof_type === 'human_authorized_agent_signature'
      ? 'Human-authorized agent'
      : 'Signed by a human',
    publication_type: publicationKindFromTitle(row.signal.publication_title),
  }
}

export const getAuthor = cache(async (authorId: string): Promise<Author | null> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT a.id, a.name, a.bio, a.handle, a."userId"
       FROM authors a
       WHERE a.id = $1`,
      [authorId]
    )

    return rows[0] || null
  } finally {
    client.release()
  }
})

export const getAuthorByHandle = cache(async (handle: string): Promise<Author | null> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT a.id, a.name, a.bio, a.handle, a."userId"
       FROM authors a
       WHERE a.handle = $1`,
      [handle]
    )

    return rows[0] || null
  } finally {
    client.release()
  }
})

export const getAuthors = cache(async (userId: string): Promise<Author[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT a.id, a.name, a.bio 
       FROM authors a
       INNER JOIN users u ON u.id = a."userId"
       WHERE u.name = $1`,
      [userId]
    )

    return rows
  } finally {
    client.release()
  }
})

export const getPublication = cache(async (publicationId: string): Promise<PublicationRecord | null> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT signal, version FROM publications WHERE id = $1',
      [publicationId]
    )

    if (rows.length === 0) {
      return null
    }

    return mapPublicationRow(rows[0])
  } finally {
    client.release()
  }
})

export const getPublicationBySignalHash = cache(async (
  signalHash: string
): Promise<PublicationBySignalHash | null> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, signal, version
       FROM publications
       WHERE LOWER(proof->>'signal_hash') = $1
          OR LOWER(proof->'agent_document_signature'->>'document_signal_hash') = $1
       LIMIT 1`,
      [signalHash]
    )

    if (rows.length === 0) {
      return null
    }

    return {
      publicationId: String(rows[0].id),
      publication: mapPublicationRow(rows[0]),
    }
  } finally {
    client.release()
  }
})

export const getProof = cache(async (publicationId: string): Promise<Proof | null> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT proof FROM publications WHERE id = $1',
      [publicationId]
    )

    if (rows.length === 0) {
      return null
    }

    return rows[0].proof
  } finally {
    client.release()
  }
})

export const getPublicationsByAuthor = cache(async (
  authorId: string,
  limit: number = 20,
  offset: number = 0,
  type: PublicationFeedKind = 'article'
): Promise<PublicationInfo[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, signal, proof
       FROM publications
       WHERE "authorId" = $1
         AND ($4 = 'all'
           OR ($4 = 'article' AND NULLIF(BTRIM(signal->>'publication_title'), '') IS NOT NULL)
           OR ($4 = 'short' AND NULLIF(BTRIM(signal->>'publication_title'), '') IS NULL))
       ORDER BY (signal->>'publication_date')::timestamp DESC
       LIMIT $2 OFFSET $3`,
      [authorId, limit, offset, type]
    )

    return rows.map(mapPublicationInfoRow)
  } finally {
    client.release()
  }
})

export type AuthorPublicationCounts = { article: number; short: number }

export const getAuthorPublicationCounts = cache(async (authorId: string): Promise<AuthorPublicationCounts> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE NULLIF(BTRIM(signal->>'publication_title'), '') IS NOT NULL) AS article,
         COUNT(*) FILTER (WHERE NULLIF(BTRIM(signal->>'publication_title'), '') IS NULL) AS short
       FROM publications
       WHERE "authorId" = $1`,
      [authorId]
    )

    return {
      article: Number(rows[0]?.article ?? 0),
      short: Number(rows[0]?.short ?? 0),
    }
  } finally {
    client.release()
  }
})

export const getLatestPublications = cache(async (
  limit: number = 20,
  offset: number = 0,
  type: PublicationFeedKind = 'article'
): Promise<PublicationInfo[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, signal, proof
       FROM publications
       WHERE $3 = 'all'
          OR ($3 = 'article' AND NULLIF(BTRIM(signal->>'publication_title'), '') IS NOT NULL)
          OR ($3 = 'short' AND NULLIF(BTRIM(signal->>'publication_title'), '') IS NULL)
       ORDER BY (signal->>'publication_date')::timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, type]
    )

    return rows.map(mapPublicationInfoRow)
  } finally {
    client.release()
  }
})

export const getPublicationsByUser = async (
  userId: number,
  limit: number = 5,
  offset: number = 0
): Promise<PublicationInfo[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, signal, proof
       FROM publications
       WHERE "userId" = $1
       ORDER BY (signal->>'publication_date')::timestamp DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )

    return rows.map(mapPublicationInfoRow)
  } finally {
    client.release()
  }
}

// Google caps a single sitemap at 50,000 URLs. Newest publications win if we ever exceed it;
// split with generateSitemaps before that becomes a real ceiling.
export const SITEMAP_MAX_PUBLICATIONS = 40000

export type SitemapPublication = {
  id: string
  kind: PublicationKind
  lastModified: Date
}

export type SitemapAuthor = {
  handle: string
  lastModified: Date
}

export const getSitemapPublications = async (
  limit: number = SITEMAP_MAX_PUBLICATIONS
): Promise<SitemapPublication[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, signal->>'publication_title' AS title, modified_at
       FROM publications
       ORDER BY (signal->>'publication_date')::timestamp DESC
       LIMIT $1`,
      [limit]
    )

    return rows.map((row) => ({
      id: String(row.id),
      kind: publicationKindFromTitle(row.title),
      lastModified: row.modified_at,
    }))
  } finally {
    client.release()
  }
}

// An author page lists that author's publications, so a new publication changes the page
// even when the profile row itself is untouched.
export const getSitemapAuthors = async (): Promise<SitemapAuthor[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT a.handle,
              GREATEST(a.modified_at, COALESCE(MAX(p.modified_at), a.modified_at)) AS modified_at
       FROM authors a
       LEFT JOIN publications p ON p."authorId" = a.id
       GROUP BY a.id, a.handle, a.modified_at
       ORDER BY a.handle`
    )

    return rows.map((row) => ({
      handle: row.handle as string,
      lastModified: row.modified_at,
    }))
  } finally {
    client.release()
  }
}
