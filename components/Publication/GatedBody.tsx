import { resolvePublicationAccess } from '@/lib/access/publication-access'
import { buildGatedTeaser } from '@/lib/access/teaser'
import { publicationContentPath } from '@/lib/publication-kind'
import type { PublicationKind } from '@/types'
import { ArticleProse, ShortProse } from './prose'
import { UnlockDialog } from './UnlockDialog'

/**
 * Dynamic: reads cookies and headers to decide what this viewer may see, so it must
 * stay inside a Suspense boundary and out of any `'use cache'` scope.
 */
export const GatedBody = async ({
  publicationId,
  kind,
  html,
}: {
  publicationId: string
  kind: PublicationKind
  html: string
}) => {
  const decision = await resolvePublicationAccess(publicationId)

  if (decision.allowed) {
    return kind === 'short' ? <ShortProse html={html} /> : <ArticleProse html={html} />
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

  return (
    <div>
      <div className="relative">
        <p className="publication-prose spectral text-[19px] leading-[1.72] text-zinc-900">
          {buildGatedTeaser(html)}
        </p>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white"
        />
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/60 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">
          The rest of this publication is gated
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Sign in with World ID to read it, or pay ${decision.priceUsd} over x402 if you
          are fetching it programmatically.
        </p>
        <UnlockDialog
          contentEndpoint={`${appUrl}${publicationContentPath(publicationId)}`}
          priceUsd={decision.priceUsd}
        />
      </div>
    </div>
  )
}
