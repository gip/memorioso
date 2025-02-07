'use client'

import { useState, useCallback } from 'react'
import { MiniKit, Permission, RequestPermissionPayload, MiniAppRequestPermissionPayload } from '@worldcoin/minikit-js'

export const MiniHome = () => {
  const [walletAuth, setWalletAuth] = useState(null)

  const requestPermission = useCallback(
    async () => {
        const requestPermissionPayload: RequestPermissionPayload = {
            permission: Permission.Notifications,
        }
        const payload = await MiniKit.commandsAsync.requestPermission(requestPermissionPayload) as unknown as MiniAppRequestPermissionPayload
        if(payload.status === 'success') {
            console.log('Permission granted')
        } else {
            console.log('Permission denied')
        }
    },
    []
  )

  const signInWithWallet = async () => {
    if (!MiniKit.isInstalled()) {
      return
    }
  
    const res = await fetch(`/api/mini-auth/nonce`)
    const { nonce } = await res.json()
  
    const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
      nonce: nonce,
      requestId: '0', // Not sure what this is
      expirationTime: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
      notBefore: new Date(new Date().getTime() - 24 * 60 * 60 * 1000),
      statement: 'This is my statement and here is a link https://worldcoin.com/apps',
    })
  
    if (finalPayload.status === 'error') {
      return { success: false }
    } else {
      const response = await fetch('/api/mini-auth/complete-siwe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: finalPayload,
          nonce,
        }),
      })
      const json = await response.json()
      setWalletAuth(json)
      await requestPermission()
    }
  }

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1>NAME: {MiniKit.user?.username}</h1>
        <button onClick={() => signInWithWallet()}>Sign with wallet</button>
        <p>{JSON.stringify(walletAuth)}</p>
      </main>
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
        <h1>Memorioso</h1>
      </footer>
    </div>
  )
}
