/**
 * Field-level agent permissions (SPEC.md §52, §76).
 *
 * "An agent must not be able to bypass field permissions through raw CRUD" — so the
 * check lives in the command path, not in the transport that happened to carry the
 * request.
 */
import {
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  permitAll,
  silentWriter,
} from '@assemora/core'
import {
  boolean as booleanColumn,
  dataTransactions,
  model,
  string,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

// Importing the module is what defines the `.resources()` facet, and the facet is
// what registers the entries.* commands and queries (ADR-0009).
import './module.js'
import { text, toggle } from './fields.js'
import { clearResourceRegistry } from './registry.js'
import { resource } from './resource.js'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  notes: string().nullable(),
  featured: booleanColumn().default(false),
})

const Articles = resource(Article, {
  title: text().required(),
  // An agent may propose a title, and may not decide what is featured.
  featured: toggle().agentAccess({ write: false }),
  // An editorial note an agent has no business reading.
  notes: text().agentAccess({ read: false }),
})

let app: ReturnType<typeof createApplication>

const as = <T>(actor: { type: 'user' | 'agent'; id: string }, work: () => Promise<T>): Promise<T> =>
  app.run({ source: actor.type === 'agent' ? 'mcp' : 'studio', actor }, work)

const AGENT = { type: 'agent', id: 'content-agent' } as const
const PERSON = { type: 'user', id: '11111111-1111-4111-8111-111111111111' } as const

beforeEach(async () => {
  clearResourceRegistry()
  useAdapter(createMemoryAdapter())

  app = createApplication({
    modules: [
      module('blog')
        .models(Article)
        .resources(Articles as never),
    ],
    authorization: permitAll(),
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()
})

const create = (actor: typeof AGENT | typeof PERSON, data: Record<string, unknown>) =>
  as(actor, () => app.commands.execute('entries.create', { resource: 'articles', data }))

describe('what an agent may write (SPEC.md §52)', () => {
  it('refuses the whole command rather than dropping the field', async () => {
    await expect(create(AGENT, { title: 'Proposed', featured: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    // Nothing was written: the agent must not believe it created something.
    expect(await Article.count()).toBe(0)
  })

  it('names every field it refused, so one attempt is enough to learn the rules', async () => {
    const Locked = resource(
      Article,
      {
        title: text().agentAccess({ write: false }),
        featured: toggle().agentAccess({ write: false }),
      },
      { name: 'locked' },
    )

    clearResourceRegistry()
    useAdapter(createMemoryAdapter())

    app = createApplication({
      modules: [
        module('blog')
          .models(Article)
          .resources(Locked as never),
      ],
      authorization: permitAll(),
      transactions: dataTransactions(),
      logger: createLogger(silentWriter),
    })
    await app.boot()

    await expect(
      as(AGENT, () =>
        app.commands.execute('entries.create', {
          resource: 'locked',
          data: { title: 'x', featured: true },
        }),
      ),
    ).rejects.toThrowError(/"featured", "title"/)
  })

  it('lets the agent write what it may', async () => {
    await expect(create(AGENT, { title: 'Proposed' })).resolves.toMatchObject({
      entry: expect.objectContaining({ title: 'Proposed' }),
    })
  })

  it('does not narrow a person: these settings are about agents', async () => {
    await expect(create(PERSON, { title: 'Editorial', featured: true })).resolves.toBeDefined()
  })

  it('applies to updates as well as creates', async () => {
    const created = (await create(PERSON, { title: 'One' })) as { id: string }

    await expect(
      as(AGENT, () =>
        app.commands.execute('entries.update', {
          resource: 'articles',
          id: created.id,
          data: { featured: true },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('what an agent may read (SPEC.md §52)', () => {
  beforeEach(async () => {
    await create(PERSON, { title: 'One', notes: 'For editors only' })
  })

  it('drops a field the agent may not read', async () => {
    const listed = (await as(AGENT, () =>
      app.queries.execute('entries.list', { resource: 'articles' }),
    )) as { data: Record<string, unknown>[] }

    expect(listed.data[0]).toHaveProperty('title')
    expect(listed.data[0]).not.toHaveProperty('notes')
  })

  it('keeps it for a person', async () => {
    const listed = (await as(PERSON, () =>
      app.queries.execute('entries.list', { resource: 'articles' }),
    )) as { data: Record<string, unknown>[] }

    expect(listed.data[0]).toHaveProperty('notes', 'For editors only')
  })

  it('drops it on a single read too, not only on a list', async () => {
    const listed = (await as(PERSON, () =>
      app.queries.execute('entries.list', { resource: 'articles' }),
    )) as { data: { id: string }[] }

    const one = (await as(AGENT, () =>
      app.queries.execute('entries.get', { resource: 'articles', id: listed.data[0]?.id }),
    )) as Record<string, unknown>

    expect(one).not.toHaveProperty('notes')
  })
})
