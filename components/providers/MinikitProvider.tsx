'use client'

import { ReactNode, useEffect, createContext, useState } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'

export const MiniKitContext = createContext(false)

export const MiniKitProvider = ({ children }: { children: ReactNode }) => {
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const init = async () => {
      MiniKit.install(process.env.NEXT_PUBLIC_WLD_CLIENT_ID)
      if (MiniKit.isInstalled()) {
        setIsInstalled(true)
      }
    }
    init()
  }, [])

  return <MiniKitContext.Provider value={isInstalled}>{children}</MiniKitContext.Provider>
}
