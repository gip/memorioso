import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { extractReadableText, type LibroEmbedManifestV1 } from '@libro/core'
import { Publication } from '@/components/Publication'
import { Proof } from '@/components/Proof'
import { getCachedProof, getCachedPublication } from '@/lib/db/publication-cache'
import { buildLibroEmbedManifest } from '@/lib/libro/embed'
import {
  getPublicationKind,
  publicationPath,
  publicationProofPath,
  type PublicationKind,
} from '@/lib/publication-kind'

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
}: {
  publicationId: string
  expectedKind: PublicationKind
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
  const publication = await getCachedPublication(publicationId)
  if (!publication || getPublicationKind(publication) !== expectedKind) notFound()
  const proof = await getCachedProof(publicationId)
  return <Proof proof={proof} publication={publication} publicationId={publicationId} />
}
