import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CanonicalProofPage, canonicalPublicationMetadata } from '@/components/CanonicalPublicationPage'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'short', true)
}

async function ShortProof({ params }: { params: Params }) {
  const { publicationId } = await params
  return <CanonicalProofPage publicationId={publicationId} expectedKind="short" />
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ShortProof params={params} />
    </Suspense>
  )
}
