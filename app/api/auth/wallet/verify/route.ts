import { NextRequest, NextResponse } from 'next/server'
import type { WalletAuthResult } from '@worldcoin/minikit-js/commands'
import { verifySiweMessage } from '@worldcoin/minikit-js/siwe'
import { pool } from '@/lib/db'
import { AUTH_SESSION_COOKIE, createAuthSessionToken, getAuthSessionCookieOptions } from '@/lib/auth-session'
import {
  getWalletAuthNonceCookieOptions,
  normalizeWalletAddress,
  WALLET_AUTH_NONCE_COOKIE,
  WALLET_AUTH_STATEMENT,
} from '@/lib/wallet-auth'

type WalletAuthVerifyRequest = {
  payload?: WalletAuthResult
  nonce?: unknown
}

function isWalletAuthPayload(value: unknown): value is WalletAuthResult {
  return typeof value === 'object' &&
    value !== null &&
    'address' in value &&
    'message' in value &&
    'signature' in value &&
    typeof value.address === 'string' &&
    typeof value.message === 'string' &&
    typeof value.signature === 'string'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as WalletAuthVerifyRequest | null
  const cookieNonce = request.cookies.get(WALLET_AUTH_NONCE_COOKIE)?.value
  const nonce = typeof body?.nonce === 'string' ? body.nonce : null
  const payload = body?.payload

  if (!nonce || !cookieNonce || nonce !== cookieNonce || !isWalletAuthPayload(payload)) {
    return NextResponse.json({
      success: false,
      message: 'Wallet auth context is invalid',
    }, { status: 400 })
  }

  let walletAddress
  try {
    const verification = await verifySiweMessage(payload, nonce, WALLET_AUTH_STATEMENT)
    if (!verification.isValid || !verification.siweMessageData.address) {
      return NextResponse.json({
        success: false,
        message: 'Wallet signature is invalid',
      }, { status: 401 })
    }

    walletAddress = normalizeWalletAddress(verification.siweMessageData.address)
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Wallet signature is invalid',
    }, { status: 400 })
  }

  const subject = `wallet:${walletAddress}`
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `INSERT INTO users (name, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (wallet_address)
       DO UPDATE SET
         name = EXCLUDED.name,
         modified_at = CURRENT_TIMESTAMP
       RETURNING id, name, wallet_address`,
      [subject, walletAddress]
    )

    const user = {
      id: rows[0].id,
      subject: rows[0].name,
      walletAddress: rows[0].wallet_address,
    }
    const response = NextResponse.json({
      success: true,
      authenticated: true,
      user,
    })

    response.cookies.set(
      AUTH_SESSION_COOKIE,
      createAuthSessionToken(user.id, user.walletAddress),
      getAuthSessionCookieOptions()
    )
    response.cookies.set(WALLET_AUTH_NONCE_COOKIE, '', {
      ...getWalletAuthNonceCookieOptions(0),
      expires: new Date(0),
    })

    return response
  } finally {
    client.release()
  }
}
