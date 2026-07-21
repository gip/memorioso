'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

import { Button } from "@/components/ui/button"
import { ArrowLeft, LogIn, PenLine } from 'lucide-react'
import { Diamond } from '@/components/Diamond'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
export const Header = () => {
  const router = useRouter()
  const pathname = usePathname()
  const {
    user,
    error: authError,
    isWorldAppLoginPending,
    signInWithWorldId,
  } = useWorldIdAuth()
  const [signInError, setSignInError] = useState<string | null>(null)
  const authMessage = signInError || authError

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    }
  }

  const showBackButton = () => {
    return pathname !== '/'
  }

  const isWriting = pathname?.startsWith('/d/')

  const handleSignIn = () => {
    setSignInError(null)
    signInWithWorldId().catch((error) => {
      setSignInError(error instanceof Error ? error.message : 'Could not start World ID login')
    })
  }

  useEffect(() => {
    if (user) {
      setSignInError(null)
    }
  }, [user])

  return (
    <header className="sticky top-0 z-10 bg-background border-b shadow-sm">
      <div className="container mx-auto flex items-center justify-between py-2 px-4">
        {showBackButton() ? (
          <Button size="icon" className="rounded-full w-10 h-10" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Go back</span>
          </Button>
        ) : (
          <div className="w-10" aria-hidden />
        )}
        <div className="flex-1 flex justify-center">
          <Link href="/" passHref>
            <h1 className="text-xl font-bold cursor-pointer flex items-center gap-2">
              Memorioso
              <MemMark size={34} />
            </h1>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {!user && (
            <Button
              className="rounded-full w-10 h-10"
              size="icon"
              onClick={handleSignIn}
            >
              <LogIn className="h-5 w-5" />
              <span className="sr-only">Log in</span>
            </Button>
          )}
          {user && !isWriting && (
            <Button className="rounded-full h-10 px-4" onClick={() => router.push('/d/new')}>
              <PenLine className="h-4 w-4 mr-1.5" />
              Write
            </Button>
          )}
          {user && (
            <Diamond atBottom={false} />
          )}
        </div>
      </div>
      {!user && authMessage && (
        <div
          role="alert"
          className="border-t px-4 py-2 text-center text-xs text-destructive break-words"
        >
          {authMessage}
        </div>
      )}
      {!user && !authMessage && isWorldAppLoginPending && (
        <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
          Waiting for World App verification.
        </div>
      )}
    </header>
  )
}
