import { AssemoraError, type QueuedJob } from '@assemora/core'
import { timestamp } from '@assemora/schema'
import { describe, expect, it } from 'vitest'

import { decodeJob, encodeJob } from './envelope.js'

const queued = (payload: unknown): QueuedJob => ({
  name: 'sitemap.generate',
  payload,
  retries: 3,
  requestId: 'f0a1b2c3-0000-4000-8000-000000000001',
  actor: { type: 'user', id: 'ada' },
  dispatchedFrom: 'studio',
})

const faultOf = (payload: unknown): string => {
  try {
    encodeJob(queued(payload))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  return 'accepted'
}

/** What Redis gives back: the envelope, through a serializer and nothing else. */
const roundTrip = (job: QueuedJob): QueuedJob =>
  decodeJob(JSON.parse(JSON.stringify(encodeJob(job))) as unknown)

describe('encodeJob', () => {
  it('carries everything JSON carries, unchanged', () => {
    const payload = {
      title: 'Home',
      views: 12,
      published: true,
      parent: null,
      tags: ['a', 'b'],
      seo: { description: 'x', keywords: [] },
    }

    expect(roundTrip(queued(payload)).payload).toEqual(payload)
  })

  it('accepts the same object twice, which is not a cycle', () => {
    const shared = { id: '1' }

    expect(() => encodeJob(queued({ left: shared, right: shared }))).not.toThrow()
  })

  it('sends a Date as the string the schema layer already calls a timestamp', () => {
    const at = new Date('2026-08-27T09:00:00.000Z')

    expect(encodeJob(queued({ publishedAt: at })).payload).toEqual({
      publishedAt: '2026-08-27T09:00:00.000Z',
    })
  })

  it('gives the handler back the Date it declared, because timestamp() reads it', () => {
    const at = new Date('2026-08-27T09:00:00.000Z')
    const returned = roundTrip(queued({ publishedAt: at })).payload as { publishedAt: string }
    const parsed = timestamp().parse(returned.publishedAt)

    expect(parsed.ok && parsed.value).toEqual(at)
  })

  it('converts a Date wherever it is, not only at the top', () => {
    const encoded = encodeJob(queued({ runs: [{ at: new Date(0) }] })).payload

    expect(encoded).toEqual({ runs: [{ at: '1970-01-01T00:00:00.000Z' }] })
  })

  it('refuses a Date that is not a date', () => {
    expect(faultOf({ at: new Date('nonsense') })).toContain('an invalid Date at payload.at')
  })

  it('names the path inside an array', () => {
    expect(faultOf({ pages: [{ id: '1' }, { id: '2', seen: new Set() }] })).toContain(
      'payload.pages[1].seen',
    )
  })

  it('refuses the values JSON turns into null', () => {
    expect(faultOf({ ratio: Number.NaN })).toContain('NaN at payload.ratio')
    expect(faultOf({ ratio: Number.POSITIVE_INFINITY })).toContain('Infinity at payload.ratio')
  })

  it('refuses what JSON drops rather than converts', () => {
    expect(faultOf({ missing: undefined })).toContain('undefined at payload.missing')
    expect(faultOf({ count: 1n })).toContain('a bigint at payload.count')
    expect(faultOf({ run: () => undefined })).toContain('a function at payload.run')
  })

  it('refuses a collection that arrives as an empty object', () => {
    expect(faultOf({ seen: new Map() })).toContain('a Map at payload.seen')
    expect(faultOf({ seen: new Set() })).toContain('a Set at payload.seen')
  })

  it('refuses an instance, because its prototype does not travel', () => {
    class Page {
      readonly id = '1'
      slug(): string {
        return 'home'
      }
    }

    expect(faultOf({ page: new Page() })).toContain('a Page at payload.page')
  })

  it('refuses a cycle instead of overflowing the stack', () => {
    const cycle: Record<string, unknown> = { id: '1' }
    cycle.self = cycle

    expect(faultOf(cycle)).toContain('a circular reference at payload.self')
  })

  it('refuses with a code and a status a caller can act on', () => {
    try {
      encodeJob(queued({ seen: new Map() }))
      expect.unreachable('a Map should not be queueable')
    } catch (error) {
      expect(error).toBeInstanceOf(AssemoraError)
      expect((error as AssemoraError).code).toBe('UNQUEUEABLE_PAYLOAD')
      expect((error as AssemoraError).status).toBe(422)
      expect((error as AssemoraError).details).toEqual({ job: 'sitemap.generate' })
    }
  })

  it('accepts a payload built with a null prototype, which is a plain bag of keys', () => {
    const bag = Object.assign(Object.create(null) as Record<string, unknown>, { id: '1' })

    expect(encodeJob(queued(bag)).payload).toEqual({ id: '1' })
  })

  it('leaves the rest of the envelope alone', () => {
    const original = queued({ pageId: '7' })

    expect(roundTrip(original)).toEqual(original)
  })
})

describe('decodeJob', () => {
  it('keeps a job with no actor without inventing one', () => {
    const anonymous: QueuedJob = {
      name: 'sitemap.generate',
      payload: {},
      retries: 0,
      requestId: 'r-1',
      dispatchedFrom: 'cli',
    }

    expect(roundTrip(anonymous)).toEqual(anonymous)
    expect('actor' in roundTrip(anonymous)).toBe(false)
  })

  it('drops anything the envelope does not declare', () => {
    const decoded = decodeJob({ ...queued({}), escalate: true }) as Record<string, unknown>

    expect('escalate' in decoded).toBe(false)
  })

  it('refuses a source no context can have', () => {
    expect(() => decodeJob({ ...queued({}), dispatchedFrom: 'root' })).toThrow(AssemoraError)
  })

  it('refuses an envelope with fields missing, and names them', () => {
    try {
      decodeJob({ name: 'sitemap.generate' })
      expect.unreachable('an envelope without a request id is not a job')
    } catch (error) {
      expect(error).toBeInstanceOf(AssemoraError)
      expect((error as AssemoraError).code).toBe('MALFORMED_JOB')
      expect((error as AssemoraError).details).toEqual({
        fields: expect.arrayContaining(['retries', 'requestId', 'dispatchedFrom']),
      })
    }
  })

  it('refuses something that is not an object at all', () => {
    expect(() => decodeJob('sitemap.generate')).toThrow(AssemoraError)
    expect(() => decodeJob(null)).toThrow(AssemoraError)
  })
})
