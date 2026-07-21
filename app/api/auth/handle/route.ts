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
    const { rows } = await client.query(
      `SELECT world_id_session_id IS NOT NULL AS can_login
       FROM users
       WHERE handle = $1`,
      [handle]
    )

    return NextResponse.json({
      success: true,
      handle,
      valid: true,
      exists: rows.length > 0,
      canLogin: rows.length > 0 && rows[0].can_login === true,
    })
  } finally {
    client.release()
  }
}
