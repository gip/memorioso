'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Footer } from '@/components/Footer'
import { HomeActions, getPrimarySiteAction } from '@/components/HomeActions'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const SiteChrome = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname() || '/'
  const {
    status,
    user,
    error: authError,
    isWorldAppLoginPending,
    signInWithWorldId,
    signOut,
  } = useWorldIdAuth()
  const [accountError, setAccountError] = useState<string | null>(null)
  const isAuthenticated = status === 'authenticated'
  const authMessage = accountError || authError
  const primaryAction = getPrimarySiteAction(pathname, isAuthenticated)

  const handleSignIn = () => {
    setAccountError(null)
    signInWithWorldId().catch((error) => {
      setAccountError(error instanceof Error ? error.message : 'Could not start World ID login')
    })
  }

  const handleSignOut = () => {
    setAccountError(null)
    signOut().catch((error) => {
      setAccountError(error instanceof Error ? error.message : 'Failed to log out')
    })
  }

  useEffect(() => {
    if (user) setAccountError(null)
  }, [user])

  return (
    <div className="flex min-h-screen flex-col">
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
            <DropdownMenuContent align="end" className="w-56">
              {authMessage && (
                <div role="alert" className="break-words px-2 py-1.5 text-xs text-destructive">
                  {authMessage}
                </div>
              )}
              {!authMessage && isWorldAppLoginPending && (
                <div className="break-words px-2 py-1.5 text-xs text-muted-foreground">
                  Waiting for World App verification.
                </div>
              )}
              {user?.handle && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Signed in as @{user.handle}
                </div>
              )}

              <DropdownMenuItem asChild>
                <Link href={primaryAction.href}>{primaryAction.label}</Link>
              </DropdownMenuItem>
              {pathname === '/' && isAuthenticated && (
                <DropdownMenuItem asChild>
                  <Link href="/#your-drafts">Your drafts</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link href="/latest">All publications</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/how-it-works">How it works</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              {!isAuthenticated ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleSignIn()
                  }}
                >
                  Sign in with World ID
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/#your-drafts">My drafts</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/info">Information</Link>
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
        {!isAuthenticated && authMessage && (
          <div
            role="alert"
            className="break-words border-t px-4 py-2 text-center text-xs text-destructive"
          >
            {authMessage}
          </div>
        )}
        {!isAuthenticated && !authMessage && isWorldAppLoginPending && (
          <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            Waiting for World App verification.
          </div>
        )}
      </header>

      <div className="mx-auto grid w-full max-w-[740px] flex-1 grid-cols-1 px-4 lg:max-w-none lg:grid-cols-[minmax(12rem,1fr)_minmax(0,700px)_minmax(0,1fr)] lg:gap-10 lg:px-6">
        <aside className="hidden lg:block">
          <HomeActions className="sticky top-8 w-full max-w-[12rem] py-8" />
        </aside>

        <div className="flex min-h-full min-w-0 flex-col">
          <div className="flex-1">{children}</div>
          <Footer />
        </div>

        <div className="hidden lg:block" aria-hidden />
      </div>
    </div>
  )
}
