import {
  collectAudit,
  collectRevisions,
  createApplication,
  ForbiddenError,
  module,
  permitAll,
  ValidationError,
} from '@assemora/core'
import {
  dataTransactions,
  model,
  number as numberColumn,
  string,
  timestamp,
  useAdapter,
  uuid,
} from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { number, select, text } from './fields.js'
import { clearResourceRegistry } from './registry.js'
import { resource } from './resource.js'
import './module.js'

const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  status: string(),
  views: numberColumn().default(0),
  createdAt: timestamp().created(),
})

const buildResource = (options = {}) =>
  resource(
    Article,
    {
      title: text().required().searchable(),
      status: select('draft', 'published').required().filterable(),
      views: number(),
    },
    options,
  )

const buildApp = (...resources: ReturnType<typeof buildResource>[]) => {
  const revisions = collectRevisions()
  const audit = collectAudit()

  const app = createApplication({
    modules: [module('blog').resources(...resources)],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions,
    audit,
  })

  return { app, revisions, audit }
}

beforeEach(() => {
  clearResourceRegistry()
  useAdapter(createMemoryAdapter({ articles: [] }))
})

describe('registration through the module facet', () => {
  it('registers the resource, its descriptor and the CRUD commands', () => {
    const { app } = buildApp(buildResource())

    expect(app.registry.find('resources', 'articles')?.label).toBe('Articles')
    expect([...app.commands.names()].sort()).toEqual([
      'entries.create',
      'entries.delete',
      'entries.update',
    ])
  })

  it('describes commands in the schema registry too', () => {
    const { app } = buildApp(buildResource())

    expect(app.registry.find('commands', 'entries.create')).toMatchObject({
      module: 'resources',
      description: 'Creates an entry in a resource',
    })
  })
})

describe('entries.create', () => {
  it('creates an entry and returns it', async () => {
    const { app } = buildApp(buildResource())

    const created = (await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', status: 'draft' },
    })) as { id: string; entry: Record<string, unknown> }

    expect(created.entry).toMatchObject({ title: 'Ada writes', status: 'draft' })
    expect(await Article.count()).toBe(1)
  })

  it('records a revision, so the change is reversible', async () => {
    const { app, revisions } = buildApp(buildResource())

    await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', status: 'draft' },
    })

    expect(revisions.entries[0]).toMatchObject({
      entityType: 'articles',
      command: 'entries.create',
      before: null,
      after: { title: 'Ada writes' },
    })
  })

  it('emits an event once the change is durable', async () => {
    const { app } = buildApp(buildResource())
    const listener = vi.fn()
    app.events.on('entry.created', listener)

    await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', status: 'draft' },
    })

    expect(listener).toHaveBeenCalledWith({ resource: 'articles', id: expect.any(String) })
  })

  it('validates against the resource fields, not the columns', async () => {
    const { app } = buildApp(buildResource())

    await expect(
      app.commands.execute('entries.create', {
        resource: 'articles',
        data: { title: 'Ada writes', status: 'nonsense' },
      }),
    ).rejects.toThrowError(ValidationError)
  })

  it('refuses an unknown resource', async () => {
    const { app } = buildApp(buildResource())

    await expect(
      app.commands.execute('entries.create', { resource: 'ghosts', data: {} }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE', status: 404 })
  })
})

describe('entries.update and entries.delete', () => {
  const seed = async (app: ReturnType<typeof buildApp>['app']) =>
    (await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', status: 'draft' },
    })) as { id: string }

  it('updates only what was sent', async () => {
    const { app, revisions } = buildApp(buildResource())
    const created = await seed(app)

    await app.commands.execute('entries.update', {
      resource: 'articles',
      id: created.id,
      data: { status: 'published' },
    })

    const stored = await Article.findOrFail(created.id)

    expect(stored.status).toBe('published')
    expect(stored.title).toBe('Ada writes')
    expect(revisions.entries[1]).toMatchObject({
      command: 'entries.update',
      before: { status: 'draft' },
      after: { status: 'published' },
    })
  })

  it('deletes an entry and records what was there', async () => {
    const { app, revisions } = buildApp(buildResource())
    const created = await seed(app)

    await app.commands.execute('entries.delete', { resource: 'articles', id: created.id })

    expect(await Article.count()).toBe(0)
    expect(revisions.entries[1]).toMatchObject({ command: 'entries.delete', after: null })
  })

  it('audits every outcome', async () => {
    const { app, audit } = buildApp(buildResource())
    await seed(app)

    expect(audit.entries).toMatchObject([{ action: 'entries.create', outcome: 'succeeded' }])
  })
})

describe('api exposure (SPEC.md §43)', () => {
  it('refuses an operation the resource turned off', async () => {
    const { app } = buildApp(buildResource({ api: { create: false, delete: false } }))

    await expect(
      app.commands.execute('entries.create', {
        resource: 'articles',
        data: { title: 'x', status: 'draft' },
      }),
    ).rejects.toThrowError(ForbiddenError)
  })

  it('leaves the operations it kept working', async () => {
    const { app } = buildApp(buildResource({ api: { delete: false } }))

    await expect(
      app.commands.execute('entries.create', {
        resource: 'articles',
        data: { title: 'x', status: 'draft' },
      }),
    ).resolves.toMatchObject({ entry: { title: 'x' } })
  })
})

describe('the transaction stage of SPEC.md §14', () => {
  it('commits a handler that writes more than once', async () => {
    const { app } = buildApp(buildResource())

    await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'Ada writes', status: 'draft' },
    })

    expect(await Article.count()).toBe(1)
  })

  it('undoes everything a failing command wrote', async () => {
    const { app } = buildApp(buildResource())

    await app.commands.execute('entries.create', {
      resource: 'articles',
      data: { title: 'First', status: 'draft' },
    })

    // The revision port runs inside the transaction, so a failure there has to take
    // the handler's writes down with it.
    const failing = createApplication({
      modules: [module('other').resources(buildResource({ name: 'others' }))],
      authorization: permitAll(),
      transactions: dataTransactions(),
      revisions: {
        record: () => Promise.reject(new Error('the revision store is down')),
      },
    })

    await expect(
      failing.commands.execute('entries.create', {
        resource: 'others',
        data: { title: 'Second', status: 'draft' },
      }),
    ).rejects.toThrowError('the revision store is down')

    expect(await Article.count()).toBe(1)
  })
})

describe('authorization', () => {
  it('denies every entry command until a policy provider is registered', async () => {
    clearResourceRegistry()

    const app = createApplication({
      modules: [module('blog').resources(buildResource())],
    })

    await expect(
      app.commands.execute('entries.create', {
        resource: 'articles',
        data: { title: 'x', status: 'draft' },
      }),
    ).rejects.toThrowError(ForbiddenError)

    expect(await Article.count()).toBe(0)
  })
})
