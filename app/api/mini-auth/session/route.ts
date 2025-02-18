import { insecureGetSession } from '@/lib/insecure-session'
import { NextResponse } from 'next/server'

export const GET = async () => {
  const session = await insecureGetSession()
  if (!session) {
    return NextResponse.json(null, { status: 401 })
  }

  return NextResponse.json(session)
}