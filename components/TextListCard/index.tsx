// Shared list card for feeds (publications and drafts). Same component on every
// surface: serif title, optional subtitle, and a meta row that is either the
// "Signed by a human" chip (signed) or an "Unsigned draft" marker.

import Link from 'next/link'
import { MemMark } from '@/components/MemMark'
import { VerifiedChip } from '@/components/VerifiedChip'

type TextListCardProps = {
  title: string
  subtitle?: string
  signed?: boolean
  authorshipLabel?: string
  /** Trailing meta for signed items, e.g. "@caleb · 3 days ago" or "Caleb North · 2h ago". */
  metaText?: string
  href?: string
  onClick?: () => void
}

const CardBody = ({ title, subtitle, signed = true, metaText, authorshipLabel }: TextListCardProps) => (
  <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1">
      <div className="spectral truncate text-[17px] font-semibold leading-tight text-foreground">
        {title || 'Untitled'}
      </div>
      {subtitle && (
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {signed ? (
          <>
            <VerifiedChip label={authorshipLabel} />
            {metaText && (
              <>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-xs text-zinc-400">{metaText}</span>
              </>
            )}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            Unsigned draft
          </span>
        )}
      </div>
    </div>
    {signed && <MemMark size={20} className="shrink-0 text-blurple opacity-90" />}
  </div>
)

export const TextListCard = (props: TextListCardProps) => {
  const className =
    'block rounded-xl border bg-card px-4 py-3.5 shadow-sm transition hover:border-zinc-300 hover:shadow-md cursor-pointer'

  if (props.href) {
    return (
      <Link href={props.href} className={className}>
        <CardBody {...props} />
      </Link>
    )
  }

  return (
    <div className={className} onClick={props.onClick}>
      <CardBody {...props} />
    </div>
  )
}
