import { errorResponse } from '@/lib/errors'
import { recordWalletSubmission } from '@/lib/human-signing'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }) {
  try {
    const { capability } = await context.params
    const body = await request.json()
    return Response.json(await recordWalletSubmission(capability, body.registrationId, body.userOpHash), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
