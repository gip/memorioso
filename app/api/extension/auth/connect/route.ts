import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { createExtensionToken, hashExtensionToken } from '@/lib/extension-auth'

export async function POST() {
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED !== '1') return NextResponse.json({ success: false }, { status: 404 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return NextResponse.json({ success: false, message: 'App URL is missing' }, { status: 503 })
  const pollToken = createExtensionToken()
  await pool.query('DELETE FROM libro_extension_connections WHERE expires_at < CURRENT_TIMESTAMP')
  const inserted = await pool.query('INSERT INTO libro_extension_connections (poll_hash) VALUES ($1) RETURNING id', [hashExtensionToken(pollToken)])
  const id = inserted.rows[0].id
  const url = new URL('/api/auth/libro/start', appUrl)
  url.searchParams.set('returnTo', `/api/extension/auth/connect/${id}`)
  return NextResponse.json({ success: true, id, pollToken, authorizationUrl: url.toString() }, { headers: { 'Cache-Control': 'no-store' } })
}
