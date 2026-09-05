import { authenticateBearer } from '@/lib/oauth'
import { revokeAgent } from '@/lib/agent-revocation'
import { errorResponse } from '@/lib/errors'

export async function PUT(request: Request, context: { params: Promise<{ registrationId: string }> }) {
  try {
    const { registrationId } = await context.params
    const principal = await authenticateBearer(request, 'revoke_agent', new URL('/api/v1', request.url).toString())
    return Response.json(await revokeAgent(principal, registrationId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
