'use client'

import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider'
import { PassphraseResetDialog } from '@/components/DraftPassphrase'
import { RecoveryCodeDialog } from '@/components/RecoveryCodeDialog'
import { DraftKeyProvider } from '@/lib/draft-crypto/provider'
import { WorldIdAuthProvider } from '@/lib/world-id/client-auth'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_ID_APP_ID }}>
      <WorldIdAuthProvider>
        {/* Inside the auth provider: the key belongs to one signed-in author,
            and is forgotten when that session ends. */}
        <DraftKeyProvider>
          {children}
          {/* Both follow an unlock, which can happen on any draft surface, so
              they are mounted app-wide rather than on one page. The recovery
              code in particular is shown exactly once. */}
          <RecoveryCodeDialog />
          <PassphraseResetDialog />
        </DraftKeyProvider>
      </WorldIdAuthProvider>
    </MiniKitProvider>
  )
}
