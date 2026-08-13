'use client'

// Site-wide chrome. There is deliberately no top header on large screens: the
// page itself carries the brand (the home masthead, an article's byline), and
// navigation lives in two unobtrusive fixed clusters. Below `lg` that does not
// work on a phone, so a compact sticky bar comes back with everything folded
// into a single menu.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogIn, Menu, PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Diamond } from '@/components/Diamond'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const SiteChrome = () => {
  const router = useRouter()
  const pathname = usePathname()
  const {
    user,
    error: authError,
    isWorldAppLoginPending,
    signInWithWorldId,
    signOut,
  } = useWorldIdAuth()
  const [signInError, setSignInError] = useState<string | null>(null)
  const authMessage = signInError || authError

  const isHome = pathname === '/'
  const isWriting = pathname?.startsWith('/d/') ?? false

  const handleSignIn = () => {
    setSignInError(null)
    signInWithWorldId().catch((error) => {
      setSignInError(error instanceof Error ? error.message : 'Could not start World ID login')
    })
  }

  const handleSignOut = () => {
    setSignInError(null)
    signOut().catch((error) => {
      setSignInError(error instanceof Error ? error.message : 'Failed to log out')
    })
  }

  useEffect(() => {
    if (user) {
      setSignInError(null)
    }
  }, [user])

  return (
    <>
      {/* Small screens: compact wordmark + one menu. */}
      <header className="sticky top-0 z-30 border-b bg-background shadow-sm lg:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <Link href="/" className="flex items-center gap-2">
            <MemMark size={28} />
            <span className="text-lg font-bold">Memorioso</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="h-10 w-10 rounded-full">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {authMessage && (
                <div role="alert" className="max-w-56 break-words px-2 py-1.5 text-xs text-destructive">
                  {authMessage}
                </div>
              )}
              {!authMessage && isWorldAppLoginPending && (
                <div className="max-w-56 break-words px-2 py-1.5 text-xs text-muted-foreground">
                  Waiting for World App verification.
                </div>
              )}
              {user?.handle && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Logged in as @{user.handle}
                </div>
              )}
              <DropdownMenuItem onClick={() => router.push('/d/new')}>
                Start writing
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/latest')}>
                Latest publications
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/how-it-works')}>
                How it works
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!user && (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleSignIn()
                  }}
                >
                  Log in
                </DropdownMenuItem>
              )}
              {user && (
                <>
                  <DropdownMenuItem onClick={() => router.push('/')}>
                    My drafts
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/info')}>
                    Information
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault()
                      handleSignOut()
                    }}
                  >
                    Log out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!user && authMessage && (
          <div
            role="alert"
            className="break-words border-t px-4 py-2 text-center text-xs text-destructive"
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

      {/* Large screens: no bar at all. These sit at the top of the document and
          scroll away with the page rather than hovering over it, so nothing ever
          passes underneath them. The masthead already brands the home page, so
          the brand link only appears on interior pages. */}
      {!isHome && (
        <Link
          href="/"
          className="absolute left-6 top-5 z-40 hidden items-center gap-2 text-sm font-semibold lg:flex"
        >
          <MemMark size={22} />
          Memorioso
        </Link>
      )}
      <div className="absolute right-6 top-5 z-40 hidden items-center gap-2 lg:flex">
        {user && !isWriting && (
          <Button className="h-10 rounded-full px-4" onClick={() => router.push('/d/new')}>
            <PenLine className="mr-1.5 h-4 w-4" />
            Write
          </Button>
        )}
        {user ? (
          <Diamond atBottom={false} />
        ) : (
          <Button className="h-10 rounded-full px-4" onClick={handleSignIn}>
            <LogIn className="mr-1.5 h-4 w-4" />
            Log in
          </Button>
        )}
      </div>
    </>
  )
}
