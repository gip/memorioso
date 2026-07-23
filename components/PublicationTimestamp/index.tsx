'use client'

import { useEffect, useState } from 'react'
import { fmtDate, type PublicationDateStyle } from '@/lib/time'

export const PublicationTimestamp = ({
  date,
  style = 'long',
  className,
}: {
  date: Date | string | number
  style?: PublicationDateStyle
  className?: string
}) => {
  const [formatted, setFormatted] = useState(() => fmtDate(date, { style, timeZone: 'UTC' }))
  const parsed = new Date(date)
  const dateTime = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()

  useEffect(() => {
    setFormatted(fmtDate(date, { style }))
  }, [date, style])

  if (!formatted || !dateTime) return null

  return (
    <time className={className} dateTime={dateTime}>
      {formatted}
    </time>
  )
}
