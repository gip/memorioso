'use client'

import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider'
import { WorldIdAuthProvider } from '@/lib/world-id/client-auth'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_ID_APP_ID }}>
      <WorldIdAuthProvider>{children}</WorldIdAuthProvider>
    </MiniKitProvider>
  )
}
