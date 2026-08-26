'use client'

// The one showing of the recovery code.
//
// It exists nowhere else — the server holds only what it wraps, and nothing
// readable — so this dialog is the author's single chance to keep it. That is
// why it cannot be dismissed by clicking away, and why the confirmation is an
// explicit checkbox rather than a button that is easy to click past.

import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDraftKey } from '@/lib/draft-crypto/provider'

export const RecoveryCodeDialog = () => {
  const { recoveryCode, acknowledgeRecoveryCode } = useDraftKey()
  const [confirmed, setConfirmed] = useState(false)

  if (!recoveryCode) return null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && confirmed) acknowledgeRecoveryCode()
      }}
    >
      <DialogContent className="sm:max-w-md" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Save your recovery code
          </DialogTitle>
          <DialogDescription>
            Your drafts are encrypted on your device. This code is the only way back into them if
            you forget your passphrase. We cannot show it again, and we cannot recover it.
          </DialogDescription>
        </DialogHeader>

        <p className="select-all rounded-lg border bg-muted px-4 py-3 text-center font-mono text-lg tracking-widest">
          {recoveryCode}
        </p>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I have saved this code somewhere safe.</span>
        </label>

        <DialogFooter>
          <Button type="button" disabled={!confirmed} onClick={acknowledgeRecoveryCode}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
