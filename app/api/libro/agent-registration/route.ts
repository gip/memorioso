import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import {
  createAgentRegistrationPayload,
  LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
} from '@/lib/libro/agent'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { hashLibroHandle } from '@libro/core'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'

type CreateAgentRegistrationRequest = {
  authorId?: unknown
  controllerAddress?: unknown
  agentAddress?: unknown
  expiresAt?: unknown
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function defaultExpiry(): Date {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)
  return expiresAt
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  const authorId = req.nextUrl.searchParams.get('authorId')
  if (!authorId) {
    return NextResponse.json({ success: false, message: 'Author ID is required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const authorResult = await client.query(
      'SELECT id FROM authors WHERE id = $1 AND "userId" = $2',
      [authorId, authenticatedUser.id]
    )

    if (authorResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Author not found' }, { status: 404 })
    }

    const { rows } = await client.query(
      `SELECT id, registration_hash, handle_hash, controller_address, agent_address,
        scope, valid_from, expires_at, finalized_at, revoked_at, created_at
       FROM libro_agent_registrations
       WHERE "authorId" = $1 AND "userId" = $2
       ORDER BY created_at DESC`,
      [authorId, authenticatedUser.id]
    )

    return NextResponse.json({ success: true, registrations: rows })
  } finally {
    client.release()
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse()
  if (retired) return retired
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let worldIdConfig
  let agentConfig
  try {
    worldIdConfig = getWorldIdServerConfig()
    agentConfig = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as CreateAgentRegistrationRequest | null
  const authorId = typeof body?.authorId === 'string' ? body.authorId : null
  const controllerAddress = typeof body?.controllerAddress === 'string' ? body.controllerAddress : null
  const agentAddress = typeof body?.agentAddress === 'string' ? body.agentAddress : null

  if (!authorId || !controllerAddress || !agentAddress) {
    return NextResponse.json({
      success: false,
      message: 'Author, controller address, and agent address are required',
    }, { status: 400 })
  }

  if (!isAddress(controllerAddress) || !isAddress(agentAddress)) {
    return NextResponse.json({
      success: false,
      message: 'Controller and agent addresses must be valid EVM addresses',
    }, { status: 400 })
  }

  const validFrom = new Date()
  const expiresAt = typeof body?.expiresAt === 'string' ? new Date(body.expiresAt) : defaultExpiry()
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= validFrom) {
    return NextResponse.json({ success: false, message: 'Agent registration expiry is invalid' }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    const authorResult = await client.query(
      `SELECT a.id, a.handle, u.world_id_session_id, u.world_id_session_commitment
       FROM authors a INNER JOIN users u ON u.id = a."userId" AND u.handle = a.handle
       WHERE a.id = $1 AND a."userId" = $2`,
      [authorId, authenticatedUser.id]
    )

    if (authorResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Author not found' }, { status: 404 })
    }

    const author = authorResult.rows[0]
    const handleHash = hashLibroHandle(author.handle)
    const rpContext = createRpContext(worldIdConfig)
    const registration = createAgentRegistrationPayload({
      handleHash,
      controllerAddress,
      agentAddress,
      scope: LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
      validFrom,
      expiresAt,
      salt: randomBytes32(),
      chainId: agentConfig.chainId,
      registryAddress: agentConfig.registryAddress,
    })

    const { rows } = await client.query(
      `INSERT INTO libro_agent_registrations
        ("userId", "authorId", registration_hash, handle_hash, session_commitment, controller_address, agent_address,
         scope, valid_from, expires_at, nonce, signal, signal_hash, payload, chain_id, registry_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        authenticatedUser.id,
        authorId,
        registration.registrationHash,
        handleHash,
        author.world_id_session_commitment,
        controllerAddress.toLowerCase(),
        agentAddress.toLowerCase(),
        Number(LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE),
        validFrom,
        expiresAt,
        rpContext.nonce,
        registration.signal,
        registration.signalHash,
        registration.payload,
        agentConfig.chainId,
        agentConfig.registryAddress,
      ]
    )

    return NextResponse.json({
      success: true,
      registrationId: rows[0].id,
      registrationHash: registration.registrationHash,
      appId: worldIdConfig.appId,
      environment: worldIdConfig.environment,
      rpContext,
      existingSessionId: author.world_id_session_id,
      signal: registration.signal,
      signalHash: registration.signalHash,
      payload: registration.payload,
    })
  } finally {
    client.release()
  }
}
