'use client'

import Link from 'next/link'
import { Feed } from '@/components/Feed'
import { LatestPublications } from '@/components/LatestPublications'
import { Divider } from '@/components/Divider'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const Page = () => {
  const { status } = useWorldIdAuth()
  const isAuthenticated = status === 'authenticated'

  return (
    <main className="w-full min-w-0 py-8">
      <section className="spectral mx-auto max-w-prose text-center text-lg leading-relaxed">
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

      <Divider animate />

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
