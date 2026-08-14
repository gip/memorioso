import type { Metadata } from 'next'
import { CanonicalProofPage, canonicalPublicationMetadata } from '@/components/CanonicalPublicationPage'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'short', true)
}

export default async function Page({ params }: { params: Params }) {
  const { publicationId } = await params
  return <CanonicalProofPage publicationId={publicationId} expectedKind="short" />
}
