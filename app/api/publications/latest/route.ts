import { NextRequest, NextResponse } from 'next/server'
import { getLatestPublications } from '@/lib/db/objects'

export const dynamic = 'force-dynamic'

const readInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = value ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = readInt(req.nextUrl.searchParams.get('limit'), 20, 1, 20)
  const offset = readInt(req.nextUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

  // One extra row tells the caller whether another page exists without a count.
  const rows = await getLatestPublications(limit + 1, offset)
  const publications = rows.slice(0, limit)

  return NextResponse.json({
    success: true,
    publications,
    hasMore: rows.length > limit,
  })
}
