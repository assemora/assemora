/**
 * Editing what the library records about a file (SPEC.md §14, §51, §63).
 *
 * The library had upload and delete and nothing between them, so `alt` held `null` for
 * the life of every file — and `alt` is what an image says to somebody who cannot see
 * it. The cases here are the ones a partial update gets wrong: a key nobody sent, a key
 * sent as `null`, and the question of who may send either.
 */
import {
  type Application,
  clearRestorers,
  collectRevisions,
  createApplication,
  createLogger,
  ForbiddenError,
  NotFoundError,
  permitAll,
  silentWriter,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { media } from './index.js'
import { Media } from './models.js'
import { clearStorage, type StorageDriver, useStorage } from './storage.js'

let app: Application
let revisions: ReturnType<typeof collectRevisions>

const ADA = '3f9c2a10-4d5b-4c8e-9a71-1f2e3d4c5b6a'

/** Enough of a driver to hold bytes in memory: the storage is not what is under test. */
const inMemoryStorage = (): StorageDriver => {
  const held = new Map<string, Uint8Array>()

  return {
    name: 'memory',
    put: async (path, data) => {
      held.set(path, data)

      return { path, size: data.byteLength }
    },
    get: async (path) => {
      const bytes = held.get(path)

      if (bytes === undefined) throw new Error(`nothing stored at ${path}`)

      return bytes
    },
    remove: async (path) => {
      held.delete(path)
    },
    url: (path) => `/media/${path}`,
  }
}

const build = async (authorization = permitAll()) => {
  revisions = collectRevisions()
  app = createApplication({
    modules: [media()],
    authorization,
    revisions,
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()
}

const run = <T>(work: () => Promise<T>): Promise<T> =>
  app.run({ source: 'studio', actor: { type: 'user', id: ADA } }, work)

const upload = async () =>
  (await run(() =>
    app.commands.execute('media.upload', {
      filename: 'engine.png',
      mimeType: 'image/png',
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      alt: 'The analytical engine',
      width: 1200,
      height: 800,
    }),
  )) as { id: string }

const update = (input: Record<string, unknown>) =>
  run(() => app.commands.execute('media.update', input))

beforeEach(async () => {
  clearRestorers()
  clearStorage()
  useAdapter(createMemoryAdapter())
  useStorage(inMemoryStorage())
  await build()
})

describe('media.update (SPEC.md §63)', () => {
  it('sets the alt text, which is the whole reason it exists', async () => {
    const { id } = await upload()

    await update({ id, alt: 'Ada Lovelace at a writing desk' })

    expect((await Media.findOrFail(id)).alt).toBe('Ada Lovelace at a writing desk')
  })

  /**
   * The distinction a partial update lives or dies by.
   *
   * A key nobody sent arrives as `undefined`, and writing that over the column would
   * erase a value the caller never mentioned. Sending one file's alt text must not
   * clear its dimensions.
   */
  it('leaves alone every field the caller did not name', async () => {
    const { id } = await upload()

    await update({ id, alt: 'A new description' })

    const item = await Media.findOrFail(id)

    expect(item.width).toBe(1200)
    expect(item.height).toBe(800)
    expect(item.filename).toBe('engine.png')
  })

  /**
   * `null` and `''` are different claims, so both have to be expressible.
   *
   * An empty `alt` tells a screen reader the image is decorative and may be skipped —
   * an assertion somebody makes on purpose. `null` says nobody has described it yet.
   */
  it('clears a field that is sent as null, and keeps an empty string as one', async () => {
    const { id } = await upload()

    await update({ id, alt: null })
    expect((await Media.findOrFail(id)).alt).toBeNull()

    await update({ id, alt: '' })
    expect((await Media.findOrFail(id)).alt).toBe('')
  })

  it('corrects the dimensions, which are facts and can be recorded wrongly', async () => {
    const { id } = await upload()

    await update({ id, width: 1600, height: 900 })

    const item = await Media.findOrFail(id)

    expect([item.width, item.height]).toEqual([1600, 900])
  })

  it('records a revision with both sides, like every other content mutation', async () => {
    const { id } = await upload()

    await update({ id, alt: 'Described at last' })

    const written = revisions.entries.filter((entry) => entry.entityType === 'media')
    const last = written.at(-1)

    expect(last).toBeDefined()
    expect(last?.entityId).toBe(id)
    expect((last?.before as { alt: unknown } | null)?.alt).toBe('The analytical engine')
    expect((last?.after as { alt: unknown } | null)?.alt).toBe('Described at last')
  })

  it('refuses an id that names nothing, rather than creating one', async () => {
    await expect(update({ id: '00000000-0000-4000-8000-000000000000', alt: 'x' })).rejects.toThrow(
      NotFoundError,
    )
  })

  /**
   * The second question, with the record in hand (ADR-0015).
   *
   * The bus asks whether this actor may update media at all before the handler runs;
   * this asks whether they may update *this file*. A policy that reads the record is
   * the only kind that can say "your own uploads and nobody else's".
   */
  it('passes the policy the record, not only the name of the command', async () => {
    const asked: { subject: string; action: string; record: unknown }[] = []

    await build({
      authorize: async () => undefined,
      authorizeRecord: async (request) => {
        asked.push(request)
      },
    })

    const { id } = await upload()

    await update({ id, alt: 'Described' })

    expect(asked).toContainEqual(expect.objectContaining({ subject: 'media', action: 'update' }))
    expect((asked.at(-1)?.record as { filename?: unknown } | undefined)?.filename).toBe(
      'engine.png',
    )
  })

  it('is refused by a rule that only the record could answer', async () => {
    await build({
      authorize: async () => undefined,
      authorizeRecord: async (request) => {
        // "Somebody else's upload", which is the shape a real policy takes and the
        // reason the record has to reach the second stage at all.
        if (request.action === 'update') throw new ForbiddenError('Not yours')
      },
    })

    const { id } = await upload()

    await expect(update({ id, alt: 'x' })).rejects.toThrow(ForbiddenError)
  })
})
