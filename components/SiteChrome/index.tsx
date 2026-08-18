'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, Menu } from 'lucide-react'

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
import { YourDraftsMenuGroup } from '@/components/YourDraftsButton'
import { isAuthRequiredPath } from '@/lib/auth-routes'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const SiteChrome = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname() || '/'
  const router = useRouter()
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
  const showMobileBackButton = pathname !== '/'
  const shouldRedirectAfterLogout = status === 'unauthenticated' && isAuthRequiredPath(pathname)

  const handleSignIn = () => {
    setAccountError(null)
    signInWithWorldId().catch((error) => {
      setAccountError(error instanceof Error ? error.message : 'Could not start World ID login')
    })
  }

  const handleBack = () => {
    // A freshly signed publication is the end of the publish flow, not a step
    // inside it. Walking back from there would replay the steps the user just
    // finished, so send them home instead. Read the query off the location
    // rather than useSearchParams: this component wraps every route, and the
    // hook would opt the whole app out of prerendering.
    const isFreshlySigned =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('signed') === '1'
    if (isFreshlySigned) {
      router.replace('/')
      return
    }
    router.back()
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

  useEffect(() => {
    if (shouldRedirectAfterLogout) router.replace('/')
  }, [router, shouldRedirectAfterLogout])

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <header className="sticky top-0 z-30 border-b bg-background shadow-sm lg:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <Link href="/" className="flex items-center gap-2">
            <MemMark size={28} />
            <span className="text-lg font-bold">Memorioso</span>
          </Link>
          <div className="flex items-center gap-1.5">
            {showMobileBackButton && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="h-9 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only min-[360px]:not-sr-only">Back</span>
              </Button>
            )}
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
              {isAuthenticated && (
                <>
                  <DropdownMenuSeparator />
                  <YourDraftsMenuGroup />
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/latest">Browse articles</Link>
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
                    <Link href="/activity">My drafts</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/profile">Profile</Link>
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

      <div className="mx-auto grid w-full max-w-[740px] flex-1 grid-cols-1 px-4 lg:min-h-0 lg:max-w-none lg:grid-cols-[12rem_minmax(0,740px)_minmax(0,1fr)] lg:gap-4 lg:px-6 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,740px)_minmax(12rem,1fr)] xl:gap-8">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
          <aside className="hidden lg:block">
            <HomeActions className="w-full max-w-[12rem] py-8" />
          </aside>
          <Footer className="order-last lg:order-none lg:w-full lg:max-w-[12rem]" />
        </div>

        <div className="min-h-full min-w-0 lg:col-start-2 lg:row-start-1 lg:h-full lg:min-h-0 lg:overscroll-y-contain lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
          <div className="flex min-h-full min-w-0 flex-col lg:mx-auto lg:w-full lg:max-w-[700px]">
            {!shouldRedirectAfterLogout && children}
          </div>
        </div>

        <div
          id="site-right-pane"
          className="hidden xl:col-start-3 xl:row-start-1 xl:flex xl:h-full xl:min-h-0 xl:overflow-hidden"
        />
      </div>
    </div>
  )
}
