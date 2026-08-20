import Link from 'next/link'
import { HomeDrafts } from '@/components/HomeDrafts'
import { LatestPublications } from '@/components/LatestPublications'

const Page = () => (
  <main className="w-full min-w-0 py-8">
    <section className="spectral mx-auto w-full rounded-lg px-8 py-7 text-center text-lg leading-relaxed text-black sm:px-12">
      <h1 className="text-3xl font-semibold italic leading-tight">For Human Creativity</h1>
      <p className="mt-4 text-black">
        A protocol to protect and preserve human-created texts, stories, novels,
        publications, articles, pictures, and more.
      </p>
      <p className="mt-3 text-black">
        Memorioso leverages World Network&apos;s{' '}
        <Link
          href="https://whitepaper.world.org/#proof-of-human-(poh)"
          className="text-blue-600 hover:text-blue-700 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Proof of Human (PoH)
        </Link>{' '}
        to ensure that all users are real humans.
      </p>
    </section>

    <HomeDrafts />
    <LatestPublications className="mt-8" pageSize={5} />
  </main>
)

export default Page
