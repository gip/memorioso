import { finalizeAgentDocument } from '@/lib/agent-documents'
import { errorResponse } from '@/lib/errors'

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      documentRegistrationId?: string; transactionHash?: string; userOpHash?: string
      signedAt?: number; signature?: string
    }
    if (!body.documentRegistrationId || !body.transactionHash || typeof body.signedAt !== 'number' || !body.signature) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Registration, transaction, timestamp, and finalization signature are required', retryable: false } }, { status: 400 })
    }
    return Response.json(await finalizeAgentDocument({
      documentRegistrationId: body.documentRegistrationId,
      transactionHash: body.transactionHash,
      userOpHash: body.userOpHash,
      signedAt: body.signedAt,
      signature: body.signature,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
