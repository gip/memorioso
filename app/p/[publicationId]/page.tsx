import { Suspense } from 'react'
import { Publication } from '@/components/Publication'
import { getProof, getPublication } from '@/lib/db/objects'
import { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { buildLibroEmbedManifest } from '@/lib/libro/embed'
import { extractReadableText, type LibroEmbedManifestV1 } from '@libro/core'

type Params = Promise<{ publicationId: string }>
type SearchParams = Promise<{ signed?: string }>

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
  const title = publication?.publication_title.trim()
    || (publication ? extractReadableText(publication.publication_content.html) : '')

  return {
    title,
    openGraph: {
      title,
      url: `https://memoriozo.xyz/p/${publicationId}`,
    },
  }
}

const Page = async ({ params, searchParams }: { params: Params; searchParams: SearchParams }) => {

  const { publicationId } = await params
  const { signed } = await searchParams
  const publication = await getCachedPublication(publicationId)
  const proof = await getCachedProof(publicationId)
  let embedManifest: LibroEmbedManifestV1 | null = null
  if (publication && proof) {
    try {
      embedManifest = buildLibroEmbedManifest(publication, proof, publicationId)
    } catch {
      embedManifest = null
    }
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      {publication && (
        <Publication
          publication={publication}
          proof={proof}
          proofLink={`/p/${publicationId}/proof`}
          celebrate={signed === '1'}
          embedManifest={embedManifest}
        />
      )}
    </Suspense>
  )
}

export default Page
