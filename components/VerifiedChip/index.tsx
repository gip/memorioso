// The subtle "Signed by a human" marker — used inline in bylines and feed cards.

import Link from 'next/link'
import { MemMark } from '@/components/MemMark'

type VerifiedChipProps = {
  verifyHref?: string
  label?: string
}

export const VerifiedChip = ({ verifyHref, label = 'Signed by a human' }: VerifiedChipProps) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blurple">
    <MemMark size={15} />
    {label}
    {verifyHref && (
      <>
        <span className="text-muted-foreground">·</span>
        <Link href={verifyHref} className="underline hover:no-underline">
          verify
        </Link>
      </>
    )}
  </span>
)
