'use client'

// The home masthead's action column. Sits to the right of the overview on wide
// screens and underneath it otherwise. "Start writing" never asks for a login:
// the editor keeps anonymous work in local storage until the writer signs in.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, LogIn, PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const QuietLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    href={href}
    className="group flex items-center justify-between py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
  >
    {children}
    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
  </Link>
)

export const HomeActions = ({ className }: { className?: string }) => {
  const router = useRouter()
  const { status, signInWithWorldId } = useWorldIdAuth()
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
      <div className="flex flex-col gap-3">
        <Button size="lg" onClick={() => router.push('/d/new')}>
          <PenLine className="mr-2 h-4 w-4" />
          Start writing
        </Button>
        {isAuthenticated ? (
          <Button size="lg" variant="outline" asChild>
            <Link href="#your-drafts">Your drafts</Link>
          </Button>
        ) : (
          <Button size="lg" variant="outline" onClick={handleSignIn}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign in with World ID
          </Button>
        )}
        {!isAuthenticated && (
          <p className="text-xs text-muted-foreground">
            No account needed to start. Sign in when you are ready to publish.
          </p>
        )}
        {signInError && (
          <p role="alert" className="break-words text-xs text-destructive">
            {signInError}
          </p>
        )}
      </div>
      <Separator className="my-5" />
      <nav className="flex flex-col">
        <QuietLink href="/latest">Latest publications</QuietLink>
        <QuietLink href="/how-it-works">How it works</QuietLink>
      </nav>
    </div>
  )
}
