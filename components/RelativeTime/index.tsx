'use client'

// Relative timestamp for feed rows ("3 days ago").
//
// `timeAgo` reads the current time, which a prerendered or `use cache` scope
// cannot: the answer would be baked into the cache entry and drift. So the
// server renders a stable absolute date and this swaps to the relative form
// after mount, the same trick PublicationTimestamp uses for timezones.

import { useEffect, useState } from 'react'
import { fmtShortDate, timeAgo } from '@/lib/time'

export const RelativeTime = ({ date, className }: {
  date: Date | string | number
  className?: string
}) => {
  const [label, setLabel] = useState(() => fmtShortDate(date))
  const parsed = new Date(date)
  const dateTime = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()

  useEffect(() => {
    setLabel(timeAgo(date))
  }, [date])

  if (!label || !dateTime) return null

  return (
    <time className={className} dateTime={dateTime}>
      {label}
    </time>
  )
}
