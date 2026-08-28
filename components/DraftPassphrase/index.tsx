'use client'

// Choosing a passphrase, and choosing not to.
//
// The passphrase is the only thing that opens an author's drafts on a device
// that has never held the key, and the server cannot help if it is lost — so it
// is confirmed twice when set, and not asked for at all until the author has
// said they want it. Declining is the other half of one question rather than a
// way out of a form, and it says what it costs: their drafts sit in the database
// as prose until they publish.

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
 * The one-time choice, shown where it becomes relevant: the editor.
 *
 * Both answers are offered as answers, side by side and stated in full, rather
 * than a passphrase form with a way out tucked under it: an author who does not
 * want encryption should not have to work out how to say so. It cannot be
 * clicked away, because neither answer is a default worth guessing on the
 * author's behalf.
 */
export const DraftEncryptionSetup = () => {
  const { status, error, enableEncryption, skipEncryption } = useDraftKey()
  const [isChoosingPassphrase, setIsChoosingPassphrase] = useState(false)
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
        {isChoosingPassphrase ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Choose a passphrase
              </DialogTitle>
              <DialogDescription>
                You will need it on each new device. We cannot reset it — you will get a
                recovery code next, which is the way back if you forget it.
              </DialogDescription>
            </DialogHeader>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <PassphraseForm submitLabel="Encrypt my drafts" onSubmit={enableEncryption}>
              <Button type="button" variant="ghost" onClick={() => setIsChoosingPassphrase(false)}>
                Back
              </Button>
            </PassphraseForm>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>How should your drafts be stored?</DialogTitle>
              <DialogDescription>
                Published work is public either way. This is only about the part you have not
                finished yet.
              </DialogDescription>
            </DialogHeader>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <div className="grid gap-2.5">
              <ChoiceCard
                icon={<KeyRound className="h-4 w-4" />}
                title="Encrypt them"
                note="Recommended"
                disabled={isSaving}
                onClick={() => setIsChoosingPassphrase(true)}
              >
                A passphrase encrypts your drafts in this browser, so nobody on our side can
                read them. You will need it on each new device, and we cannot reset it.
              </ChoiceCard>

              <ChoiceCard
                icon={<ShieldOff className="h-4 w-4" />}
                title="Don't encrypt them"
                busy={isSaving}
                disabled={isSaving}
                onClick={() => void decline()}
              >
                Nothing to remember. Your drafts are stored as ordinary text, so anyone who can
                read the database — including us — can read them before you publish. You can turn
                encryption on later.
              </ChoiceCard>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

type ChoiceCardProps = {
  icon: ReactNode
  title: string
  note?: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

/** One answer, whole: what it does and what it costs, on the thing you press. */
const ChoiceCard = ({ icon, title, note, busy, disabled, onClick, children }: ChoiceCardProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition hover:border-blurple/30 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
  >
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blurple/10 text-blurple">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {note && <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{note}</span>}
      </span>
      <span className="mt-1 block text-sm text-muted-foreground">{children}</span>
    </span>
  </button>
)

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
