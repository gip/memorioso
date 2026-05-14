import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'

export async function POST(req: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 })
  }

  const { name, bio, handle, avatar } = await req.json()

  const client = await pool.connect()

  try {
    const authorResult = await client.query(
      'INSERT INTO authors ("userId", name, bio, handle, avatar) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [authenticatedUser.id, name, bio, handle, avatar]
    )

    return NextResponse.json({ success: true, author: authorResult.rows[0] })
  } finally {
    client.release()
  }
}
