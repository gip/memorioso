import { createHmac, randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { pool } from '@/lib/db'
import { getLibroAccessToken } from '@/lib/libro-service/token-store'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }
function csrf(id: string, userId: number) {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required')
  return createHmac('sha256', secret).update(`extension-connect:${id}:${userId}`).digest('hex')
}
async function connection(id: string) {
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED !== '1' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return (await pool.query('SELECT id FROM libro_extension_connections WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP AND approved_at IS NULL', [id])).rows[0]
}
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const user = await getAuthenticatedUser()
  if (!user || !await connection(id)) return NextResponse.json({ error: 'Connection expired; start again in the extension' }, { status: 400 })
  const nonce = randomBytes(18).toString('base64')
  return new Response(`<!doctype html><html><head><title>Connecting extension</title></head><body>
    <p>Connecting the Libro extension…</p>
    <form method="post"><input type="hidden" name="csrf" value="${csrf(id, user.id)}"></form>
    <script nonce="${nonce}">document.forms[0].submit()</script>
    </body></html>`, { headers: { ...headers,
      'Content-Security-Policy': `${headers['Content-Security-Policy']}; script-src 'nonce-${nonce}'`,
    } })
}
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const user = await getAuthenticatedUser()
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !user || !await connection(id)) {
    return NextResponse.json({ error: 'Invalid connection' }, { status: 403 })
  }
  const form = new URLSearchParams(await request.text())
  if (form.get('csrf') !== csrf(id, user.id)) return NextResponse.json({ error: 'Invalid connection token' }, { status: 403 })
  await getLibroAccessToken(user.id, 'publish')
  const updated = await pool.query(`UPDATE libro_extension_connections SET "userId" = $2, approved_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND approved_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING id`, [id, user.id])
  if (!updated.rows[0]) return NextResponse.json({ error: 'Connection expired' }, { status: 409 })
  return new Response('<!doctype html><title>Extension connected</title><p>Connected. Return to the Libro extension.</p>', { headers })
}
