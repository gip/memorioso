'use client'

// What an author sees when their drafts are encrypted and this device cannot
// read them: a browser that has never held the key, or one whose storage was
// cleared. The passphrase is the way in; the recovery code is the way in when
// the passphrase is gone. It also covers the case where nothing is known yet,
// which is a different thing to say and is said differently.

import { useState } from 'react'
import { Lock, Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDraftKey } from '@/lib/draft-crypto/provider'

export const DraftLockNotice = ({ title = 'Your drafts are locked' }: { title?: string }) => {
  const { status, error, recheck, unlockWithPassphrase, unlockWithCode } = useDraftKey()
  const [usingCode, setUsingCode] = useState(false)
  const [secret, setSecret] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)

  // The server could not be reached, which says nothing about how these drafts
  // are stored. Asking an author who never encrypted anything for a passphrase
  // they were never given is worse than admitting the check failed.
  if (status === 'unavailable') {
    return (
      <Alert>
        <RefreshCw className="h-4 w-4" />
        <AlertTitle>Could not check how your drafts are stored</AlertTitle>
        <AlertDescription>
          <p className="mt-1 text-sm">
            Your work is being saved on this device in the meantime, and will go to your
            account as soon as this succeeds.
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={recheck}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const submit = async () => {
    setIsUnlocking(true)
    try {
      await (usingCode ? unlockWithCode(secret) : unlockWithPassphrase(secret))
      setSecret('')
    } catch {
      // The provider surfaces the reason; leaving the field filled lets the
      // author correct a typo rather than start over.
    } finally {
      setIsUnlocking(false)
    }
  }

  const switchMode = (next: boolean) => {
    setUsingCode(next)
    setSecret('')
  }

  return (
    <Alert>
      <Lock className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="mt-1 text-sm">
          Drafts are encrypted on your device, so they can only be read where the key is.
          {usingCode
            ? ' Enter the recovery code you saved when you set them up.'
            : ' Enter your passphrase to unlock them here.'}
        </p>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isUnlocking && secret.trim()) void submit()
          }}
        >
          <Input
            type={usingCode ? 'text' : 'password'}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={usingCode ? 'XXXX-XXXX-XXXX-XXXX' : 'Passphrase'}
            autoComplete={usingCode ? 'off' : 'current-password'}
            spellCheck={false}
            className={usingCode ? 'max-w-[16rem] font-mono uppercase' : 'max-w-[16rem]'}
            aria-label={usingCode ? 'Recovery code' : 'Passphrase'}
          />
          <Button type="submit" size="sm" disabled={isUnlocking || !secret.trim()}>
            {isUnlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Unlock'}
          </Button>
        </form>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2 px-0"
          onClick={() => switchMode(!usingCode)}
        >
          {usingCode ? 'Use passphrase instead' : 'I forgot my passphrase'}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
