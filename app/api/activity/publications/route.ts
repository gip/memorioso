import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth-user'
import { getPublicationsByUser } from '@/lib/db/objects'

const readInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = value ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser(req)
  if (!authenticatedUser) {
    return NextResponse.json(
      { success: false, message: 'Authentication required' },
      { status: 401 }
    )
  }

  const limit = readInt(req.nextUrl.searchParams.get('limit'), 5, 1, 20)
  const offset = readInt(
    req.nextUrl.searchParams.get('offset'),
    0,
    0,
    Number.MAX_SAFE_INTEGER
  )
  const rows = await getPublicationsByUser(authenticatedUser.id, limit + 1, offset)

  return NextResponse.json({
    success: true,
    publications: rows.slice(0, limit),
    hasMore: rows.length > limit,
  })
}
