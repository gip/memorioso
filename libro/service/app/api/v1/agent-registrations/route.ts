import { pool } from '@/lib/db'
import { createAgentRegistrationChallenge } from '@/lib/agent-registrations'
import { errorResponse } from '@/lib/errors'
import { authenticateBearer } from '@/lib/oauth'

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await authenticateBearer(request, 'register_agent', new URL('/api/v1', request.url).toString())
    const body = await request.json() as { controllerAddress?: string; agentAddress?: string; expiresAt?: string }
    if (!body.controllerAddress || !body.agentAddress || !body.expiresAt) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Controller, agent, and expiry are required', retryable: false } }, { status: 400 })
    }
    return Response.json(await createAgentRegistrationChallenge({
      principal,
      controllerAddress: body.controllerAddress,
      agentAddress: body.agentAddress,
      expiresAt: body.expiresAt,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await authenticateBearer(request, 'profile', new URL('/api/v1', request.url).toString())
    const { rows } = await pool.query(`SELECT id, registration_hash, handle_hash, controller_address, agent_address,
      scope, valid_from, expires_at, finalized_at, revoked_at, created_at FROM libro_agent_registrations
      WHERE identity_id = $1 ORDER BY created_at DESC`, [principal.identityId])
    return Response.json({ registrations: rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
