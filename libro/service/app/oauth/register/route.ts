import { createDynamicClientId } from '@/lib/oauth'
import { pool } from '@/lib/db'

function validRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as { redirect_uris?: unknown; client_name?: unknown } | null
  const redirectUris = Array.isArray(body?.redirect_uris) && body.redirect_uris.every((value) => typeof value === 'string' && validRedirect(value))
    ? body.redirect_uris as string[]
    : null
  if (!redirectUris?.length) return Response.json({ error: 'invalid_redirect_uri' }, { status: 400 })
  const clientId = createDynamicClientId()
  const resource = new URL('/mcp', request.url).toString()
  await pool.query(
    `INSERT INTO libro_oauth_clients
      (id, client_type, redirect_uris, resource, display_name, dynamically_registered)
     VALUES ($1, 'public', $2, $3, $4, TRUE)`,
    [clientId, redirectUris, resource, typeof body?.client_name === 'string' ? body.client_name.slice(0, 120) : null],
  )
  return Response.json({
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
