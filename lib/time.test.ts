import { describe, expect, it } from 'vitest'
import { fmtDate } from './time'

describe('publication timestamp formatting', () => {
  it('includes local hours and minutes in long and short styles', () => {
    const date = '2026-07-21T12:34:00.000Z'

    expect(fmtDate(date, { timeZone: 'America/Los_Angeles' })).toBe('July 21, 2026 at 5:34 AM')
    expect(fmtDate(date, { style: 'short', timeZone: 'America/Los_Angeles' }))
      .toBe('Jul 21, 2026, 5:34 AM')
  })

  it('returns an empty string for invalid dates', () => {
    expect(fmtDate('not-a-date')).toBe('')
  })
})
