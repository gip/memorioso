import { createLibroMcpClient, LibroMcpError } from '@libro/core'

const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Access-Control-Allow-Origin': '*' }

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }): Promise<Response> {
  const { operation } = await context.params
  if (!['token', 'register', 'revoke'].includes(operation)) return Response.json({ error: 'invalid_request' }, { status: 404, headers })
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  if (!serviceUrl) return Response.json({ error: 'server_error' }, { status: 503, headers })
  // This public OAuth facade forwards client authentication, never website cookies
  // or a Memorioso service credential. Libro independently validates the grant.
  const authorization = request.headers.get('authorization')
  if (authorization && !/^Basic [A-Za-z0-9+/]+=*$/i.test(authorization)) {
    return Response.json({ error: 'invalid_client' }, { status: 401, headers })
  }
  try {
    const args = operation === 'register' ? await request.json()
      : { form: Object.fromEntries(new URLSearchParams(await request.text())) }
    const result = await createLibroMcpClient(new URL('/mcp', serviceUrl).toString(), {
      headers: authorization ? { Authorization: authorization } : undefined,
    }).callTool(`oauth_${operation}`, args)
    if (operation === 'revoke') return new Response(null, { status: 200, headers })
    return Response.json(result, { status: operation === 'register' ? 201 : 200, headers })
  } catch (error) {
    if (error instanceof LibroMcpError && /^[a-z_]+$/.test(error.code)) {
      return Response.json({ error: error.code, error_description: error.message }, { status: error.status, headers })
    }
    const invalid = error instanceof SyntaxError || error instanceof LibroMcpError && error.code === '-32602'
    return Response.json({ error: invalid ? 'invalid_request' : 'server_error' }, { status: invalid ? 400 : 502, headers })
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...headers,
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
}
