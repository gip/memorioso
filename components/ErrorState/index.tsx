'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MemMark } from '@/components/MemMark'

/**
 * The branded fallback behind every error boundary. Deliberately says what a reader
 * can do next rather than "a server error occurred": the page failing is almost never
 * a sign that anything they wrote or published is at risk.
 */
export const ErrorState = ({
  digest,
  retry,
  standalone = false,
}: {
  digest?: string
  retry?: () => void
  /** Set when rendering outside the site chrome, so the mark still anchors the page. */
  standalone?: boolean
}) => (
  <main className="flex flex-1 items-center justify-center px-4 py-20 text-center sm:py-28">
    <div className="max-w-xl">
      {standalone && (
        <div className="mb-8 flex justify-center">
          <MemMark size={32} />
        </div>
      )}

      <h1 className="spectral text-pretty text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
        This page didn’t load.
      </h1>
      <p className="mx-auto mt-5 max-w-lg text-pretty text-[17px] leading-relaxed text-muted-foreground">
        Something broke on our side, not yours. Nothing you have written or published is
        affected — signed publications stay on World Chain regardless.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {retry && (
          <Button variant="blurple" onClick={retry}>
            Try again
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/">Back to Memorioso</Link>
        </Button>
      </div>

      {digest && (
        <p className="mt-8 text-xs text-muted-foreground">
          Reference <code className="font-mono">{digest}</code>
        </p>
      )}
    </div>
  </main>
)
