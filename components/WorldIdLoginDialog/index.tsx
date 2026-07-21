'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, LogIn, UserPlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'

type LookupState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'checking' }
  | { status: 'exists'; handle: string; canLogin: boolean }
  | { status: 'available'; handle: string }
  | { status: 'error'; message: string }

type WorldIdLoginDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogin: (handle: string) => Promise<void>
  onSignup: (handle: string) => Promise<void>
  error: string | null
}

export const WorldIdLoginDialog = ({
  open,
  onOpenChange,
  onLogin,
  onSignup,
  error,
}: WorldIdLoginDialogProps) => {
  const [value, setValue] = useState('')
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const lookupSeq = useRef(0)

  useEffect(() => {
    if (!open) {
      setValue('')
      setLookup({ status: 'idle' })
      setIsSubmitting(false)
      lookupSeq.current += 1
    }
  }, [open])

  useEffect(() => {
    const handle = normalizeUserHandle(value)
    const seq = ++lookupSeq.current

    if (!handle) {
      setLookup({ status: 'idle' })
      return
    }

    if (!isValidUserHandle(handle)) {
      setLookup({ status: 'invalid' })
      return
    }

    setLookup({ status: 'checking' })
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/auth/handle?handle=${encodeURIComponent(handle)}`, {
          cache: 'no-store',
        })
        const body = await response.json() as {
          success?: boolean
          valid?: boolean
          exists?: boolean
          canLogin?: boolean
        }
        if (seq !== lookupSeq.current) {
          return
        }
        if (!response.ok || body.success !== true) {
          setLookup({ status: 'error', message: 'Could not check that name. Try again.' })
          return
        }
        if (!body.valid) {
          setLookup({ status: 'invalid' })
          return
        }
        if (body.exists) {
          setLookup({ status: 'exists', handle, canLogin: body.canLogin === true })
        } else {
          setLookup({ status: 'available', handle })
        }
      } catch {
        if (seq === lookupSeq.current) {
          setLookup({ status: 'error', message: 'Could not check that name. Try again.' })
        }
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [value])

  const submit = (action: (handle: string) => Promise<void>, handle: string) => {
    setIsSubmitting(true)
    action(handle).catch(() => {
      // Errors are surfaced through the `error` prop.
    }).finally(() => setIsSubmitting(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log in to Memorioso</DialogTitle>
          <DialogDescription>
            Enter your name to log in, or pick a new one to create an account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="your-name"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Account name"
          />
          <div className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {lookup.status === 'checking' && (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking @{normalizeUserHandle(value)}…
              </span>
            )}
            {lookup.status === 'invalid' && (
              <span>Names are 3–32 characters: lowercase letters, numbers, - or _.</span>
            )}
            {lookup.status === 'exists' && lookup.canLogin && (
              <span>@{lookup.handle} exists. Log in if this is you.</span>
            )}
            {lookup.status === 'exists' && !lookup.canLogin && (
              <span>@{lookup.handle} is taken and cannot be used to log in.</span>
            )}
            {lookup.status === 'available' && (
              <span>@{lookup.handle} is available. It will be your public author name.</span>
            )}
            {lookup.status === 'error' && <span>{lookup.message}</span>}
          </div>
          {lookup.status === 'exists' && lookup.canLogin && (
            <Button
              className="w-full"
              disabled={isSubmitting}
              onClick={() => submit(onLogin, lookup.handle)}
            >
              <LogIn className="h-4 w-4 mr-1.5" />
              Log in as @{lookup.handle} with World ID
            </Button>
          )}
          {lookup.status === 'available' && (
            <Button
              className="w-full"
              disabled={isSubmitting}
              onClick={() => submit(onSignup, lookup.handle)}
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Create @{lookup.handle} with World ID
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive break-words">
              {error}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Memorioso accounts require World ID Proof of Human. You will verify
            with World App on this device or by scanning a QR code.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
