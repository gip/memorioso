'use client'

import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider'
import { RecoveryCodeDialog } from '@/components/RecoveryCodeDialog'
import { DraftKeyProvider } from '@/lib/draft-crypto/provider'
import { WorldIdAuthProvider } from '@/lib/world-id/client-auth'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_ID_APP_ID }}>
      <WorldIdAuthProvider>
        {/* Inside the auth provider: the key is derived from a login, and is
            forgotten when that login ends. */}
        <DraftKeyProvider>
          {children}
          {/* The recovery code is shown exactly once, so it is mounted app-wide
              rather than on whichever page happened to trigger the unlock. */}
          <RecoveryCodeDialog />
        </DraftKeyProvider>
      </WorldIdAuthProvider>
    </MiniKitProvider>
  )
}
