import { NextRequest } from 'next/server'

const COOKIE_NAMES = new Set(['libro_identity_session', 'libro_world_session_hint', 'libro_oauth_consent'])
const READ_PATHS = /^(oauth\/authorize|api\/v1\/identity\/(handle|hint)|api\/v1\/browser\/(sign|sign-agent|claim)\/[A-Za-z0-9_-]+|api\/v1\/user-operations\/0x[0-9a-fA-F]+)$/
const POST_PATHS = /^(oauth\/authorize|api\/v1\/identity\/(context|verify)|api\/v1\/sponsorship\/(context|verify)|api\/v1\/(signing|agent-signing|handle-signing)\/[A-Za-z0-9_-]+\/context)$/
const PUT_PATHS = /^api\/v1\/(signing|agent-signing|handle-signing)\/[A-Za-z0-9_-]+\/(prepare|submission|relay|finalize)$/

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!serviceUrl || !appUrl) return Response.json({ error: { message: 'Libro configuration is incomplete' } }, { status: 503 })
  const path = (await context.params).path.join('/')
  const allowed = request.method === 'GET' ? READ_PATHS : request.method === 'POST' ? POST_PATHS : PUT_PATHS
  if (!allowed.test(path)) return Response.json({ error: { message: 'Unknown browser operation' } }, { status: 404 })
  // Only this app may submit cookie-authenticated browser operations.
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(appUrl).origin) {
    return Response.json({ error: { message: 'Invalid request origin' } }, { status: 403 })
  }
  const destination = new URL(`/${path}`, serviceUrl)
  destination.search = request.nextUrl.search
  const headers = new Headers({ Accept: 'application/json' })
  const cookie = request.cookies.getAll().filter(({ name }) => COOKIE_NAMES.has(name))
    .map(({ name, value }) => `${name}=${value}`).join('; ')
  if (cookie) headers.set('Cookie', cookie)
  if (request.headers.has('content-type')) headers.set('Content-Type', request.headers.get('content-type')!)
  if (request.method !== 'GET') headers.set('Origin', new URL(serviceUrl).origin)
  try {
    const upstream = await fetch(destination, {
      method: request.method, headers,
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store', redirect: 'manual',
    })
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' })
    for (const cookie of upstream.headers.getSetCookie()) {
      const name = cookie.slice(0, cookie.indexOf('='))
      if (COOKIE_NAMES.has(name)) responseHeaders.append('Set-Cookie', cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Path=[^;]*/gi, '; Path=/api/libro/browser'))
    }
    return new Response(await upstream.text(), { status: upstream.status, headers: responseHeaders })
  } catch {
    return Response.json({ error: { message: 'Could not reach Libro. Try again.' } }, { status: 502 })
  }
}

export { proxy as GET, proxy as POST, proxy as PUT }
