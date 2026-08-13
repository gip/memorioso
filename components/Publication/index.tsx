import Link from 'next/link'
import { PublicationRecord as PublicationType, Proof as ProofType } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import {
  getCredentialIdentifierForPublication,
  isLibroAgentProof,
  isLegacyPublication,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'
import { MemMark } from '@/components/MemMark'
import { HumanSeal } from '@/components/HumanSeal'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'
import {
  extractReadableText,
  manifestElementId,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
} from '@libro/core'
import {
  buildLibroEmbedSnippet,
  buildLibroTextSnippet,
  sanitizeLibroEmbedHtml,
} from '@/lib/libro/embed'
import { CopyEmbedButton } from './CopyEmbedButton'

export const Publication = ({
  publication,
  proof,
  proofLink,
  celebrate = false,
  embedManifest,
}: {
  publication: PublicationType
  proof?: ProofType | null
  proofLink?: string
  celebrate?: boolean
  embedManifest?: LibroEmbedManifestV1 | null
}) => {
  const content = publication.publication_content.html
  const title = publication.publication_title.trim()
  const titleOrExcerpt = title || extractReadableText(content)
  const isLegacy = isLegacyPublication(publication)
  const credentialIdentifier = getCredentialIdentifierForPublication(publication, proof)
  const credentialLabel = credentialIdentifier
    ? WORLD_ID_CREDENTIAL_LABELS[credentialIdentifier as WorldIdCredentialIdentifier] || credentialIdentifier
    : null
  const verifyHref = !isLegacy ? proofLink : undefined
  const isAgentAuthored = isLibroAgentProof(proof)
  const authorHref = `/a/${publication.author_handle_libro || publication.author_id_libro}`
  const manifestId = embedManifest ? manifestElementId(embedManifest.registration.signal_hash) : null
  const embedSnippet = embedManifest ? buildLibroEmbedSnippet(embedManifest) : null
  const textSnippet = embedManifest ? buildLibroTextSnippet(embedManifest) : null
  const presentationContent = embedManifest ? sanitizeLibroEmbedHtml(content) : content

  const publicationBody = embedManifest && manifestId ? (
    <div
      className="libro-human-signed publication-prose spectral text-[19px] leading-[1.72] text-zinc-900"
      data-libro-claim="human-signed"
      data-libro-manifest={manifestId}
      data-libro-signal-hash={embedManifest.registration.signal_hash}
      dangerouslySetInnerHTML={{ __html: presentationContent }}
    />
  ) : (
    <div
      className="publication-prose spectral text-[19px] leading-[1.72] text-zinc-900"
      dangerouslySetInnerHTML={{ __html: presentationContent }}
    />
  )

  return (
    <article className="pb-20 pt-8 sm:pt-12">
      <header className="text-center">
        <div className="flex flex-col items-center">
          {isAgentAuthored ? (
            <div
              aria-label="Human-authorized agent publication"
              className="flex h-28 w-28 items-center justify-center rounded-full border border-blurple/20 bg-[radial-gradient(circle_at_center,rgba(82,0,255,0.08),transparent_68%)]"
              role="img"
            >
              <MemMark size={52} />
            </div>
          ) : (
            <HumanSeal size={116} />
          )}
          {isAgentAuthored && (
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-blurple">
              Human-authorized agent
            </p>
          )}
          {celebrate && (
            <p className="mt-1 text-xs text-muted-foreground">Signed and published just now</p>
          )}
          {verifyHref && (
            <Link
              href={verifyHref}
              className="mt-2 text-xs font-medium text-muted-foreground underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
            >
              View independent verification
            </Link>
          )}
        </div>

        <div className="mx-auto mt-8 h-px w-12 bg-zinc-200" />

        <h1 className={title
          ? 'spectral mx-auto mt-8 line-clamp-2 text-balance text-[clamp(32px,6vw,46px)] font-semibold leading-[1.08] tracking-tight text-foreground'
          : 'mx-auto mt-8 line-clamp-2 text-[17px] font-normal leading-relaxed text-foreground'
        }>
          {titleOrExcerpt}
        </h1>
        {publication.publication_subtitle && (
          <p className="spectral mx-auto mt-3 text-pretty text-[19px] leading-snug text-muted-foreground sm:text-[21px]">
            {publication.publication_subtitle}
          </p>
        )}

        <div className="mt-6 text-[13.5px] leading-relaxed text-muted-foreground">
          <span className="italic">By </span>
          <Link href={authorHref} className="font-medium text-blurple hover:underline">
            @{publication.author_handle_libro}
          </Link>
          <span className="ml-1">/ {publication.author_name_libro}</span>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12.5px]">
            <span><PublicationTimestamp date={publication.publication_date} /></span>
            {credentialLabel && (
              <>
                <span aria-hidden className="text-zinc-300">·</span>
                <span>{credentialLabel}</span>
              </>
            )}
          </div>
        </div>

        {embedSnippet && textSnippet && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-1">
            <CopyEmbedButton snippet={embedSnippet} textSnippet={textSnippet} />
          </div>
        )}
      </header>

      {isLegacy && (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE}
        </div>
      )}

      <div className="my-9 h-px bg-zinc-100" />

      <div>
        {publicationBody}
      </div>

      {embedManifest && manifestId && (
        <script
          id={manifestId}
          type="application/libro+json"
          dangerouslySetInnerHTML={{ __html: serializeManifestForHtml(embedManifest) }}
        />
      )}

      <div className="mt-10 flex justify-center">
        <MemMark size={26} />
      </div>
    </article>
  )
}
