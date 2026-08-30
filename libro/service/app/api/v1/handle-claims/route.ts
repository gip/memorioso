import { createHandleClaimChallenge } from '@/lib/handle-claims'
import { errorResponse } from '@/lib/errors'
import { authenticateBearer } from '@/lib/oauth'

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await authenticateBearer(request, 'claim_handle', new URL('/api/v1', request.url).toString())
    return Response.json(await createHandleClaimChallenge(principal), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
