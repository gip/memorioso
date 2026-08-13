'use client'

import Link from 'next/link'
import { Feed } from '@/components/Feed'
import { LatestPublications } from '@/components/LatestPublications'
import { HomeActions } from '@/components/HomeActions'
import { Footer } from '@/components/Footer'
import { Divider } from '@/components/Divider'
import { MemMark } from '@/components/MemMark'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const Page = () => {
  const { status } = useWorldIdAuth()
  const isAuthenticated = status === 'authenticated'

  return (<>
    <div className="mx-auto w-[90%] max-w-6xl">
      {/* Masthead: the overview and the actions share the top of the page and
          deliberately stop short of half the viewport so the feed shows through. */}
      <header className="grid gap-6 py-6 lg:grid-cols-5 lg:items-start lg:gap-12 lg:pb-10 lg:pt-4">
        <div className="lg:col-span-3">
          <Link href="/" className="mb-4 hidden items-center gap-2 lg:flex">
            <MemMark size={30} />
            <span className="text-2xl font-bold">Memorioso</span>
          </Link>
          <h1 className="spectral text-3xl font-semibold leading-tight lg:text-5xl">
            For Human Creativity
          </h1>
          <div className="spectral mt-4 max-w-prose leading-relaxed text-muted-foreground lg:mt-5 lg:text-xl">
            <p>
              A protocol to protect and preserve human-created texts, stories, novels,
              publications, articles, pictures, and more.
            </p>
            <p className="mt-3">
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
          </div>
        </div>
        <HomeActions className="lg:col-span-2" />
      </header>

      <Divider animate />

      <main className="py-6">
        {isAuthenticated && (
          <section id="your-drafts" className="scroll-mt-20">
            <Feed />
          </section>
        )}
        <LatestPublications className={isAuthenticated ? 'mt-10' : undefined} limit={12} />
      </main>
    </div>
    <Footer />
  </>)
}

export default Page
