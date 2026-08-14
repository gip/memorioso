import type { Metadata } from 'next'
import {
  CanonicalPublicationPage,
  canonicalPublicationMetadata,
} from '@/components/CanonicalPublicationPage'

type Params = Promise<{ publicationId: string }>
type SearchParams = Promise<{ signed?: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'article')
}

export default async function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ publicationId }, { signed }] = await Promise.all([params, searchParams])
  return <CanonicalPublicationPage publicationId={publicationId} expectedKind="article" signed={signed} />
}
