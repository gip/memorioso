import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import {
  CanonicalPublicationPage,
  canonicalPublicationMetadata,
} from '@/components/CanonicalPublicationPage'
import { ArticleSkeleton } from '@/components/Publication/ArticleSkeleton'
import { getCachedPublicationBySignalHash } from '@/lib/db/publication-cache'
import { getPublicationKind } from '@/lib/publication-kind'

type Params = Promise<{ signalHash: string }>

function normalizeSignalHash(signalHash: string): string | null {
  return /^0x[0-9a-fA-F]{64}$/.test(signalHash) ? signalHash.toLowerCase() : null
}

async function resolvePublication(signalHash: string) {
  const normalizedHash = normalizeSignalHash(signalHash)
  return normalizedHash ? getCachedPublicationBySignalHash(normalizedHash) : null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { signalHash } = await params
  const resolved = await resolvePublication(signalHash)
  if (!resolved) return {}

  return canonicalPublicationMetadata(
    resolved.publicationId,
    getPublicationKind(resolved.publication)
  )
}

async function PublicationByHash({ params }: { params: Params }) {
  const { signalHash } = await params
  const resolved = await resolvePublication(signalHash)
  if (!resolved) notFound()

  return (
    <CanonicalPublicationPage
      publicationId={resolved.publicationId}
      expectedKind={getPublicationKind(resolved.publication)}
    />
  )
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <PublicationByHash params={params} />
    </Suspense>
  )
}
