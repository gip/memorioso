import { NextRequest, NextResponse } from 'next/server'
import { getLatestPublications } from '@/lib/db/objects'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limitParam = req.nextUrl.searchParams.get('limit')
  const parsed = limitParam ? Number(limitParam) : NaN
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 20) : 20

  const publications = await getLatestPublications(limit)

  return NextResponse.json({ success: true, publications })
}
