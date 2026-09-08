'use client'

import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider'
import type { ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  return <MiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_ID_APP_ID }}>{children}</MiniKitProvider>
}
