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
