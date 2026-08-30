import { prepareHandleSigning } from '@/lib/handle-claims'
import { errorResponse } from '@/lib/errors'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const body = await request.json() as { idkitResult?: unknown }
    if (!body.idkitResult) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'idkitResult is required', retryable: false } }, { status: 400 })
    return Response.json(await prepareHandleSigning((await context.params).capability, body.idkitResult), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
