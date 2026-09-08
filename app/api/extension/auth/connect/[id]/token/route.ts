import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getBearerToken, hashExtensionToken, EXTENSION_SESSION_MAX_AGE_SECONDS } from '@/lib/extension-auth'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const pollToken = getBearerToken(request)
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED !== '1' || !pollToken || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false }, { status: 401 })
  const result = await pool.query('SELECT * FROM libro_extension_connections WHERE id = $1 AND poll_hash = $2 AND expires_at > CURRENT_TIMESTAMP', [id, hashExtensionToken(pollToken)])
  const row = result.rows[0]
  if (!row) return NextResponse.json({ success: false, message: 'Connection expired' }, { status: 401 })
  if (!row.approved_at) return NextResponse.json({ success: true, pending: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required')
  const token = createHmac('sha256', secret).update(`extension-token:${id}:${pollToken}`).digest('base64url')
  await pool.query(`INSERT INTO libro_extension_sessions (id, "userId", token_hash, expires_at, last_used_at)
    VALUES ($1,$2,$3,CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING`, [id, row.userId, hashExtensionToken(token), EXTENSION_SESSION_MAX_AGE_SECONDS])
  return NextResponse.json({ success: true, token }, { headers: { 'Cache-Control': 'no-store' } })
}
