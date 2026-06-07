import { NextResponse } from 'next/server'
import {
  createWalletAuthNonce,
  getWalletAuthNonceCookieOptions,
  WALLET_AUTH_NONCE_COOKIE,
  WALLET_AUTH_NONCE_MAX_AGE_SECONDS,
  WALLET_AUTH_STATEMENT,
} from '@/lib/wallet-auth'

export async function GET() {
  const nonce = createWalletAuthNonce()
  const response = NextResponse.json({
    success: true,
    nonce,
    statement: WALLET_AUTH_STATEMENT,
    expiresAt: new Date(Date.now() + WALLET_AUTH_NONCE_MAX_AGE_SECONDS * 1000).toISOString(),
  })

  response.cookies.set(
    WALLET_AUTH_NONCE_COOKIE,
    nonce,
    getWalletAuthNonceCookieOptions()
  )

  return response
}
