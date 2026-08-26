'use client'

// Choosing a passphrase, and choosing not to.
//
// The passphrase is the only thing that opens an author's drafts on a device
// that has never held the key, and the server cannot help if it is lost — so it
// is confirmed twice when set, and the way out of encryption entirely is offered
// plainly rather than hidden. An author who declines is told what that means:
// their drafts sit in the database as prose until they publish.

import { useState, type ReactNode } from 'react'
import { KeyRound, Loader2, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { passphraseProblem } from '@/lib/draft-crypto'
import { useDraftKey } from '@/lib/draft-crypto/provider'

type PassphraseFormProps = {
  submitLabel: string
  onSubmit: (passphrase: string) => Promise<void>
  children?: ReactNode
}

/**
 * Passphrase and confirmation. The mismatch check is what a stray character
 * from an autocorrecting keyboard runs into, which is why the passphrase itself
 * is never trimmed: catching it here is better than silently changing it.
 */
const PassphraseForm = ({ submitLabel, onSubmit, children }: PassphraseFormProps) => {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const problem = passphrase.length > 0 ? passphraseProblem(passphrase) : null
  const mismatched = confirmation.length > 0 && confirmation !== passphrase
  const canSubmit = !isSaving && passphrase.length > 0 && !problem && confirmation === passphrase

  const submit = async () => {
    setIsSaving(true)
    try {
      await onSubmit(passphrase)
      setPassphrase('')
      setConfirmation('')
    } catch {
      // The provider surfaces the reason; the fields keep what was typed so a
      // failed save is one retry rather than a retype.
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) void submit()
      }}
    >
      <Input
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        placeholder="Passphrase"
        autoComplete="new-password"
        aria-label="Passphrase"
      />
      <Input
        type="password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder="Confirm passphrase"
        autoComplete="new-password"
        aria-label="Confirm passphrase"
      />
      {problem && <p className="text-sm text-muted-foreground">{problem}</p>}
      {mismatched && <p className="text-sm text-destructive">Those two do not match</p>}

      <DialogFooter className="gap-2 sm:justify-between">
        {children}
        <Button type="submit" disabled={!canSubmit}>
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * The one-time choice, shown where it becomes relevant: the editor. It cannot be
 * clicked away, because both answers are answers and neither is a default worth
 * guessing on the author's behalf.
 */
export const DraftEncryptionSetup = () => {
  const { status, error, enableEncryption, skipEncryption } = useDraftKey()
  const [isDeclining, setIsDeclining] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  if (status !== 'unset') return null

  const decline = async () => {
    setIsSaving(true)
    try {
      await skipEncryption()
    } catch {
      // Surfaced by the provider; the dialog stays open to be retried.
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        {isDeclining ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldOff className="h-4 w-4" />
                Leave drafts unencrypted?
              </DialogTitle>
              <DialogDescription>
                Your drafts will be stored as ordinary text. Anyone who can read the database —
                including us — can read what you have written before you publish it. Published
                work is public either way; this is only about the part you have not finished.
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">
              You can turn encryption on later, and your existing drafts will be encrypted then.
            </p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setIsDeclining(false)}>
                Back
              </Button>
              <Button type="button" variant="secondary" disabled={isSaving} onClick={() => void decline()}>
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Leave them unencrypted'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Encrypt your drafts
              </DialogTitle>
              <DialogDescription>
                A passphrase encrypts your drafts in this browser, so unpublished work is not
                readable on our side. You will need it on each new device. We cannot reset it —
                you will get a recovery code next.
              </DialogDescription>
            </DialogHeader>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <PassphraseForm submitLabel="Encrypt my drafts" onSubmit={enableEncryption}>
              <Button type="button" variant="ghost" onClick={() => setIsDeclining(true)}>
                Don&apos;t encrypt
              </Button>
            </PassphraseForm>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Offered right after a recovery-code unlock. The code got the author back in,
 * but it is not something to type on every device, and this is the only moment
 * the key can be re-wrapped without asking for anything again.
 */
export const PassphraseResetDialog = () => {
  const { canSetPassphrase, error, resetPassphrase, dismissPassphraseReset } = useDraftKey()

  if (!canSetPassphrase) return null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismissPassphraseReset() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Set a new passphrase
          </DialogTitle>
          <DialogDescription>
            Your recovery code unlocked these drafts. Choose a passphrase now and you will not need
            the code again — it keeps working either way.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <PassphraseForm submitLabel="Save passphrase" onSubmit={resetPassphrase}>
          <Button type="button" variant="ghost" onClick={dismissPassphraseReset}>
            Not now
          </Button>
        </PassphraseForm>
      </DialogContent>
    </Dialog>
  )
}
