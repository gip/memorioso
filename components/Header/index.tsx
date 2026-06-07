'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from "@/components/ui/button"
import { ArrowLeft, LogIn } from 'lucide-react'
import { Diamond } from '@/components/Diamond'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
export const Header = () => {
  const router = useRouter()
  const {
    user,
    error: authError,
    isWalletAuthPending,
    walletAuthDiagnostic,
    signInWithWallet,
  } = useWorldIdAuth()
  const [signInError, setSignInError] = useState<string | null>(null)
  const authMessage = signInError || authError

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    }
  }

  const showBackButton = () => {
    return true
  }

  const handleSignIn = () => {
    setSignInError(null)
    signInWithWallet().catch((error) => {
      setSignInError(error instanceof Error ? error.message : 'Could not start wallet login')
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
        {showBackButton() && (
          <Button size="icon" className="rounded-full w-10 h-10" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Go back</span>
          </Button>
        )}
        <div className="flex-1 flex justify-center">
          <Link href="/" passHref>
            <h1 className="text-xl font-bold cursor-pointer flex items-center">
              Memorioso
              <div style={{ display: 'inline-block', transform: 'rotate(50deg)', marginLeft: '0.5rem' }} className="text-blurple text-4xl">〄</div>
            </h1>
          </Link>
        </div>
        <div className="flex items-center">
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
        </div>
        {user && (
          <Diamond atBottom={false} />
        )}
      </div>
      {!user && authMessage && (
        <div
          role="alert"
          className="border-t px-4 py-2 text-center text-xs text-destructive break-words"
        >
          {authMessage}
        </div>
      )}
      {!user && !authMessage && isWalletAuthPending && (
        <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
          Waiting for World App wallet signature.
          {walletAuthDiagnostic && (
            <span className="block break-words">{walletAuthDiagnostic}</span>
          )}
        </div>
      )}
    </header>
  )
}
