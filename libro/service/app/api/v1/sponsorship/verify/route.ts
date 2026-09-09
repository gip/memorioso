import { errorResponse } from '@/lib/errors'
import { verifySponsorship } from '@/lib/sponsorship'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { payload?: unknown }
    await verifySponsorship(body.payload)
    return Response.json({ verified: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
