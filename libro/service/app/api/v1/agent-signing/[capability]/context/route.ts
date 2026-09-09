import { agentSigningContext } from '@/lib/agent-registrations'
import { errorResponse } from '@/lib/errors'

export async function POST(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    return Response.json(await agentSigningContext(request, (await context.params).capability), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
