'use client'

import Link from 'next/link'
import { Feed } from '@/components/Feed'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { Divider } from '@/components/Divider'
import { Button } from '@/components/ui/button'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

const Page = () => {
  const { status } = useWorldIdAuth()

  return (<>
    <Header />
    <div className="text-center mt-4">
      {status === 'authenticated' && <h1 className="text-lg">
        For Human Creativity
      </h1>}
      {status !== 'authenticated' && <h1 className="text-5xl">
        For Human Creativity
      </h1>}
      <Divider animate={false} />
    </div>
    {status === 'authenticated' && <Feed />}
    {status !== 'authenticated' &&
      <div className="max-w-4xl mx-auto py-12 px-4 text-center text-2xl spectral">
        {/* Soon, most of the content accessible to us will have been created by machines. The space for human-created texts,
        stories, novels, publications, articles, and pictures will shrink dramatically. Storing and preserving them will
        become significantly more challenging. Our mission is to ensure human creativity thrives in the future by empowering
        individuals to create, sign, share, verify, archive and pay for content made by other humans in a fully decentralized
        and permissionless way. So simple. So important.<br /> */}
        A protocol to protect and preserve human-created texts, stories, novels, publications, articles, pictures, and more.<br />
        <br />
        Memorioso leverages World Network&apos;s <Link href="https://whitepaper.world.org/#proof-of-human-(poh)" className="text-blurple hover:underline" target="_blank" rel="noopener noreferrer">Proof of Human (PoH)</Link> to ensure that all users are real humans.
        <div className="mt-8">
          <Button asChild>
            <Link href="/latest">See Latest Publications</Link>
          </Button>
        </div>
      </div>}
    <Footer />
  </>)
}

export default Page
