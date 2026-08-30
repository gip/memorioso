import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { extractReadableText, type LibroEmbedManifestV1 } from '@libro/core'
import { Publication } from '@/components/Publication'
import { Proof } from '@/components/Proof'
import {
  getCachedProof,
  getCachedPublication,
  getCachedPublicationAccess,
} from '@/lib/db/publication-cache'
import { resolvePublicationAccess } from '@/lib/access/publication-access'
import { buildGatedTeaser } from '@/lib/access/teaser'
import { GatedBody } from '@/components/Publication/GatedBody'
import { PublicationBodySkeleton } from '@/components/Publication/BodySkeleton'
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
  const access = await getCachedPublicationAccess(publicationId)
  // Search and social previews must never show more than the page itself does.
  const excerpt = access?.access === 'gated'
    ? buildGatedTeaser(publication.publication_content.html)
    : extractReadableText(publication.publication_content.html)
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
  const access = await getCachedPublicationAccess(publicationId)
  const isGated = access?.access === 'gated'

  // Memorioso applies its presentation policy to redistributed artifacts too. Libro remains
  // canonical and public, so this is access convenience rather than content confidentiality.
  let embedManifest: LibroEmbedManifestV1 | null = null
  if (proof && !isGated) {
    try {
      embedManifest = buildLibroEmbedManifest(publication, proof, publicationId)
    } catch {
      embedManifest = null
    }
  }

  // Everything above is cacheable; only the body depends on who is asking.
  const bodySlot = isGated ? (
    <Suspense fallback={<PublicationBodySkeleton />}>
      <GatedBody
        publicationId={publicationId}
        kind={expectedKind}
        html={publication.publication_content.html}
      />
    </Suspense>
  ) : undefined

  return (
    <Publication
      publication={publication}
      proof={proof}
      proofLink={publicationProofPath(expectedKind, publicationId)}
      embedManifest={embedManifest}
      bodySlot={bodySlot}
    />
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
  const access = await getCachedPublicationAccess(publicationId)

  // Memorioso hides the local canonical signal until access is granted. The standalone Libro
  // API remains public and may expose the same signed body; public proofs stay prerenderable.
  const showSignal = access?.access !== 'gated'
    || (await resolvePublicationAccess(publicationId)).allowed

  return (
    <Proof
      proof={proof}
      publication={publication}
      publicationId={publicationId}
      showSignal={showSignal}
    />
  )
}
