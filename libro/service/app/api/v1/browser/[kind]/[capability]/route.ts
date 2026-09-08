import { getSigningChallenge } from '@/lib/human-publications'
import { getAgentRegistrationSigningChallenge } from '@/lib/agent-registrations'
import { getHandleClaimSigningRequest } from '@/lib/handle-claims'
import { browserIdentityId } from '@/lib/session'
import { errorResponse, ServiceError } from '@/lib/errors'

export async function GET(_request: Request, context: { params: Promise<{ kind: string; capability: string }> }): Promise<Response> {
  try {
    const identityId = await browserIdentityId()
    if (!identityId) throw new ServiceError('AUTH_REQUIRED', 'Sign in to continue', 401)
    const { kind, capability } = await context.params
    let result
    if (kind === 'sign') {
      const row = await getSigningChallenge(capability)
      if (row.identity_id !== identityId) throw new ServiceError('IDENTITY_MISMATCH', 'This request belongs to another identity', 403)
      result = { publication: row.publication, signalHash: row.signal_hash }
    } else if (kind === 'sign-agent') {
      const row = await getAgentRegistrationSigningChallenge(capability)
      if (row.identity_id !== identityId) throw new ServiceError('IDENTITY_MISMATCH', 'This request belongs to another identity', 403)
      result = { handle: row.handle, controller: row.controller_address, agent: row.agent_address,
        expiresAt: row.expires_at, signal: row.signal }
    } else if (kind === 'claim') {
      const row = await getHandleClaimSigningRequest(capability)
      if (row.identity_id !== identityId) throw new ServiceError('IDENTITY_MISMATCH', 'This request belongs to another identity', 403)
      result = { handle: row.handle, signal: row.signal_text }
    } else throw new ServiceError('NOT_FOUND', 'Unknown signing operation', 404)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
