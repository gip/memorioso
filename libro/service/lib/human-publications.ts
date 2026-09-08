import {
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
  LIBRO_PUBLICATION_SCHEMA_V1,
  canonicalPublicationSignal,
  hashPublicationSignal,
  parseLibroAuthorReference,
  parseLibroPublication,
  type LibroHumanPublicationPayload,
} from '@libro/core'
import { pool } from './db'
import { defaultAuthorNamespace, browserUrl, signingCapabilitySecret } from './config'
import { deriveCapability, randomHex, sha256 } from './crypto'
import { randomUUID } from 'node:crypto'
import { assertWritesEnabled, ServiceError } from './errors'
import type { OAuthPrincipal } from './oauth'

const CHALLENGE_TTL_SECONDS = 5 * 60

function assertPublicationDate(date: string): void {
  const value = new Date(date).getTime()
  const now = Date.now()
  if (!Number.isFinite(value) || value > now || value < now - 5 * 60_000) {
    throw new ServiceError('PUBLICATION_DATE_INVALID', 'Publication date must be within the last five minutes', 400)
  }
}

function expectedReference(principal: OAuthPrincipal) {
  return {
    namespace: principal.authorNamespace || defaultAuthorNamespace(),
    id: principal.authorId,
  }
}

function assertHumanPublication(principal: OAuthPrincipal, value: unknown): LibroHumanPublicationPayload {
  let publication
  try {
    publication = parseLibroPublication(value)
  } catch (error) {
    throw new ServiceError('INVALID_PUBLICATION', error instanceof Error ? error.message : 'Publication is invalid', 400)
  }
  if (
    publication.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V1
    || publication.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V2
  ) {
    throw new ServiceError('INVALID_PUBLICATION', 'Agent publications require agent-key authority', 400)
  }
  if (publication.author_handle_libro !== principal.handle || publication.author_name_libro !== principal.name) {
    throw new ServiceError('AUTHOR_MISMATCH', 'Publication author does not match the OAuth identity', 403)
  }
  if (publication.publication_schema === LIBRO_PUBLICATION_SCHEMA_V1) {
    if (publication.author_id_libro !== principal.authorId) {
      throw new ServiceError('AUTHOR_MISMATCH', 'Legacy publication author id does not match the OAuth identity', 403)
    }
  } else {
    const expected = expectedReference(principal)
    const actual = publication.author_reference ? parseLibroAuthorReference(publication.author_reference) : undefined
    if (!actual || actual.namespace !== expected.namespace || actual.id !== expected.id) {
      throw new ServiceError('NAMESPACE_MISMATCH', 'Publication author reference does not match the client namespace', 403)
    }
  }
  assertPublicationDate(publication.publication_date)
  return publication
}

export async function createHumanChallenge(input: {
  principal: OAuthPrincipal
  publication: unknown
  clientReference?: string | null
}) {
  assertWritesEnabled()
  const publication = assertHumanPublication(input.principal, input.publication)
  const signalText = canonicalPublicationSignal(publication)
  const signalHash = hashPublicationSignal(signalText)
  const challengeId = randomUUID()
  const capability = deriveCapability(challengeId, signingCapabilitySecret())
  const existing = input.clientReference
    ? await pool.query(
      `SELECT id, signal_hash, signing_capability_hash FROM libro_publish_challenges
       WHERE identity_id = $1 AND origin_client_id = $2 AND client_reference = $3
       ORDER BY created_at DESC LIMIT 1`,
      [input.principal.identityId, input.principal.clientId, input.clientReference],
    )
    : { rows: [] }
  if (existing.rows[0]) {
    if (existing.rows[0].signal_hash.toLowerCase() !== signalHash.toLowerCase()) {
      throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Client reference was already used for a different publication', 409)
    }
    const existingCapability = deriveCapability(existing.rows[0].id, signingCapabilitySecret())
    return {
      challengeId: existing.rows[0].id,
      signalHash,
      signingUrl: browserUrl(`/sign/${existingCapability}`),
      existing: true,
    }
  }
  const result = await pool.query(
    `INSERT INTO libro_publish_challenges
      (id, identity_id, author_id, origin_client_id, client_reference, nonce, session_commitment,
       signal_text, signal_hash, publication, signing_capability_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       CURRENT_TIMESTAMP + ($12 * INTERVAL '1 second'))
     RETURNING id`,
    [
      challengeId, input.principal.identityId, input.principal.authorId, input.principal.clientId,
      input.clientReference || null, randomHex(),
      input.principal.sessionCommitment, signalText, signalHash, publication, sha256(capability),
      CHALLENGE_TTL_SECONDS,
    ],
  )
  return {
    challengeId: result.rows[0].id as string,
    signalHash,
    signingUrl: browserUrl(`/sign/${capability}`),
    existing: false,
  }
}

export async function publicationStatus(input: {
  principal: OAuthPrincipal
  challengeId: string
}) {
  const result = await pool.query(
    `SELECT c.id, c.signal_hash, c.expires_at, c.consumed_at, r.id AS registration_id,
       r.transaction_hash, r.publication_id, r.finalized_at
     FROM libro_publish_challenges c
     LEFT JOIN libro_human_registrations r ON r.challenge_id = c.id
     WHERE c.id = $1 AND c.identity_id = $2 AND c.origin_client_id = $3`,
    [input.challengeId, input.principal.identityId, input.principal.clientId],
  )
  const row = result.rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Publication operation was not found', 404)
  const state = row.publication_id
    ? 'finalized'
    : row.registration_id
      ? 'prepared'
      : new Date(row.expires_at).getTime() <= Date.now()
        ? 'expired'
        : 'awaiting_signature'
  return {
    challengeId: row.id,
    signalHash: row.signal_hash,
    state,
    registrationId: row.registration_id || null,
    transactionHash: row.transaction_hash || null,
    publicationId: row.publication_id ? String(row.publication_id) : null,
  }
}

export async function getSigningChallenge(capability: string) {
  const result = await pool.query(
    `SELECT c.id, c.identity_id, c.signal_hash, c.signal_text, c.publication, c.expires_at, c.consumed_at,
       a.name, a.handle, r.id AS registration_id, r.transaction,
       r.transaction_hash, r.user_op_hash, r.submission_method, r.publication_id
     FROM libro_publish_challenges c JOIN libro_authors a ON a.id = c.author_id
     LEFT JOIN libro_human_registrations r ON r.challenge_id = c.id
     WHERE c.signing_capability_hash = $1`,
    [sha256(capability)],
  )
  const row = result.rows[0]
  if (!row || (!row.registration_id && (row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()))) {
    throw new ServiceError('INVALID_CAPABILITY', 'Signing request is invalid or expired', 404)
  }
  return row
}
