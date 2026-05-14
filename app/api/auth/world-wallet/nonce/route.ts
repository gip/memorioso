import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { WORLD_ID_WALLET_AUTH_STATEMENT, WORLD_WALLET_NONCE_COOKIE } from '@/lib/world-id/constants'

export async function POST() {
  const nonce = crypto.randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  const response = NextResponse.json({
    success: true,
    nonce,
    statement: WORLD_ID_WALLET_AUTH_STATEMENT,
    expirationTime: expiresAt.toISOString(),
  })

  response.cookies.set(WORLD_WALLET_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })

  return response
}
