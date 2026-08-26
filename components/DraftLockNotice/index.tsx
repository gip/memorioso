'use client'

// What an author sees when their drafts are encrypted and this device cannot
// read them: a browser that has never held the key, or one whose storage was
// cleared. Signing in again derives the key from the login itself; the recovery
// code is the way back when that no longer works.

import { useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDraftKey } from '@/lib/draft-crypto/provider'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const DraftLockNotice = ({ title = 'Your drafts are locked' }: { title?: string }) => {
  const { needsRecoveryCode, error, unlockWithCode } = useDraftKey()
  const { signInWithWorldId } = useWorldIdAuth()
  const [code, setCode] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showCodeEntry, setShowCodeEntry] = useState(needsRecoveryCode)

  const submitCode = async () => {
    setIsUnlocking(true)
    try {
      await unlockWithCode(code)
      setCode('')
    } catch {
      // The provider surfaces the reason; leaving the field filled lets the
      // author correct a typo rather than retype the whole code.
    } finally {
      setIsUnlocking(false)
    }
  }

  return (
    <Alert>
      <Lock className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="mt-1 text-sm">
          Drafts are encrypted on your device, so they can only be read where the key is.
          {needsRecoveryCode
            ? ' This sign-in did not produce the key, so it needs your recovery code.'
            : ' Signing in again unlocks them.'}
        </p>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!needsRecoveryCode && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                signInWithWorldId().catch(() => undefined)
              }}
            >
              Sign in again
            </Button>
          )}
          {!showCodeEntry && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowCodeEntry(true)}>
              Use recovery code
            </Button>
          )}
        </div>

        {showCodeEntry && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!isUnlocking && code.trim()) void submitCode()
            }}
          >
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="max-w-[16rem] font-mono uppercase"
              aria-label="Recovery code"
            />
            <Button type="submit" size="sm" disabled={isUnlocking || !code.trim()}>
              {isUnlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Unlock'}
            </Button>
          </form>
        )}
      </AlertDescription>
    </Alert>
  )
}
