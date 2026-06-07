import { randomBytes } from 'crypto'
import { isAddress } from 'viem'

export const WALLET_AUTH_NONCE_COOKIE = 'memorioso_wallet_auth_nonce' as const
export const WALLET_AUTH_NONCE_MAX_AGE_SECONDS = 10 * 60
export const WALLET_AUTH_STATEMENT = 'Sign in to Memorioso' as const

export function createWalletAuthNonce(): string {
  return randomBytes(16).toString('hex')
}

export function normalizeWalletAddress(address: string): string {
  if (!isAddress(address, { strict: false })) {
    throw new Error('Wallet address is invalid')
  }

  return address.toLowerCase()
}

export function getWalletAuthNonceCookieOptions(maxAge = WALLET_AUTH_NONCE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}
