import { describe, expect, it } from 'vitest'
import {
  createWalletAuthNonce,
  normalizeWalletAddress,
  WALLET_AUTH_STATEMENT,
} from '../wallet-auth'

describe('wallet auth helpers', () => {
  it('creates SIWE-compatible alphanumeric nonces', () => {
    const nonce = createWalletAuthNonce()

    expect(nonce).toMatch(/^[a-zA-Z0-9]{8,}$/)
  })

  it('normalizes valid wallet addresses to lowercase', () => {
    expect(normalizeWalletAddress('0x1234567890ABCDEF1234567890ABCDEF12345678')).toBe(
      '0x1234567890abcdef1234567890abcdef12345678'
    )
  })

  it('rejects invalid wallet addresses', () => {
    expect(() => normalizeWalletAddress('0xnope')).toThrow('Wallet address is invalid')
  })

  it('uses the Memorioso login statement', () => {
    expect(WALLET_AUTH_STATEMENT).toBe('Sign in to Memorioso')
  })
})
