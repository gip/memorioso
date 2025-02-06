'use client'

import { ReactNode, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'

export default function MiniKitProvider({ children }: { children: ReactNode }) {

  useEffect(() => {
    const init = async () => {
        MiniKit.install(process.env.NEXT_PUBLIC_WLD_CLIENT_ID)
    }
    init()
  }, [])

  return <>{children}</>
}
