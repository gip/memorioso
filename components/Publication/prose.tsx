import { sanitizeShortPublicationHtml } from '@/lib/libro/embed'

export const ARTICLE_PROSE_CLASS = 'publication-prose spectral text-[19px] leading-[1.72] text-zinc-900'
export const SHORT_PROSE_CLASS = 'space-y-4 text-[clamp(21px,4vw,28px)] leading-[1.55] tracking-[-0.01em] text-foreground'

export const ArticleProse = ({ html }: { html: string }) => (
  <div className={ARTICLE_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
)

export const ShortProse = ({ html }: { html: string }) => (
  <div className={SHORT_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: sanitizeShortPublicationHtml(html) }} />
)
