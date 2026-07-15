'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Feed } from '@/components/Feed'
import { LatestPublications } from '@/components/LatestPublications'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { Divider } from '@/components/Divider'
import { Button } from '@/components/ui/button'
import { useWorldIdAuth, isInWorldApp } from '@/lib/world-id/client-auth'

const Page = () => {
  const { status, signInWithWorldId } = useWorldIdAuth()
  const router = useRouter()
  // World App is only detectable client-side; avoid hydration mismatch.
  const [canWrite, setCanWrite] = useState(false)

  useEffect(() => {
    setCanWrite(isInWorldApp())
  }, [])

  const handleStartWriting = () => {
    signInWithWorldId()
      .then(() => router.push('/d/new'))
      .catch(() => {
        // Error is surfaced by the header banner.
      })
  }

  return (<>
    <Header />
    <div className="text-center mt-4">
      {status === 'authenticated' && <h1 className="text-lg">
        For Human Creativity
      </h1>}
      {status !== 'authenticated' && <h1 className="text-5xl">
        For Human Creativity
      </h1>}
      <Divider animate />
    </div>
    {status === 'authenticated' && <Feed />}
    {status !== 'authenticated' &&
      <div className="max-w-6xl mx-auto py-12 px-4">
        <div className="grid gap-12 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-3 text-center lg:text-left text-2xl spectral">
            {/* Soon, most of the content accessible to us will have been created by machines. The space for human-created texts,
            stories, novels, publications, articles, and pictures will shrink dramatically. Storing and preserving them will
            become significantly more challenging. Our mission is to ensure human creativity thrives in the future by empowering
            individuals to create, sign, share, verify, archive and pay for content made by other humans in a fully decentralized
            and permissionless way. So simple. So important.<br /> */}
            A protocol to protect and preserve human-created texts, stories, novels, publications, articles, pictures, and more.<br />
            <br />
            Memorioso leverages World Network&apos;s <Link href="https://whitepaper.world.org/#proof-of-human-(poh)" className="text-blurple hover:underline" target="_blank" rel="noopener noreferrer">Proof of Human (PoH)</Link> to ensure that all users are real humans.
            <div className="mt-8 flex flex-col items-center lg:items-start gap-3">
              {canWrite && (
                <Button onClick={handleStartWriting}>Start writing</Button>
              )}
              <Button asChild variant={canWrite ? 'outline' : 'default'}>
                <Link href="/latest">See Latest Publications</Link>
              </Button>
            </div>
          </div>
          <LatestPublications className="lg:col-span-2" limit={4} />
        </div>
      </div>}
    <Footer />
  </>)
}

export default Page
