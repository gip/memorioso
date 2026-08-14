import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
  CanonicalPublicationPage,
  canonicalPublicationMetadata,
} from '@/components/CanonicalPublicationPage'
import { ArticleSkeleton } from '@/components/Publication/ArticleSkeleton'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'article')
}

async function Article({ params }: { params: Params }) {
  const { publicationId } = await params
  return <CanonicalPublicationPage publicationId={publicationId} expectedKind="article" />
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <Article params={params} />
    </Suspense>
  )
}
