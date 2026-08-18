import type { Pool, PoolClient } from 'pg'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'

export type AuthorProfile = {
  handle: string
  name: string
  bio: string | null
}

export type OwnedAuthor = AuthorProfile & {
  id: string
  isPrimary: boolean
}

type Queryable = Pick<Pool | PoolClient, 'query'>

export class AuthorProfileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorProfileValidationError'
  }
}

export function normalizeAuthorProfile(value: unknown): AuthorProfile {
  if (typeof value !== 'object' || value === null) {
    throw new AuthorProfileValidationError('A valid handle, name, and optional bio are required')
  }

  const raw = value as Record<string, unknown>
  const handle = typeof raw.handle === 'string' ? normalizeUserHandle(raw.handle) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const bio = typeof raw.bio === 'string' ? raw.bio.trim() : ''

  if (!isValidUserHandle(handle)) {
    throw new AuthorProfileValidationError('Handle must be 3-32 lowercase letters, numbers, underscores, or hyphens')
  }
  if (name.length < 3 || name.length > 100) {
    throw new AuthorProfileValidationError('Name must be 3-100 characters')
  }
  if (bio.length > 2000) {
    throw new AuthorProfileValidationError('Bio must be at most 2000 characters')
  }

  return { handle, name, bio: bio || null }
}

export async function getOwnedAuthors(queryable: Queryable, userId: number): Promise<OwnedAuthor[]> {
  const { rows } = await queryable.query(
    `SELECT
       a.id,
       a.name,
       a.handle,
       a.bio,
       (a.handle = u.handle) AS "isPrimary"
     FROM authors a
     INNER JOIN users u ON u.id = a."userId"
     WHERE a."userId" = $1 AND a.handle = u.handle
     ORDER BY a.created_at ASC, a.id ASC`,
    [userId]
  )
  return rows
}

export function isAuthorHandleConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === '23505'
}
