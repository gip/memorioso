import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { AUTH_SESSION_COOKIE, createAuthSessionToken, getAuthSessionCookieOptions } from '@/lib/auth-session'
import { WORLD_ID_AUTH_NONCE_COOKIE } from '@/lib/world-id/constants'
import { getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'
import { validateSessionCredentialResponses, validateWorldIdSessionResult } from '@/lib/world-id/proof'

type VerifyRequestBody = {
  payload?: unknown
  nonce?: unknown
}

function parseIdKitResult(payload: unknown): IDKitResult {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as IDKitResult
  }

  return payload as IDKitResult
}

export async function POST(request: NextRequest) {
  const cookieNonce = request.cookies.get(WORLD_ID_AUTH_NONCE_COOKIE)?.value
  const body = await request.json().catch(() => null) as VerifyRequestBody | null
  const nonce = typeof body?.nonce === 'string' ? body.nonce : null

  if (!body?.payload || !nonce || !cookieNonce || nonce !== cookieNonce) {
    return NextResponse.json({
      success: false,
      message: 'World ID login context is invalid',
    }, { status: 400 })
  }

  let config
  let validatedResult
  try {
    config = getWorldIdServerConfig()
    validatedResult = validateWorldIdSessionResult(parseIdKitResult(body.payload), {
      nonce,
      environment: config.environment,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'World ID session proof is invalid',
    }, { status: 400 })
  }

  const verifyRes = await verifyWorldIdProof(validatedResult, config.rpId)
  if (!verifyRes.ok) {
    return NextResponse.json({
      success: false,
      message: 'World ID verifier rejected the session proof',
      verifierResponse: verifyRes.body,
    }, { status: 401 })
  }

  const credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses)
  const subject = `world-id:${validatedResult.session_id}`
  const sessionNullifier = validatedResult.responses[0]?.session_nullifier?.[0] || null
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `INSERT INTO users
        (name, world_id_session_id, world_id_session_nullifier, world_id_credential_identifier)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (world_id_session_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         world_id_session_nullifier = EXCLUDED.world_id_session_nullifier,
         world_id_credential_identifier = EXCLUDED.world_id_credential_identifier,
         modified_at = CURRENT_TIMESTAMP
       RETURNING id, name, world_id_session_id, world_id_credential_identifier`,
      [subject, validatedResult.session_id, sessionNullifier, credentialIdentifiers[0]]
    )

    const user = {
      id: rows[0].id,
      subject: rows[0].name,
      worldIdSessionId: rows[0].world_id_session_id,
      worldIdCredentialIdentifier: rows[0].world_id_credential_identifier,
    }
    const response = NextResponse.json({
      success: true,
      authenticated: true,
      user,
    })

    response.cookies.set(
      AUTH_SESSION_COOKIE,
      createAuthSessionToken(user.id, user.worldIdSessionId),
      getAuthSessionCookieOptions()
    )
    response.cookies.set(WORLD_ID_AUTH_NONCE_COOKIE, '', {
      ...getAuthSessionCookieOptions(0),
      expires: new Date(0),
    })

    return response
  } finally {
    client.release()
  }
}
