import type { IDKitResultSession } from '@worldcoin/idkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLoginSecret,
  consumeLoginSecret,
  draftKeySecretFromLogin,
  onLoginSecret,
  publishLoginSecret,
} from '@/lib/draft-crypto/login-secret'

const loginResult = (nullifiers: unknown): IDKitResultSession => ({
  responses: [{ identifier: 'proof_of_human', session_nullifier: nullifiers }],
} as unknown as IDKitResultSession)

describe('draftKeySecretFromLogin', () => {
  it('takes the nullifier the server does not store', () => {
    expect(draftKeySecretFromLogin(loginResult(['stored-0', 'unstored-1']))).toBe('unstored-1')
  })

  it('returns null when there is no second nullifier to use', () => {
    expect(draftKeySecretFromLogin(loginResult(['stored-0']))).toBeNull()
    expect(draftKeySecretFromLogin(loginResult(['stored-0', '']))).toBeNull()
    expect(draftKeySecretFromLogin(loginResult(['stored-0', 7]))).toBeNull()
    expect(draftKeySecretFromLogin(loginResult(undefined))).toBeNull()
    expect(draftKeySecretFromLogin({} as IDKitResultSession)).toBeNull()
  })
})

describe('the login handoff', () => {
  beforeEach(() => {
    clearLoginSecret()
  })

  it('hands the secret to a consumer that arrives later', () => {
    publishLoginSecret('secret')

    expect(consumeLoginSecret()).toBe('secret')
  })

  it('is good for exactly one unlock', () => {
    publishLoginSecret('secret')

    expect(consumeLoginSecret()).toBe('secret')
    expect(consumeLoginSecret()).toBeNull()
  })

  it('notifies a consumer that was already listening', () => {
    const listener = vi.fn()
    const stop = onLoginSecret(listener)

    publishLoginSecret('secret')
    stop()
    publishLoginSecret('after-unsubscribe')

    expect(listener).toHaveBeenCalledExactlyOnceWith('secret')
  })

  it('drops anything pending on sign-out', () => {
    publishLoginSecret('secret')
    clearLoginSecret()

    expect(consumeLoginSecret()).toBeNull()
  })
})
