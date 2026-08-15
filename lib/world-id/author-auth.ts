import type { IDKitResult } from '@worldcoin/idkit'
import type { PoolClient } from 'pg'
import { pool } from '@/lib/db'
import { normalizeUserHandle } from '@/lib/handle'
import { AuthorProfileValidationError, normalizeAuthorProfile } from '@/lib/authors'
import {
  validateSessionCredentialResponses,
  validateWorldIdSessionResult,
  sessionIdToCommitment,
} from '@/lib/world-id/proof'
import { getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'

export type WorldIdAuthorAuthIntent = 'login' | 'signup'

export type WorldIdAuthorProfile = {
  handle: string
  name: string
  bio: string | null
}

export type WorldIdAuthorAuthUser = {
  id: number
  subject: string
  handle: string
  worldIdSessionId: string
  worldIdCredentialIdentifier: string | null
}

export type WorldIdAuthor = {
  id: string
  name: string
  handle: string
  bio: string | null
}

export type WorldIdAuthorAuthResult<TTransport = undefined> = {
  user: WorldIdAuthorAuthUser
  author: WorldIdAuthor
  created: boolean
  transport: TTransport
}

export class WorldIdAuthorAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly verifierResponse?: unknown,
  ) {
    super(message)
    this.name = 'WorldIdAuthorAuthError'
  }
}

export type WorldIdAuthorAuthInput = {
  idkitResult: unknown
  nonce: string
  intent: WorldIdAuthorAuthIntent
  profile?: unknown
  expectedHandle?: string
  expectedUserId?: number
  expectedWorldIdSessionId?: string
}

type WorldIdAuthorAuthHooks<TTransport> = {
  beforeAccountWrite?: (client: PoolClient) => Promise<void>
  afterAccountWrite?: (
    client: PoolClient,
    result: Omit<WorldIdAuthorAuthResult<TTransport>, 'transport'>,
  ) => Promise<TTransport>
}

type VerifiedWorldIdIdentity = {
  subject: string
  worldIdSessionId: string
  sessionNullifier: string
  sessionCommitment: string
  credentialIdentifier: string
}

function parseIdKitResult(payload: unknown): IDKitResult {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as IDKitResult
  }
  return payload as IDKitResult
}

export function normalizeWorldIdAuthorProfile(value: unknown): WorldIdAuthorProfile {
  try {
    return normalizeAuthorProfile(value)
  } catch (error) {
    throw new WorldIdAuthorAuthError(
      error instanceof AuthorProfileValidationError
        ? error.message
        : 'A valid handle, name, and optional bio are required to create an author',
      400,
      'INVALID_PROFILE',
    )
  }
}

async function verifyIdentity(input: WorldIdAuthorAuthInput): Promise<VerifiedWorldIdIdentity> {
  let config
  try {
    config = getWorldIdServerConfig()
  } catch (error) {
    throw new WorldIdAuthorAuthError(
      error instanceof Error ? error.message : 'World ID configuration is invalid',
      500,
      'CONFIG_ERROR',
    )
  }

  let validatedResult
  let credentialIdentifiers: string[]
  try {
    validatedResult = validateWorldIdSessionResult(parseIdKitResult(input.idkitResult), {
      nonce: input.nonce,
      environment: config.environment,
    })
    credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses)
    if (
      input.expectedWorldIdSessionId &&
      validatedResult.session_id !== input.expectedWorldIdSessionId
    ) {
      throw new Error('World ID session does not match this Memorioso author')
    }
  } catch (error) {
    throw new WorldIdAuthorAuthError(
      error instanceof Error ? error.message : 'World ID login proof is invalid',
      400,
      'INVALID_PROOF',
    )
  }

  let verifier
  try {
    verifier = await verifyWorldIdProof(validatedResult, config.rpId)
  } catch {
    throw new WorldIdAuthorAuthError(
      'World ID verifier could not be reached',
      502,
      'VERIFIER_UNAVAILABLE',
    )
  }
  if (!verifier.ok) {
    throw new WorldIdAuthorAuthError(
      'World ID verifier rejected the login proof',
      401,
      'VERIFIER_REJECTED',
      verifier.body,
    )
  }

  return {
    subject: `world-id-session:${validatedResult.session_id}`,
    worldIdSessionId: validatedResult.session_id,
    sessionCommitment: sessionIdToCommitment(validatedResult.session_id),
    sessionNullifier: validatedResult.responses[0].session_nullifier[0],
    credentialIdentifier: credentialIdentifiers[0],
  }
}

async function connectExistingAuthor(
  client: PoolClient,
  identity: VerifiedWorldIdIdentity,
  expectedUserId?: number,
): Promise<Omit<WorldIdAuthorAuthResult, 'transport'>> {
  const userResult = expectedUserId === undefined
    ? await client.query(
      `UPDATE users
       SET world_id_session_nullifier = $2,
           world_id_credential_identifier = $3,
           world_id_session_commitment = $4,
           libro_identity_status = 'session_bound',
           modified_at = CURRENT_TIMESTAMP
       WHERE world_id_session_id = $1
       RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
      [identity.worldIdSessionId, identity.sessionNullifier, identity.credentialIdentifier, identity.sessionCommitment]
    )
    : await client.query(
      `UPDATE users
       SET world_id_session_nullifier = $2,
           world_id_credential_identifier = $3,
           world_id_session_commitment = $5,
           libro_identity_status = 'session_bound',
           modified_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND world_id_session_id = $4
       RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
      [expectedUserId, identity.sessionNullifier, identity.credentialIdentifier, identity.worldIdSessionId, identity.sessionCommitment]
    )

  if (userResult.rows.length === 0) {
    throw new WorldIdAuthorAuthError(
      'That World ID is not linked to a Memorioso author',
      409,
      'AUTHOR_NOT_FOUND',
    )
  }

  const user = userResult.rows[0]
  const authorResult = await client.query(
    `SELECT a.id, a.name, a.handle, a.bio
     FROM authors a
     INNER JOIN users u ON u.id = a."userId"
     WHERE a."userId" = $1 AND a.handle = u.handle`,
    [user.id]
  )
  if (authorResult.rows.length === 0) {
    throw new WorldIdAuthorAuthError(
      'This Memorioso account has no author',
      409,
      'AUTHOR_NOT_FOUND',
    )
  }

  return {
    user: {
      id: user.id,
      subject: user.name || identity.subject,
      handle: user.handle,
      worldIdSessionId: user.world_id_session_id,
      worldIdCredentialIdentifier: user.world_id_credential_identifier,
    },
    author: authorResult.rows[0],
    created: false,
  }
}

async function createOrConnectAuthor(
  client: PoolClient,
  identity: VerifiedWorldIdIdentity,
  profile: WorldIdAuthorProfile,
): Promise<Omit<WorldIdAuthorAuthResult, 'transport'>> {
  let user
  let author
  let created = false

  const existingUserResult = await client.query(
    `SELECT id, name, handle, world_id_session_id, world_id_credential_identifier
     FROM users
     WHERE world_id_session_id = $1
     FOR UPDATE`,
    [identity.worldIdSessionId]
  )

  if (existingUserResult.rows.length > 0) {
    user = existingUserResult.rows[0]
    const existingAuthorResult = await client.query(
      `SELECT a.id, a.name, a.handle, a.bio
       FROM authors a
       INNER JOIN users u ON u.id = a."userId"
       WHERE a."userId" = $1 AND a.handle = u.handle
       FOR UPDATE OF a`,
      [user.id]
    )

    if (existingAuthorResult.rows.length > 0) {
      author = existingAuthorResult.rows[0]
      const updatedUser = await client.query(
        `UPDATE users
         SET handle = COALESCE(handle, $2),
             world_id_session_nullifier = $3,
             world_id_credential_identifier = $4,
             world_id_session_commitment = $5,
             libro_identity_status = 'session_bound',
             modified_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
        [user.id, author.handle, identity.sessionNullifier, identity.credentialIdentifier, identity.sessionCommitment]
      )
      user = updatedUser.rows[0]
    } else if (user.handle) {
      const authorResult = await client.query(
        `INSERT INTO authors ("userId", name, handle, bio)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, handle, bio`,
        [user.id, profile.name, user.handle, profile.bio]
      )
      author = authorResult.rows[0]
      const updatedUser = await client.query(
        `UPDATE users
         SET world_id_session_nullifier = $2,
             world_id_credential_identifier = $3,
             world_id_session_commitment = $4,
             libro_identity_status = 'session_bound',
             modified_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
        [user.id, identity.sessionNullifier, identity.credentialIdentifier, identity.sessionCommitment]
      )
      user = updatedUser.rows[0]
    } else {
      const claimedUser = await client.query(
        `UPDATE users
         SET handle = $2,
             world_id_session_nullifier = $3,
             world_id_credential_identifier = $4,
             world_id_session_commitment = $5,
             libro_identity_status = 'session_bound',
             modified_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND handle IS NULL
         RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
        [user.id, profile.handle, identity.sessionNullifier, identity.credentialIdentifier, identity.sessionCommitment]
      )
      user = claimedUser.rows[0]
      const authorResult = await client.query(
        `INSERT INTO authors ("userId", name, handle, bio)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, handle, bio`,
        [user.id, profile.name, profile.handle, profile.bio]
      )
      author = authorResult.rows[0]
      created = true
    }
  } else {
    const userResult = await client.query(
      `INSERT INTO users
        (name, handle, world_id_session_id, world_id_session_commitment, world_id_session_nullifier, world_id_credential_identifier)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
      [
        identity.subject,
        profile.handle,
        identity.worldIdSessionId,
        identity.sessionCommitment,
        identity.sessionNullifier,
        identity.credentialIdentifier,
      ]
    )
    user = userResult.rows[0]
    const authorResult = await client.query(
      `INSERT INTO authors ("userId", name, handle, bio)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, handle, bio`,
      [user.id, profile.name, profile.handle, profile.bio]
    )
    author = authorResult.rows[0]
    created = true
  }

  return {
    user: {
      id: user.id,
      subject: user.name || identity.subject,
      handle: user.handle,
      worldIdSessionId: user.world_id_session_id,
      worldIdCredentialIdentifier: user.world_id_credential_identifier,
    },
    author,
    created,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: string }).code === '23505'
}

export async function verifyAndCreateOrConnectAuthor<TTransport = undefined>(
  input: WorldIdAuthorAuthInput,
  hooks: WorldIdAuthorAuthHooks<TTransport> = {},
): Promise<WorldIdAuthorAuthResult<TTransport>> {
  const profile = input.intent === 'signup'
    ? normalizeWorldIdAuthorProfile(input.profile)
    : null
  if (profile && input.expectedHandle && profile.handle !== normalizeUserHandle(input.expectedHandle)) {
    throw new WorldIdAuthorAuthError(
      'The signup handle does not match the requested extension handle',
      400,
      'HANDLE_MISMATCH',
    )
  }
  const identity = await verifyIdentity(input)
  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true
    await hooks.beforeAccountWrite?.(client)

    const accountResult = input.intent === 'login'
      ? await connectExistingAuthor(client, identity, input.expectedUserId)
      : await createOrConnectAuthor(client, identity, profile!)
    const transport = hooks.afterAccountWrite
      ? await hooks.afterAccountWrite(client, accountResult)
      : undefined as TTransport

    await client.query('COMMIT')
    transactionOpen = false
    return { ...accountResult, transport }
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK')
    }
    if (error instanceof WorldIdAuthorAuthError) {
      throw error
    }
    if (isUniqueViolation(error)) {
      throw new WorldIdAuthorAuthError(
        'That handle was just taken. Please choose another one.',
        409,
        'HANDLE_TAKEN',
      )
    }
    throw new WorldIdAuthorAuthError(
      'Failed to authenticate the Memorioso author',
      500,
      'DATABASE_ERROR',
    )
  } finally {
    client.release()
  }
}
