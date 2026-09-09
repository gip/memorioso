import { relayHandleSigning } from '@/lib/handle-claims'
import { errorResponse } from '@/lib/errors'

export async function PUT(_request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try { return Response.json(await relayHandleSigning((await context.params).capability), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
