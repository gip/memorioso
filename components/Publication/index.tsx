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
import { VerifiedChip } from '@/components/VerifiedChip'
import { Divider } from '@/components/Divider'
import { fmtDate } from '@/lib/time'
import {
  isSimpleTextPublication,
  manifestElementId,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
} from '@libro/core'
import {
  buildLibroEmbedSnippet,
  getLibroSimpleBoundaryLabel,
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
  const isLegacy = isLegacyPublication(publication)
  const credentialIdentifier = getCredentialIdentifierForPublication(publication, proof)
  const credentialLabel = credentialIdentifier
    ? WORLD_ID_CREDENTIAL_LABELS[credentialIdentifier as WorldIdCredentialIdentifier] || credentialIdentifier
    : null
  const verifyHref = !isLegacy ? proofLink : undefined
  const isAgentAuthored = isLibroAgentProof(proof)
  const authorshipLabel = isAgentAuthored ? 'Human-authorized agent' : 'Signed by a human'
  const manifestId = embedManifest ? manifestElementId(embedManifest.registration.signal_hash) : null
  const embedSnippet = embedManifest ? buildLibroEmbedSnippet(embedManifest) : null
  const isSimpleEmbed = embedManifest ? isSimpleTextPublication(embedManifest.publication) : false
  const presentationContent = embedManifest ? sanitizeLibroEmbedHtml(content) : content

  const publicationBody = embedManifest && manifestId ? (
    <div
      className="libro-human-authored publication-prose spectral text-[19px] leading-[1.72] text-zinc-900"
      data-libro-claim="human-authored"
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
    <article className="mx-auto max-w-2xl px-5 pb-16 pt-2">
      {isLegacy && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE}
        </div>
      )}

      {celebrate && (
        <div className="flex flex-col items-center gap-3 pb-6 pt-3 text-center">
          <HumanSeal size={104} />
          <div className="text-[13px] font-semibold tracking-wide text-blurple">
            SIGNED &amp; PUBLISHED
          </div>
          <Divider />
        </div>
      )}

      {publication.publication_title && (
        <h1 className="spectral mt-2 text-balance text-[clamp(30px,6vw,40px)] font-semibold leading-[1.12] tracking-tight text-foreground">
          {publication.publication_title}
        </h1>
      )}
      {publication.publication_subtitle && (
        <p className="spectral mt-3 text-[19px] leading-snug text-muted-foreground">
          {publication.publication_subtitle}
        </p>
      )}

      <div className="mt-5 text-[13.5px] leading-relaxed text-muted-foreground">
        <span className="italic">By </span>
        <span className="font-medium text-blurple">@{publication.author_handle_libro}</span>
        <span className="ml-0.5">/ {publication.author_name_libro}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <VerifiedChip verifyHref={verifyHref} label={authorshipLabel} />
          {embedSnippet && <CopyEmbedButton snippet={embedSnippet} />}
          <span className="text-zinc-400">·</span>
          <span>Signed {fmtDate(publication.publication_date)}</span>
          {credentialLabel && (
            <>
              <span className="text-zinc-400">·</span>
              <span>{credentialLabel}</span>
            </>
          )}
        </div>
      </div>

      <div className="my-6 h-px bg-zinc-100" />

      {isSimpleEmbed && embedManifest ? (
        <div className="libro-simple rounded-md border border-zinc-200 bg-zinc-50/60 px-4 py-3">
          <div className="libro-boundary mb-3 break-words font-mono text-xs text-zinc-500">
            {getLibroSimpleBoundaryLabel(embedManifest)}
          </div>
          {publicationBody}
          <div className="libro-boundary mt-3 font-mono text-xs text-zinc-500">=== End Libro ===</div>
        </div>
      ) : publicationBody}

      {embedManifest && manifestId && (
        <script
          id={manifestId}
          type="application/libro+json"
          dangerouslySetInnerHTML={{ __html: serializeManifestForHtml(embedManifest) }}
        />
      )}

      <div className="mt-8 flex justify-center">
        <MemMark size={26} />
      </div>
    </article>
  )
}
