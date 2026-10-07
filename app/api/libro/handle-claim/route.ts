import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { localHandleClaim } from '@/lib/libro/handle-claim'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'
export async function POST(request: NextRequest) {
  const retired = retiredLibroWriterResponse(); if (retired) return retired
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ message: 'Invalid origin' }, { status: 403 })
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  try {
    const args = await request.json()
    return NextResponse.json(await localHandleClaim(user, args.tool, args))
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Handle claim failed' }, { status: 400 }) }
}
