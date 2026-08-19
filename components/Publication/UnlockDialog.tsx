'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const UnlockDialog = ({
  contentEndpoint,
  priceUsd,
}: {
  contentEndpoint: string
  /** Null when this deployment takes no x402 payments: sign-in is the only way in. */
  priceUsd: string | null
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const { status, signInWithWorldId } = useWorldIdAuth()
  const router = useRouter()

  const handleSignIn = async () => {
    await signInWithWorldId()
    setIsOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button className="gap-2" onClick={() => setIsOpen(true)}>
        <Lock className="h-4 w-4" aria-hidden />
        Read this publication
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>The rest is for verified humans</DialogTitle>
            <DialogDescription>
              The author chose to publish this behind a wall. Sign in with World ID to
              read it — proving you are a real person is all it takes, and it is free.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>
              Signing in also gives you an author handle, so you can publish
              human-signed writing of your own.
            </p>
            {priceUsd && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <p className="font-medium text-foreground">Reading as an agent?</p>
                <p className="mt-1">
                  Fetch <code className="break-all text-xs">{contentEndpoint}</code> and pay{' '}
                  ${priceUsd} in USDC over x402. The endpoint answers{' '}
                  <code className="text-xs">402</code> with its payment requirements.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Not now
            </Button>
            <Button onClick={handleSignIn} disabled={status === 'loading'}>
              Sign in with World ID
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
