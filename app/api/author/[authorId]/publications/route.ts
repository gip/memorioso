import { NextRequest, NextResponse } from 'next/server'
import { getPublicationsByAuthor } from '@/lib/db/objects'
import { isPublicationKind } from '@/lib/publication-kind'

const readInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = value ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ authorId: string }> }
): Promise<NextResponse> {
  const { authorId } = await context.params
  const limit = readInt(req.nextUrl.searchParams.get('limit'), 10, 1, 20)
  const offset = readInt(req.nextUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const requestedType = req.nextUrl.searchParams.get('type') || 'article'
  if (!isPublicationKind(requestedType)) {
    return NextResponse.json({ success: false, message: 'Type must be article or short' }, { status: 400 })
  }

  // One extra row tells the caller whether another page exists without a count.
  const rows = await getPublicationsByAuthor(authorId, limit + 1, offset, requestedType)
  const publications = rows.slice(0, limit)

  return NextResponse.json({
    success: true,
    publications,
    hasMore: rows.length > limit,
  })
}
