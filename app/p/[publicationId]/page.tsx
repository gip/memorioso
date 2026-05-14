import { Suspense } from 'react'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Publication } from '@/components/Publication'
import { getProof, getPublication } from '@/lib/db/objects'
import { Metadata } from 'next'
import { unstable_cache } from 'next/cache'

type Params = Promise<{ publicationId: string }>

const getCachedPublication = unstable_cache(
  async (publicationId: string) => {
    return getPublication(publicationId)
  },
  ['publication'],
  { revalidate: 3600 }
)

const getCachedProof = unstable_cache(
  async (publicationId: string) => {
    return getProof(publicationId)
  },
  ['publication-proof'],
  { revalidate: 3600 }
)

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  const publication = await getCachedPublication(publicationId)

  return {
    title: publication?.publication_title || 'Publication',
    openGraph: {
      title: publication?.publication_title || 'Publication',
      url: `https://memoriozo.xyz/p/${publicationId}`,
    },
  }
}

const Page = async ({ params }: { params: Params }) => {

  const { publicationId } = await params
  const publication = await getCachedPublication(publicationId)
  const proof = await getCachedProof(publicationId)

  return (<>
    <Header />
    <Suspense fallback={<div>Loading...</div>}>
      {publication && <Publication publication={publication} proof={proof} proofLink={`/p/${publicationId}/proof`} />}
    </Suspense>
    <Footer />
  </>)
}

export default Page
