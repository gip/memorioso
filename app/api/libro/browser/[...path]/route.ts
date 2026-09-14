import { LIBRO_BROWSER_MCP_TOOLS } from '@libro/core'
import { NextRequest } from 'next/server'

const COOKIE_NAMES = new Set(['libro_identity_session', 'libro_world_session_hint', 'libro_oauth_consent'])
const BROWSER_TOOLS = new Set<string>(LIBRO_BROWSER_MCP_TOOLS)

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!serviceUrl || !appUrl) return Response.json({ error: { message: 'Libro configuration is incomplete' } }, { status: 503 })
  const path = (await context.params).path.join('/')
  const isMcp = path === 'mcp' && request.method === 'POST'
  if (!isMcp) return Response.json({ error: { message: 'Unknown browser operation' } }, { status: 404 })
  const rpc = await request.json().catch(() => null)
  const allowed = rpc?.jsonrpc === '2.0' && (
    rpc.method === 'initialize' || rpc.method === 'notifications/initialized' || rpc.method === 'ping' ||
    rpc.method === 'tools/call' && BROWSER_TOOLS.has(rpc.params?.name)
  )
  if (!allowed) return Response.json({ error: { message: 'Unknown browser MCP operation' } }, { status: 403 })
  // Only this app may submit cookie-authenticated browser operations.
  if (request.headers.get('origin') !== new URL(appUrl).origin) {
    return Response.json({ error: { message: 'Invalid request origin' } }, { status: 403 })
  }
  const destination = new URL(`/${path}`, serviceUrl)
  destination.search = request.nextUrl.search
  const headers = new Headers({ Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' })
  for (const name of ['mcp-protocol-version', 'mcp-session-id']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
  }
  const cookie = request.cookies.getAll().filter(({ name }) => COOKIE_NAMES.has(name))
    .map(({ name, value }) => `${name}=${value}`).join('; ')
  if (cookie) headers.set('Cookie', cookie)
  headers.set('Origin', new URL(serviceUrl).origin)
  try {
    const upstream = await fetch(destination, {
      method: request.method, headers,
      body: JSON.stringify(rpc),
      cache: 'no-store', redirect: 'manual',
    })
    // Older service deployments return HTML or redirects instead of the browser API.
    const body = await upstream.text()
    try {
      if (upstream.status >= 300 && upstream.status < 400) throw new Error('Unexpected redirect')
      if (!body && ![202, 204].includes(upstream.status)) throw new Error('Empty response')
      if (body && !upstream.headers.get('content-type')?.includes('text/event-stream')) JSON.parse(body)
    } catch {
      return Response.json({ error: { message: 'Libro returned an incompatible response. The app and Libro service must be deployed together.' } },
        { status: 502, headers: { 'Cache-Control': 'no-store' } })
    }
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
    if (upstream.headers.has('mcp-session-id')) responseHeaders.set('mcp-session-id', upstream.headers.get('mcp-session-id')!)
    for (const cookie of upstream.headers.getSetCookie()) {
      const name = cookie.slice(0, cookie.indexOf('='))
      if (COOKIE_NAMES.has(name)) responseHeaders.append('Set-Cookie', cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Path=[^;]*/gi, '; Path=/api/libro/browser'))
    }
    return new Response(body || null, { status: upstream.status, headers: responseHeaders })
  } catch {
    return Response.json({ error: { message: 'Could not reach Libro. Try again.' } }, { status: 502 })
  }
}

export { proxy as POST }
