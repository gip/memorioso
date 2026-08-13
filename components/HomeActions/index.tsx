'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeft,
  ChevronDown,
  Files,
  LogIn,
  PenLine,
  UserRound,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export type PrimarySiteAction = {
  href: string
  label: string
  icon: 'back' | 'write'
}

export const getPrimarySiteAction = (
  pathname: string,
  isAuthenticated: boolean
): PrimarySiteAction => {
  if (pathname.startsWith('/d/')) {
    return {
      href: isAuthenticated ? '/#your-drafts' : '/',
      label: isAuthenticated ? 'Back to drafts' : 'Back home',
      icon: 'back',
    }
  }

  if (/^\/p\/[^/]+\/proof\/?$/.test(pathname)) {
    return {
      href: pathname.replace(/\/proof\/?$/, ''),
      label: 'Back to publication',
      icon: 'back',
    }
  }

  return { href: '/d/new', label: 'Start writing', icon: 'write' }
}

const QuietLink = ({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) => (
  <Link
    href={href}
    aria-current={active ? 'page' : undefined}
    className={`py-1.5 text-sm transition-colors hover:text-foreground ${
      active ? 'font-medium text-foreground' : 'text-muted-foreground'
    }`}
  >
    {children}
  </Link>
)

export const HomeActions = ({ className }: { className?: string }) => {
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
  const PrimaryIcon = primaryAction.icon === 'back' ? ArrowLeft : PenLine

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
    <div className={className}>
      <Link href="/" className="mb-7 flex items-center justify-center gap-2.5">
        <MemMark size={32} />
        <span className="text-2xl font-bold">Memorioso</span>
      </Link>

      <div className="flex flex-col items-stretch gap-2">
        <Button variant="outline" className="justify-start px-3" asChild>
          <Link href={primaryAction.href}>
            <PrimaryIcon className="h-4 w-4" />
            {primaryAction.label}
          </Link>
        </Button>

        {pathname === '/' && isAuthenticated && (
          <Button variant="outline" className="justify-start px-3" asChild>
            <Link href="/#your-drafts">
              <Files className="h-4 w-4" />
              Your drafts
            </Link>
          </Button>
        )}

        {isAuthenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-w-0 justify-start px-3">
                <UserRound className="h-4 w-4 shrink-0" />
                <span className="truncate">{user?.handle ? `@${user.handle}` : 'Account'}</span>
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/#your-drafts">My drafts</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/info">Information</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  handleSignOut()
                }}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="outline" className="justify-start px-3" onClick={handleSignIn}>
            <LogIn className="h-4 w-4" />
            Sign in with World ID
          </Button>
        )}
      </div>

      {authMessage && (
        <p role="alert" className="mt-3 break-words text-xs text-destructive">
          {authMessage}
        </p>
      )}
      {!authMessage && isWorldAppLoginPending && (
        <p className="mt-3 break-words text-xs text-muted-foreground">
          Waiting for World App verification.
        </p>
      )}

      <nav className="mt-5 flex flex-col border-t pt-4">
        <QuietLink href="/latest" active={pathname === '/latest'}>
          All publications
        </QuietLink>
        <QuietLink href="/how-it-works" active={pathname === '/how-it-works'}>
          How it works
        </QuietLink>
      </nav>
    </div>
  )
}
