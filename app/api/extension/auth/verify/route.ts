import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import {
  createExtensionToken,
  EXTENSION_SESSION_MAX_AGE_SECONDS,
  hashExtensionToken,
} from '@/lib/extension-auth'
import { getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'
import {
  validateSessionCredentialResponses,
  validateWorldIdSessionResult,
} from '@/lib/world-id/proof'

type VerifyBody = {
  attemptId?: unknown
  idkitResult?: unknown
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as VerifyBody | null
  if (typeof body?.attemptId !== 'string' || !body.idkitResult) {
    return NextResponse.json({ success: false, message: 'Login attempt and World ID result are required' }, { status: 400 })
  }

  let config
  try {
    config = getWorldIdServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'World ID configuration is invalid',
    }, { status: 500 })
  }

  const attemptResult = await pool.query(
    `SELECT
       a.id,
       a."userId",
       a.nonce,
       a.expires_at,
       a.consumed_at,
       u.world_id_session_id
     FROM libro_extension_auth_attempts a
     INNER JOIN users u ON u.id = a."userId"
     WHERE a.id = $1`,
    [body.attemptId]
  )
  if (attemptResult.rows.length === 0) {
    return NextResponse.json({ success: false, message: 'Extension login attempt was not found' }, { status: 404 })
  }

  const attempt = attemptResult.rows[0]
  if (attempt.consumed_at || new Date(attempt.expires_at) <= new Date()) {
    return NextResponse.json({ success: false, message: 'Extension login attempt has expired or was already used' }, { status: 400 })
  }

  let validatedResult
  let credentialIdentifiers: string[]
  try {
    validatedResult = validateWorldIdSessionResult(body.idkitResult as IDKitResult, {
      nonce: attempt.nonce,
      environment: config.environment,
    })
    credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses)
    if (validatedResult.session_id !== attempt.world_id_session_id) {
      throw new Error('World ID session does not match this Memorioso author')
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'World ID login proof is invalid',
    }, { status: 400 })
  }

  const verifier = await verifyWorldIdProof(validatedResult, config.rpId)
  if (!verifier.ok) {
    return NextResponse.json({ success: false, message: 'World ID verifier rejected the login proof' }, { status: 401 })
  }

  const token = createExtensionToken()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const consumed = await client.query(
      `UPDATE libro_extension_auth_attempts
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       RETURNING id`,
      [attempt.id]
    )
    if (consumed.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message: 'Extension login attempt was already used' }, { status: 409 })
    }

    const userResult = await client.query(
      `UPDATE users
       SET world_id_session_nullifier = $2,
           world_id_credential_identifier = $3,
           modified_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND world_id_session_id = $4
       RETURNING id, name, handle, world_id_session_id, world_id_credential_identifier`,
      [
        attempt.userId,
        validatedResult.responses[0].session_nullifier[0],
        credentialIdentifiers[0],
        validatedResult.session_id,
      ]
    )
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message: 'Memorioso author no longer matches this World ID' }, { status: 409 })
    }

    const sessionResult = await client.query(
      `INSERT INTO libro_extension_sessions ("userId", token_hash, expires_at, last_used_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'), CURRENT_TIMESTAMP)
       RETURNING expires_at`,
      [attempt.userId, hashExtensionToken(token), EXTENSION_SESSION_MAX_AGE_SECONDS]
    )
    await client.query('COMMIT')

    const user = userResult.rows[0]
    return NextResponse.json({
      success: true,
      token,
      expiresAt: new Date(sessionResult.rows[0].expires_at).toISOString(),
      user: {
        id: user.id,
        subject: user.name,
        handle: user.handle,
        worldIdSessionId: user.world_id_session_id,
        worldIdCredentialIdentifier: user.world_id_credential_identifier,
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create extension session',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
