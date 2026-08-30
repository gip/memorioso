import { errorResponse } from '@/lib/errors'
import { prepareSigning } from '@/lib/human-signing'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const { capability } = await context.params
    const body = await request.json() as { idkitResult?: unknown }
    if (!body.idkitResult) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'idkitResult is required', retryable: false } }, { status: 400 })
    return Response.json(await prepareSigning(capability, body.idkitResult), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
