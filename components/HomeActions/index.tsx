'use client'

// The home page's navigation. On wide screens it sits in a sticky column to the
// left of the reading area so it costs the page no vertical space; when there is
// no room for a column it stacks above the feed instead.
//
// "Start writing" never asks for a login: the editor keeps anonymous work in
// local storage until the writer signs in.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Files, LogIn, PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Diamond } from '@/components/Diamond'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const QuietLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    href={href}
    className="py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
  >
    {children}
  </Link>
)

export const HomeActions = ({ className }: { className?: string }) => {
  const router = useRouter()
  const { status, user, signInWithWorldId } = useWorldIdAuth()
  const [signInError, setSignInError] = useState<string | null>(null)
  const isAuthenticated = status === 'authenticated'

  const handleSignIn = () => {
    setSignInError(null)
    signInWithWorldId().catch((error) => {
      setSignInError(error instanceof Error ? error.message : 'Could not start World ID login')
    })
  }

  return (
    <div className={className}>
      {/* The brand belongs to the rail on wide screens; the compact top bar
          carries it everywhere else. */}
      <Link href="/" className="mb-6 hidden items-center gap-2 lg:flex">
        <MemMark size={26} />
        <span className="text-xl font-bold">Memorioso</span>
      </Link>

      {/* One button style for every action: a rail of shouting CTAs competes with
          the text it sits next to. */}
      <div className="flex flex-col items-stretch gap-2">
        <Button variant="outline" className="justify-start px-3" onClick={() => router.push('/d/new')}>
          <PenLine className="h-4 w-4" />
          Start writing
        </Button>
        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="flex-1 justify-start px-3" asChild>
              <Link href="#your-drafts">
                <Files className="h-4 w-4" />
                Your drafts
              </Link>
            </Button>
            <Diamond atBottom={false} />
          </div>
        ) : (
          <Button variant="outline" className="justify-start px-3" onClick={handleSignIn}>
            <LogIn className="h-4 w-4" />
            Sign in with World ID
          </Button>
        )}
      </div>

      {isAuthenticated && user?.handle && (
        <p className="mt-3 text-xs text-muted-foreground">Signed in as @{user.handle}</p>
      )}
      {signInError && (
        <p role="alert" className="mt-3 break-words text-xs text-destructive">
          {signInError}
        </p>
      )}

      <nav className="mt-5 flex flex-col border-t pt-4">
        <QuietLink href="/latest">All publications</QuietLink>
        <QuietLink href="/how-it-works">How it works</QuietLink>
      </nav>
    </div>
  )
}
