import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'

export async function GET() {
  const user = await getAuthenticatedUser()

  return NextResponse.json({
    success: true,
    authenticated: Boolean(user),
    user,
  })
}
