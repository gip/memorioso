import { finalizeHandleSigning } from '@/lib/handle-claims'
import { errorResponse } from '@/lib/errors'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const body = await request.json() as { transactionHash?: string }
    if (!body.transactionHash) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'transactionHash is required', retryable: false } }, { status: 400 })
    return Response.json(await finalizeHandleSigning((await context.params).capability, body.transactionHash), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
