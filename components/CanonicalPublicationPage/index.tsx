import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { extractReadableText, type LibroEmbedManifestV1 } from '@libro/core'
import { Publication } from '@/components/Publication'
import { Proof } from '@/components/Proof'
import { getProof, getPublication } from '@/lib/db/objects'
import { buildLibroEmbedManifest } from '@/lib/libro/embed'
import {
  getPublicationKind,
  publicationPath,
  publicationProofPath,
  type PublicationKind,
} from '@/lib/publication-kind'

const getCachedPublication = unstable_cache(
  async (publicationId: string) => getPublication(publicationId),
  ['publication'],
  { revalidate: 3600 }
)

const getCachedProof = unstable_cache(
  async (publicationId: string) => getProof(publicationId),
  ['publication-proof'],
  { revalidate: 3600 }
)

export async function canonicalPublicationMetadata(
  publicationId: string,
  expectedKind: PublicationKind,
  proof = false
): Promise<Metadata> {
  const publication = await getCachedPublication(publicationId)
  if (!publication || getPublicationKind(publication) !== expectedKind) return {}
  const excerpt = extractReadableText(publication.publication_content.html)
  const title = expectedKind === 'article' ? publication.publication_title.trim() : excerpt.slice(0, 80)
  const url = `https://memorioso.xyz${proof
    ? publicationProofPath(expectedKind, publicationId)
    : publicationPath(expectedKind, publicationId)}`

  return {
    title: proof ? `Proof · ${title}` : title,
    description: excerpt.slice(0, 160),
    alternates: { canonical: url },
    openGraph: {
      title: proof ? `Proof · ${title}` : title,
      description: excerpt.slice(0, 160),
      url,
      type: 'article',
    },
  }
}

export async function CanonicalPublicationPage({
  publicationId,
  expectedKind,
  signed,
}: {
  publicationId: string
  expectedKind: PublicationKind
  signed?: string
}) {
  const publication = await getCachedPublication(publicationId)
  if (!publication || getPublicationKind(publication) !== expectedKind) notFound()
  const proof = await getCachedProof(publicationId)
  let embedManifest: LibroEmbedManifestV1 | null = null
  if (proof) {
    try {
      embedManifest = buildLibroEmbedManifest(publication, proof, publicationId)
    } catch {
      embedManifest = null
    }
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Publication
        publication={publication}
        proof={proof}
        proofLink={publicationProofPath(expectedKind, publicationId)}
        celebrate={signed === '1'}
        embedManifest={embedManifest}
      />
    </Suspense>
  )
}

export async function CanonicalProofPage({
  publicationId,
  expectedKind,
}: {
  publicationId: string
  expectedKind: PublicationKind
}) {
  const publication = await getPublication(publicationId)
  if (!publication || getPublicationKind(publication) !== expectedKind) notFound()
  const proof = await getProof(publicationId)
  return <Proof proof={proof} publication={publication} publicationId={publicationId} />
}
