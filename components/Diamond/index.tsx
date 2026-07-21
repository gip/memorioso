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
    isWorldAppLoginPending,
    signInWithWorldId,
    signOut,
  } = useWorldIdAuth()
  const [authError, setAuthError] = useState<string | null>(null)
  const authMessage = authError || worldIdError

  const handleSignIn = () => {
    setAuthError(null)
    signInWithWorldId().catch((error) => {
      setAuthError(error instanceof Error ? error.message : 'Could not start World ID login')
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
        {!authMessage && isWorldAppLoginPending && (
          <div className="max-w-56 break-words px-2 py-1.5 text-xs text-muted-foreground">
            Waiting for World App verification.
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
            {user.handle && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Logged in as @{user.handle}
              </div>
            )}
            <DropdownMenuItem onClick={() => router.push('/d/new')}>
              New draft
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/')}>
              My drafts
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
