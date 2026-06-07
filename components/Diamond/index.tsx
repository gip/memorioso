'use client'

import { useEffect, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Diamond as DiamondIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from 'next/navigation'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const Diamond = ({ atBottom = true }) => {
  const router = useRouter()
  const {
    user,
    error: worldIdError,
    isWalletAuthPending,
    walletAuthDiagnostic,
    signInWithWallet,
    signOut,
  } = useWorldIdAuth()
  const [authError, setAuthError] = useState<string | null>(null)
  const authMessage = authError || worldIdError

  const handleSignIn = () => {
    setAuthError(null)
    signInWithWallet().catch((error) => {
      setAuthError(error instanceof Error ? error.message : 'Could not start wallet login')
    })
  }

  const handleSignOut = () => {
    setAuthError(null)
    signOut().catch((error) => {
      setAuthError(error instanceof Error ? error.message : 'Failed to log out')
    })
  }

  useEffect(() => {
    if (user) {
      setAuthError(null)
    }
  }, [user])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={`rounded-full w-10 h-10`}
          size="icon"
        >
          <DiamondIcon className="h-4 w-4" />
          <span className="sr-only">Actions menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {authMessage && (
          <div
            role="alert"
            className="max-w-56 break-words px-2 py-1.5 text-xs text-destructive"
          >
            {authMessage}
          </div>
        )}
        {!authMessage && isWalletAuthPending && (
          <div className="max-w-56 break-words px-2 py-1.5 text-xs text-muted-foreground">
            Waiting for World App wallet signature.
            {walletAuthDiagnostic && (
              <span className="block">{walletAuthDiagnostic}</span>
            )}
          </div>
        )}
        {!user && (
          <DropdownMenuItem onSelect={(event) => {
            event.preventDefault()
            handleSignIn()
          }}>
            Log in
          </DropdownMenuItem>
        )}
        {user && (
          <>
            <DropdownMenuItem onClick={() => router.push('/d/new')}>
              New draft
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/a/new')}>
              New author
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/info')}>
              Information
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(event) => {
              event.preventDefault()
              handleSignOut()
            }}>
              Log out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
} 
