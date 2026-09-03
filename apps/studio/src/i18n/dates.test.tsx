/**
 * Which clock a value is read on (SPEC.md §115).
 *
 * There are two kinds of value here and they are not interchangeable. An instant —
 * `createdAt`, `updatedAt`, a `datetime` field — is a moment, and every reader is
 * entitled to see it on their own clock. A calendar day is not a moment: a birthday, a
 * publication date, anything a `date` field holds. It is stored as midnight UTC, so a
 * reader in the Americas formatting it locally is shown the evening before, and the day
 * moves.
 *
 * Both formatters are one line long and look alike, which is exactly why this file
 * exists: the shorter, wrong version is to have only one of them.
 */
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { useDates } from './translate.tsx'

/** Runs a piece of work as somebody in another part of the world would see it. */
const inZone = <T,>(zone: string, work: () => T): T => {
  const before = process.env.TZ
  process.env.TZ = zone

  try {
    return work()
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

/** The hook is the thing under test, so it is read from inside a render. */
const read = (draw: (dates: ReturnType<typeof useDates>) => string): string => {
  const Probe = (): ReactElement => <span>{draw(useDates())}</span>

  return renderToStaticMarkup(<Probe />).replace(/<[^>]*>/g, '')
}

const NEW_YORK = 'America/New_York'
const KYIV = 'Europe/Kyiv'

describe('a calendar day', () => {
  /** Midnight UTC read at −04:00 is the previous evening. */
  it('is the same day everywhere, because it is not a moment', () => {
    const stored = '2026-09-03T00:00:00.000Z'

    expect(inZone(NEW_YORK, () => read((dates) => dates.day(stored)))).toBe('9/3/2026')
    expect(inZone(KYIV, () => read((dates) => dates.day(stored)))).toBe('9/3/2026')
  })

  it('is what the entry form shows for the same field', () => {
    // The form and the listing it was opened from have to agree, and they did not: the
    // form formatted a date in UTC and the listing formatted it locally, so west of UTC
    // a row read one day and the record behind it read another.
    expect(inZone(NEW_YORK, () => read((dates) => dates.day('2026-01-01T00:00:00.000Z')))).toBe(
      '1/1/2026',
    )
  })
})

describe('an instant', () => {
  it('is read on the clock of whoever is reading it', () => {
    const stored = '2026-09-03T15:00:00.000Z'

    expect(inZone(KYIV, () => read((dates) => dates.date(stored)))).toBe('9/3/2026')
    // 15:00Z is 11:00 in New York and 18:00 in Kyiv — the same day in both, and the
    // hour is what differs. English writes both on a twelve-hour clock.
    expect(inZone(NEW_YORK, () => read((dates) => dates.dateTime(stored)))).toContain('11:00:00 AM')
    expect(inZone(KYIV, () => read((dates) => dates.dateTime(stored)))).toContain('6:00:00 PM')
  })

  it('crosses the date line where the offset says it does', () => {
    // 01:00Z is the previous evening in New York, and an instant is allowed to move.
    expect(inZone(NEW_YORK, () => read((dates) => dates.date('2026-09-03T01:00:00.000Z')))).toBe(
      '9/2/2026',
    )
  })
})
