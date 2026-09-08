import { handleClaimContext } from '@/lib/handle-claims'
import { errorResponse } from '@/lib/errors'

export async function POST(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try { return Response.json(await handleClaimContext(request, (await context.params).capability), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
