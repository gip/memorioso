import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { AUTH_SESSION_COOKIE, createAuthSessionToken, getAuthSessionCookieOptions } from '@/lib/auth-session'
import {
  WORLD_ID_AUTH_NONCE_COOKIE,
  WORLD_ID_SESSION_HINT_COOKIE,
  WORLD_ID_SESSION_HINT_MAX_AGE_SECONDS,
} from '@/lib/world-id/constants'
import { getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'
import {
  validateSessionCredentialResponses,
  validateWorldIdSessionResult,
} from '@/lib/world-id/proof'

type VerifyRequestBody = {
  payload?: unknown
  nonce?: unknown
}

type VerifyDiagnosticContext = {
  nonce: string
  environment?: 'production' | 'staging'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseIdKitResult(payload: unknown): IDKitResult {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as IDKitResult
  }

  return payload as IDKitResult
}

function summarizeIdKitPayload(payload: unknown, context: VerifyDiagnosticContext) {
  let result = payload
  if (typeof payload === 'string') {
    try {
      result = JSON.parse(payload) as unknown
    } catch {
      return { payloadType: 'string', parseError: true }
    }
  }

  if (!isRecord(result)) {
    return { payloadType: typeof result }
  }

  const responses = Array.isArray(result.responses) ? result.responses : null

  return {
    protocolVersion: typeof result.protocol_version === 'string' ? result.protocol_version : null,
    resultKind: typeof result.session_id === 'string'
      ? 'session'
      : typeof result.action === 'string'
        ? 'uniqueness'
        : 'unknown',
    nonceMatches: result.nonce === context.nonce,
    environmentMatches: context.environment ? result.environment === context.environment : null,
    responseCount: responses?.length ?? null,
    responses: responses?.map((response) => {
      if (!isRecord(response)) {
        return { payloadType: typeof response }
      }

      return {
        identifier: typeof response.identifier === 'string' ? response.identifier : null,
        hasSignalHash: typeof response.signal_hash === 'string',
        proofKind: Array.isArray(response.proof) ? 'array' : typeof response.proof,
        hasNullifier: typeof response.nullifier === 'string',
        hasSessionNullifier: Array.isArray(response.session_nullifier),
      }
    }) ?? null,
  }
}

export async function POST(request: NextRequest) {
  const cookieNonce = request.cookies.get(WORLD_ID_AUTH_NONCE_COOKIE)?.value
  const body = await request.json().catch(() => null) as VerifyRequestBody | null
  const payload = isRecord(body) && 'payload' in body ? body.payload : body
  const nonce = typeof body?.nonce === 'string'
    ? body.nonce
    : isRecord(payload) && typeof payload.nonce === 'string'
      ? payload.nonce
      : null

  if (!payload || !nonce || !cookieNonce || nonce !== cookieNonce) {
    return NextResponse.json({
      success: false,
      message: 'World ID login context is invalid',
    }, { status: 400 })
  }

  let config
  let validatedResult
  let subject
  let worldIdSessionId
  let sessionNullifier
  let credentialIdentifier
  let parsedResult: IDKitResult | null = null
  try {
    config = getWorldIdServerConfig()
    parsedResult = parseIdKitResult(payload)
    const result = parsedResult

    validatedResult = validateWorldIdSessionResult(result, {
      nonce,
      environment: config.environment,
    })

    const credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses)
    subject = `world-id-session:${validatedResult.session_id}`
    worldIdSessionId = validatedResult.session_id
    sessionNullifier = validatedResult.responses[0].session_nullifier[0]
    credentialIdentifier = credentialIdentifiers[0]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'World ID login proof is invalid'
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[world-id] login proof rejected before verifier', {
        message,
        cookieNoncePresent: Boolean(cookieNonce),
        nonceMatchesCookie: nonce === cookieNonce,
        result: summarizeIdKitPayload(parsedResult ?? payload, {
          nonce,
          environment: config?.environment,
        }),
      })
    }

    return NextResponse.json({
      success: false,
      message,
    }, { status: 400 })
  }

  const verifyRes = await verifyWorldIdProof(validatedResult, config.rpId)
  if (!verifyRes.ok) {
    return NextResponse.json({
      success: false,
      message: 'World ID verifier rejected the login proof',
      verifierResponse: verifyRes.body,
    }, { status: 401 })
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `INSERT INTO users
        (name, world_id_session_id, world_id_session_nullifier, world_id_credential_identifier)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (world_id_session_id) WHERE world_id_session_id IS NOT NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         world_id_session_nullifier = EXCLUDED.world_id_session_nullifier,
         world_id_credential_identifier = EXCLUDED.world_id_credential_identifier,
         modified_at = CURRENT_TIMESTAMP
       RETURNING id, name, world_id_session_id, world_id_credential_identifier`,
      [subject, worldIdSessionId, sessionNullifier, credentialIdentifier]
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
    response.cookies.set(WORLD_ID_SESSION_HINT_COOKIE, user.worldIdSessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: WORLD_ID_SESSION_HINT_MAX_AGE_SECONDS,
    })

    return response
  } finally {
    client.release()
  }
}
