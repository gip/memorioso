import { errorResponse } from '@/lib/errors'
import { sponsorshipContext } from '@/lib/sponsorship'

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await sponsorshipContext(request), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
