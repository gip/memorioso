import { errorResponse } from '@/lib/errors'
import { revokeOAuthToken } from '@/lib/oauth'

export async function POST(request: Request): Promise<Response> {
  try {
    await revokeOAuthToken(request, new URLSearchParams(await request.text()))
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
