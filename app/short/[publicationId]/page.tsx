import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
  CanonicalPublicationPage,
  canonicalPublicationMetadata,
} from '@/components/CanonicalPublicationPage'
import { ShortSkeleton } from '@/components/Publication/ShortSkeleton'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  return canonicalPublicationMetadata(publicationId, 'short')
}

async function Short({ params }: { params: Params }) {
  const { publicationId } = await params
  return <CanonicalPublicationPage publicationId={publicationId} expectedKind="short" />
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ShortSkeleton />}>
      <Short params={params} />
    </Suspense>
  )
}
