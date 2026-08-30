import { errorResponse } from '@/lib/errors'
import { exchangeAuthorizationCode, exchangeRefreshToken } from '@/lib/oauth'

export async function POST(request: Request): Promise<Response> {
  try {
    const form = new URLSearchParams(await request.text())
    const grantType = form.get('grant_type')
    const issued = grantType === 'authorization_code'
      ? await exchangeAuthorizationCode(request, form)
      : grantType === 'refresh_token'
        ? await exchangeRefreshToken(request, form)
        : null
    if (!issued) return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
    return Response.json({
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: issued.refreshToken,
      scope: issued.scope,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
  } catch (error) {
    return errorResponse(error)
  }
}
