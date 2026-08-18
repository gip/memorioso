import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getExtensionSession, revokeExtensionSessionAndCancelDrafts } from '@/lib/extension-auth'
import { getOwnedAuthors } from '@/lib/authors'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }

  const authors = await getOwnedAuthors(pool, session.user.id)
  const author = authors.find((candidate) => candidate.isPrimary)
  if (!author) {
    return NextResponse.json({ success: false, message: 'This Memorioso account has no author' }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    user: session.user,
    author,
    authors,
    expiresAt: session.expiresAt,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const result = await revokeExtensionSessionAndCancelDrafts(request)
  return NextResponse.json({ success: true, ...result })
}
