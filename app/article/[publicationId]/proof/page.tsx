import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CanonicalProofPage, canonicalPublicationMetadata } from '@/components/CanonicalPublicationPage'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'article', true)
}

async function ArticleProof({ params }: { params: Params }) {
  const { publicationId } = await params
  return <CanonicalProofPage publicationId={publicationId} expectedKind="article" />
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ArticleProof params={params} />
    </Suspense>
  )
}
