import { finalizeAgentSigning } from '@/lib/agent-registrations'
import { errorResponse } from '@/lib/errors'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const body = await request.json() as { transactionHash?: string; userOpHash?: string }
    if (!body.transactionHash) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'transactionHash is required', retryable: false } }, { status: 400 })
    return Response.json(await finalizeAgentSigning((await context.params).capability, {
      transactionHash: body.transactionHash,
      userOpHash: body.userOpHash,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
