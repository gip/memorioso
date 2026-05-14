'use client'

import { signIn } from 'next-auth/react'
import { MiniKit } from '@worldcoin/minikit-js'

type WalletNonceResponse = {
  success: boolean
  nonce: string
  statement: string
  expirationTime: string
}

export async function signInWithWorldWallet(): Promise<void> {
  const nonceResponse = await fetch('/api/auth/world-wallet/nonce', {
    method: 'POST',
  })
  const nonceBody = await nonceResponse.json() as WalletNonceResponse

  if (!nonceResponse.ok || !nonceBody.success) {
    throw new Error('Could not start wallet login')
  }

  const walletAuth = await MiniKit.walletAuth({
    nonce: nonceBody.nonce,
    statement: nonceBody.statement,
    expirationTime: new Date(nonceBody.expirationTime),
  })

  const result = await signIn('world-wallet', {
    payload: JSON.stringify(walletAuth.data),
    nonce: nonceBody.nonce,
    redirect: false,
  })

  if (result?.error) {
    throw new Error(result.error)
  }
}
