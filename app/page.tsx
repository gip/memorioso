'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Feed } from '@/components/Feed'
import { LatestPublications } from '@/components/LatestPublications'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const Page = () => {
  const { status } = useWorldIdAuth()
  const isAuthenticated = status === 'authenticated'
  const [showIntroduction, setShowIntroduction] = useState(true)

  return (
    <main className="w-full min-w-0 py-8">
      {showIntroduction && (
        <section className="spectral relative mx-auto w-full rounded-lg px-8 py-7 text-center text-lg italic leading-relaxed sm:px-12">
          <button
            type="button"
            onClick={() => setShowIntroduction(false)}
            className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close introduction"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <h1 className="text-3xl font-semibold leading-tight">For Human Creativity</h1>
          <p className="mt-4 text-muted-foreground">
            A protocol to protect and preserve human-created texts, stories, novels,
            publications, articles, pictures, and more.
          </p>
          <p className="mt-3 text-muted-foreground">
            Memorioso leverages World Network&apos;s{' '}
            <Link
              href="https://whitepaper.world.org/#proof-of-human-(poh)"
              className="text-blurple hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Proof of Human (PoH)
            </Link>{' '}
            to ensure that all users are real humans.
          </p>
        </section>
      )}

      {isAuthenticated && (
        <section id="your-drafts" className="mt-6 scroll-mt-8">
          <Feed />
        </section>
      )}
      <LatestPublications className="mt-8" pageSize={5} />
    </main>
  )
}

export default Page
