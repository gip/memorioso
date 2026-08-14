'use client'

import { useSearchParams } from 'next/navigation'

export function FreshPublicationNotice({ className }: { className: string }) {
  const searchParams = useSearchParams()
  if (searchParams.get('signed') !== '1') return null

  return <p className={className}>Signed and published just now</p>
}
