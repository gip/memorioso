import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { Divider } from '@/components/Divider'

const STEPS = [
  {
    title: 'Write',
    body: 'Open the editor and start typing. No account is needed to begin. Your draft stays on your device until you sign in, and is saved to your account the moment you do.',
  },
  {
    title: 'Prove you are human',
    body: 'Signing in uses World ID Proof of Human. Memorioso stores an application-specific identifier that cannot be traced back to you, and never your real name.',
  },
  {
    title: 'Sign the publication',
    body: 'Publishing produces a World ID proof over the exact text you wrote. Change a single character and the proof no longer matches, so the signature covers the publication itself, not just the account.',
  },
  {
    title: 'Register on World Chain',
    body: 'The proof is recorded in the Libro registry on World Chain. Registration is permissionless: anyone can verify it later without asking Memorioso, and without Memorioso being able to revoke it.',
  },
  {
    title: 'Verify anywhere',
    body: 'Every publication carries a portable Libro tag and a public manifest, so a signed text stays verifiable after it is quoted, copied, or republished somewhere else.',
  },
]

const Page = () => (
  <>
    <div className="mx-auto w-[90%] max-w-3xl py-8 lg:py-12">
      <h1 className="spectral text-4xl font-semibold leading-tight lg:text-5xl">
        How it works
      </h1>
      <p className="spectral mt-5 max-w-prose text-lg leading-relaxed text-muted-foreground">
        Soon, most of the content accessible to us will have been created by machines. Memorioso
        exists so that human-created texts stay identifiable as such: created, signed, shared,
        verified, and archived in a decentralized and permissionless way.
      </p>

      <Divider />

      <ol className="mt-8 space-y-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
              {index + 1}
            </span>
            <div>
              <h2 className="text-lg font-semibold">{step.title}</h2>
              <p className="mt-1 max-w-prose text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/d/new" className="text-blurple hover:underline">
          Start writing
        </Link>
        <Link href="/latest" className="text-blurple hover:underline">
          Latest publications
        </Link>
        <Link
          href="https://whitepaper.world.org/#proof-of-human-(poh)"
          className="text-blurple hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Proof of Human
        </Link>
      </div>
    </div>
    <Footer />
  </>
)

export default Page
