import { prepareAgentDocument } from '@/lib/agent-documents'
import { errorResponse } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      publication?: unknown; documentNonce?: string; signedAt?: number; signature?: string
    }
    if (!body.publication || !body.documentNonce || typeof body.signedAt !== 'number' || !body.signature) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Publication, nonce, timestamp, and agent signature are required', retryable: false } }, { status: 400 })
    }
    return Response.json(await prepareAgentDocument({
      publication: body.publication,
      documentNonce: body.documentNonce,
      signedAt: body.signedAt,
      signature: body.signature,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
