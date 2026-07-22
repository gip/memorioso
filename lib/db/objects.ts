import { pool } from './index'
import { cache } from 'react'
import { Author, PublicationRecord, Proof, PublicationInfo } from '@/types'

export type { Author, PublicationRecord, Proof, PublicationInfo }

type PublicationRow = {
  signal: Omit<PublicationRecord, 'version'>
  version: string
}

export function mapPublicationRow(row: PublicationRow): PublicationRecord {
  return {
    ...row.signal,
    version: row.version,
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

export const getPublicationInfoByAuthor = cache(async (authorId: string): Promise<PublicationInfo[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT id, signal FROM publications WHERE "authorId" = $1 ORDER BY id DESC LIMIT 21',
      [authorId]
    )

    // TODO: Not efficient - we need to fix this
    return rows.map(row => ({
      id: row.id,
      author_id_libro: row.signal.author_id_libro,
      publication_date: row.signal.publication_date,
      author_name_libro: row.signal.author_name_libro,
      publication_title: row.signal.publication_title,
      publication_subtitle: row.signal.publication_subtitle
    }))
  } finally {
    client.release()
  }
})

export const getLatestPublications = cache(async (limit: number = 20): Promise<PublicationInfo[]> => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT id, signal FROM publications ORDER BY (signal->>\'publication_date\')::timestamp DESC LIMIT $1',
      [limit]
    )

    return rows.map(row => ({
      id: row.id,
      author_id_libro: row.signal.author_id_libro,
      publication_date: row.signal.publication_date,
      author_name_libro: row.signal.author_name_libro,
      publication_title: row.signal.publication_title,
      publication_subtitle: row.signal.publication_subtitle
    }))
  } finally {
    client.release()
  }
})
