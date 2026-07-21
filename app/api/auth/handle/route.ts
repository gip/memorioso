import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('handle') || ''
  const handle = normalizeUserHandle(raw)

  if (!isValidUserHandle(handle)) {
    return NextResponse.json({
      success: true,
      handle,
      valid: false,
      exists: false,
      canLogin: false,
    })
  }

  const client = await pool.connect()

  try {
    // Handles are one namespace across users and legacy author rows.
    const { rows } = await client.query(
      `SELECT
         (SELECT world_id_session_id IS NOT NULL FROM users WHERE handle = $1) AS can_login,
         EXISTS (SELECT 1 FROM users WHERE handle = $1)
           OR EXISTS (SELECT 1 FROM authors WHERE handle = $1) AS taken`,
      [handle]
    )

    return NextResponse.json({
      success: true,
      handle,
      valid: true,
      exists: rows[0].taken === true,
      canLogin: rows[0].can_login === true,
    })
  } finally {
    client.release()
  }
}
