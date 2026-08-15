import Link from 'next/link'
import { PublicationRecord as PublicationType, Proof as ProofType } from '@/lib/db/objects'
import {
  isLibroAgentProof,
  isLegacyPublication,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'
import { MemMark } from '@/components/MemMark'
import { HumanSeal } from '@/components/HumanSeal'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'
import { RightPanePortal } from '@/components/SiteChrome/RightPanePortal'
import {
  extractReadableText,
  isSimpleTextPublication,
  manifestElementId,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
} from '@libro/core'
import {
  buildLibroEmbedSnippet,
  buildLibroTextSnippet,
  sanitizeLibroEmbedHtml,
  sanitizeShortPublicationHtml,
} from '@/lib/libro/embed'
import { CopyEmbedButton } from './CopyEmbedButton'
import { ShareButtons } from './ShareButtons'
import { FreshPublicationNotice } from './FreshPublicationNotice'
import { getPublicationKind } from '@/lib/publication-kind'
import { Suspense } from 'react'

const AuthorshipMark = ({
  isAgentAuthored,
  size,
  sealId,
}: {
  isAgentAuthored: boolean
  size: number
  sealId: string
}) => isAgentAuthored ? (
  <div
    aria-label="Human-authorized agent publication"
    className="flex shrink-0 items-center justify-center rounded-full border border-blurple/20 bg-[radial-gradient(circle_at_center,rgba(82,0,255,0.08),transparent_68%)]"
    role="img"
    style={{ width: size, height: size }}
  >
    <MemMark size={size * 0.46} />
  </div>
) : (
  <HumanSeal id={sealId} size={size} />
)

const PublicationByline = ({
  authorHref,
  authorHandle,
  publicationDate,
  className = '',
}: {
  authorHref: string
  authorHandle: string
  publicationDate: Date | string | number
  className?: string
}) => (
  <p className={`overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] leading-relaxed text-muted-foreground ${className}`}>
    <span>By </span>
    <Link href={authorHref} className="font-medium text-blurple hover:underline">
      @{authorHandle}
    </Link>
    <span> on </span>
    <PublicationTimestamp date={publicationDate} style="short" />
  </p>
)

const PublicationVerification = ({
  isAgentAuthored,
  verifyHref,
  embedSnippet,
  textSnippet,
  shareTextSnippet,
  compact = false,
}: {
  isAgentAuthored: boolean
  verifyHref?: string
  embedSnippet: string | null
  textSnippet: string | null
  shareTextSnippet: string | null
  compact?: boolean
}) => compact ? (
  <section
    aria-label="Publication verification"
    className="mb-7 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 sm:p-4 xl:hidden"
  >
    <div className="flex items-center gap-3.5">
      <AuthorshipMark isAgentAuthored={isAgentAuthored} sealId="publication-seal-mobile" size={72} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            {isAgentAuthored ? 'Human-authorized agent' : 'Signed by a human'}
          </p>
          <ShareButtons textSnippet={shareTextSnippet} />
        </div>
        <Suspense fallback={null}>
          <FreshPublicationNotice className="mt-0.5 text-xs text-muted-foreground" />
        </Suspense>
        {verifyHref && (
          <Link
            href={verifyHref}
            className="mt-1.5 inline-block text-xs font-medium text-blurple hover:underline"
          >
            View verification
          </Link>
        )}
      </div>
    </div>
    {embedSnippet && textSnippet && (
      <div className="mt-3 hidden border-t border-zinc-200/80 pt-2 sm:block">
        <CopyEmbedButton snippet={embedSnippet} textSnippet={textSnippet} />
      </div>
    )}
  </section>
) : (
  <aside
    aria-label="Publication verification"
    className="flex w-full max-w-[14rem] flex-col items-center py-8 text-center"
  >
    <AuthorshipMark isAgentAuthored={isAgentAuthored} sealId="publication-seal-desktop" size={112} />
    <p className="mt-4 text-sm font-semibold text-foreground">
      {isAgentAuthored ? 'Human-authorized agent' : 'Signed by a human'}
    </p>
    <ShareButtons textSnippet={shareTextSnippet} className="mt-1.5" />
    <Suspense fallback={null}>
      <FreshPublicationNotice className="mt-1 text-xs leading-relaxed text-muted-foreground" />
    </Suspense>
    {verifyHref && (
      <Link
        href={verifyHref}
        className="mt-2 text-xs font-medium leading-relaxed text-muted-foreground underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
      >
        View independent verification
      </Link>
    )}
    {embedSnippet && textSnippet && (
      <div className="mt-6 w-full border-t border-zinc-200 pt-4 text-left">
        <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Cite this publication
        </p>
        <CopyEmbedButton snippet={embedSnippet} textSnippet={textSnippet} vertical />
      </div>
    )}
  </aside>
)

export const Publication = ({
  publication,
  proof,
  proofLink,
  embedManifest,
}: {
  publication: PublicationType
  proof?: ProofType | null
  proofLink?: string
  embedManifest?: LibroEmbedManifestV1 | null
}) => {
  const content = publication.publication_content.html
  const title = publication.publication_title.trim()
  const titleOrExcerpt = title || extractReadableText(content)
  const isLegacy = isLegacyPublication(publication)
  const verifyHref = !isLegacy ? proofLink : undefined
  const isAgentAuthored = isLibroAgentProof(proof)
  const authorHref = `/@${publication.author_handle_libro}`
  const publicationKind = getPublicationKind(publication)
  const manifestId = embedManifest ? manifestElementId(embedManifest.registration.signal_hash) : null
  const embedSnippet = embedManifest ? buildLibroEmbedSnippet(embedManifest) : null
  const textSnippet = embedManifest ? buildLibroTextSnippet(embedManifest) : null
  const shareTextSnippet = embedManifest && isSimpleTextPublication(embedManifest.publication) ? textSnippet : null
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

  if (publicationKind === 'short') {
    return (
      <>
        <RightPanePortal>
          <PublicationVerification
            isAgentAuthored={isAgentAuthored}
            verifyHref={verifyHref}
            embedSnippet={embedSnippet}
            textSnippet={textSnippet}
            shareTextSnippet={shareTextSnippet}
          />
        </RightPanePortal>

        <article className="pb-16 pt-5 sm:pb-20 sm:pt-10 xl:pt-16">
          <PublicationVerification
            isAgentAuthored={isAgentAuthored}
            verifyHref={verifyHref}
            embedSnippet={embedSnippet}
            textSnippet={textSnippet}
            shareTextSnippet={shareTextSnippet}
            compact
          />
          <div
            className="space-y-4 text-[clamp(21px,4vw,28px)] leading-[1.55] tracking-[-0.01em] text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeShortPublicationHtml(content) }}
          />
          <div className="mt-8 border-t border-zinc-100 pt-5">
            <PublicationByline
              authorHref={authorHref}
              authorHandle={publication.author_handle_libro}
              publicationDate={publication.publication_date}
            />
          </div>
          {isLegacy && (
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE}
            </div>
          )}
          {embedManifest && manifestId && (
            <script
              id={manifestId}
              type="application/libro+json"
              dangerouslySetInnerHTML={{ __html: serializeManifestForHtml(embedManifest) }}
            />
          )}
          <div className="mt-10 flex justify-center"><MemMark size={26} /></div>
        </article>
      </>
    )
  }

  return (
    <>
      <RightPanePortal>
        <PublicationVerification
          isAgentAuthored={isAgentAuthored}
          verifyHref={verifyHref}
          embedSnippet={embedSnippet}
          textSnippet={textSnippet}
          shareTextSnippet={shareTextSnippet}
        />
      </RightPanePortal>

      <article className="pb-16 pt-5 sm:pb-20 sm:pt-8 xl:pt-12">
        <PublicationVerification
          isAgentAuthored={isAgentAuthored}
          verifyHref={verifyHref}
          embedSnippet={embedSnippet}
          textSnippet={textSnippet}
          shareTextSnippet={shareTextSnippet}
          compact
        />

        <header className="text-center">
          <h1 className={title
            ? 'spectral mx-auto line-clamp-2 text-balance text-[clamp(30px,6vw,46px)] font-semibold leading-[1.08] tracking-tight text-foreground'
            : 'mx-auto line-clamp-2 text-[17px] font-normal leading-relaxed text-foreground'
          }>
            {titleOrExcerpt}
          </h1>
          {publication.publication_subtitle && (
            <p className="spectral mx-auto mt-3 text-pretty text-[19px] leading-snug text-muted-foreground sm:text-[21px]">
              {publication.publication_subtitle}
            </p>
          )}

          <PublicationByline
            authorHref={authorHref}
            authorHandle={publication.author_handle_libro}
            publicationDate={publication.publication_date}
            className="mt-6 text-center"
          />
        </header>

        {isLegacy && (
          <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE}
          </div>
        )}

        <div className="my-7 h-px bg-zinc-100 sm:my-9" />

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
    </>
  )
}
