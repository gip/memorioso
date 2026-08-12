import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getExtensionSession, revokeExtensionSessionAndCancelDrafts } from '@/lib/extension-auth'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }

  const { rows } = await pool.query(
    `SELECT id, name, handle, bio
     FROM authors
     WHERE "userId" = $1`,
    [session.user.id]
  )
  if (rows.length === 0) {
    return NextResponse.json({ success: false, message: 'This Memorioso account has no author' }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    user: session.user,
    author: rows[0],
    expiresAt: session.expiresAt,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const result = await revokeExtensionSessionAndCancelDrafts(request)
  return NextResponse.json({ success: true, ...result })
}
