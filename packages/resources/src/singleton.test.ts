/**
 * A page there is exactly one of (SPEC.md §135, ADR-0032): one row behind one command,
 * validated by its fields, versioned, revised and restorable like any other content.
 */
import {
  ConfigurationError,
  ConflictError,
  collectRevisions,
  createApplication,
  createLogger,
  ForbiddenError,
  module,
  permitAll,
  restorerFor,
  silentWriter,
  ValidationError,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { email, text, toggle } from './fields.js'
import { clearSingletonRegistry, singleton } from './singleton.js'
import { readSingleton } from './singleton-commands.js'
import { SingletonModel } from './system-models.js'
import './module.js'

const Site = singleton(
  'site',
  {
    title: text().required(),
    tagline: text(),
    contactEmail: email(),
    // An agent may propose a tagline and may not decide whether the site is open.
    open: toggle().agentAccess({ write: false }),
    // An editorial note an agent has no business reading.
    notes: text().agentAccess({ read: false }).hidden(),
  },
  { label: 'Site settings', description: 'What the site calls itself.', icon: 'building' },
)

const PERSON = { type: 'user', id: '11111111-1111-4111-8111-111111111111' } as const
const AGENT = { type: 'agent', id: 'content-agent' } as const

let app: ReturnType<typeof createApplication>
let revisions: ReturnType<typeof collectRevisions>

beforeEach(async () => {
  clearSingletonRegistry()
  useAdapter(createMemoryAdapter())
  revisions = collectRevisions()

  app = createApplication({
    modules: [module('site').singletons(Site)],
    authorization: permitAll(),
    transactions: dataTransactions(),
    revisions,
    logger: createLogger(silentWriter),
  })

  await app.boot()
})

const as = <T>(actor: typeof PERSON | typeof AGENT, work: () => Promise<T>): Promise<T> =>
  app.run({ source: actor.type === 'agent' ? 'mcp' : 'studio', actor }, work)

const update = (values: Record<string, unknown>, expectedVersion?: number) =>
  as(PERSON, () =>
    app.commands.execute('singletons.update', {
      name: 'site',
      values,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  ) as Promise<{ name: string; values: Record<string, unknown>; version: number }>

const read = (actor: typeof PERSON | typeof AGENT = PERSON) =>
  as(actor, () => app.queries.execute('singletons.get', { name: 'site' })) as Promise<{
    values: Record<string, unknown>
    version: number
    updatedAt: string | null
  }>

describe('declaring a singleton', () => {
  it('describes itself in the registry under the module that declared it, fields and all', () => {
    const described = app.registry.find('singletons', 'site')

    expect(described?.label).toBe('Site settings')
    expect(described?.icon).toBe('building')
    expect(described?.fields.map((field) => field.name)).toEqual([
      'title',
      'tagline',
      'contactEmail',
      'open',
      'notes',
    ])
    expect(app.registry.registeredBy('singletons', 'site')).toBe('site')
  })

  it('registers the two generic operations once, however many singletons there are', () => {
    expect(app.commands.has('singletons.update')).toBe(true)
    expect(app.queries.has('singletons.get')).toBe(true)
  })

  it('refuses a name that is not kebab-case, and a singleton with no fields', () => {
    expect(() => singleton('Site Settings', { title: text() })).toThrow(ConfigurationError)
    expect(() => singleton('site', {})).toThrow(/no fields/)
  })
})

describe('reading one', () => {
  it('is empty at version 0 before the first write, rather than a 404', async () => {
    expect(await read()).toEqual({ name: 'site', values: {}, version: 0, updatedAt: null })
  })

  it('hides a hidden field, and a field an agent may not read, from the answer', async () => {
    await update({ title: 'Papa Cotta', notes: 'do not publish before Monday' })

    expect((await read()).values).not.toHaveProperty('notes')
    expect((await read(AGENT)).values).toEqual({ title: 'Papa Cotta' })
  })
})

describe('an application reading one for itself', () => {
  it('answers the row without a permission, hidden fields left out, and refuses a name nobody declared', async () => {
    await update({ title: 'Papa Cotta', notes: 'do not publish before Monday' })

    const read = await readSingleton('site')

    expect(read.values).toEqual({ title: 'Papa Cotta' })
    expect(read.version).toBe(1)
    await expect(readSingleton('footer')).rejects.toThrow(/not registered/)
  })
})

describe('writing one', () => {
  it('validates against the declared fields, the way an entry is validated', async () => {
    await expect(update({ contactEmail: 'not an address' })).rejects.toBeInstanceOf(ValidationError)
    const refused = await update({ nowhere: 1 }).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(ValidationError)
    expect(JSON.stringify(refused)).toMatch(/not a field of site/)
  })

  it('creates the row on the first write and merges into it on the next', async () => {
    const first = await update({ title: 'Papa Cotta' })
    const second = await update({ tagline: 'Pizza in Chornomorsk' })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(second.values).toEqual({ title: 'Papa Cotta', tagline: 'Pizza in Chornomorsk' })
    expect(await SingletonModel.count()).toBe(1)
  })

  it('clears a field written as null, because every value lives in one document', async () => {
    await update({ title: 'Papa Cotta', tagline: 'Pizza' })

    expect((await update({ tagline: null })).values).toEqual({ title: 'Papa Cotta', tagline: null })
  })

  it('refuses a write that states a version the row has moved past (SPEC.md §66)', async () => {
    await update({ title: 'Papa Cotta' })

    await expect(update({ title: 'Papa Cotta 2' }, 0)).rejects.toBeInstanceOf(ConflictError)
    await expect(update({ title: 'Papa Cotta 2' }, 1)).resolves.toMatchObject({ version: 2 })
  })

  it('refuses the whole write when an agent touches a field it may not, naming it', async () => {
    await expect(
      as(AGENT, () =>
        app.commands.execute('singletons.update', {
          name: 'site',
          values: { tagline: 'Proposed', open: true },
        }),
      ),
    ).rejects.toThrowError(/"open"/)

    expect(await SingletonModel.count()).toBe(0)
  })

  it('records a revision under the singleton’s own name', async () => {
    await update({ title: 'Papa Cotta' })

    const recorded = revisions.entries[0]

    expect(recorded?.entityType).toBe('site')
    expect(recorded?.entityId).toBe('site')
    expect(recorded?.before).toBeNull()
  })
})

describe('putting one back (SPEC.md §65)', () => {
  it('restores a snapshot, and restores nothing by removing the row', async () => {
    await update({ title: 'Papa Cotta' })
    await update({ title: 'Renamed' })

    const restore = restorerFor('site')

    if (restore === undefined) throw new Error('no restorer was registered for site')

    const back = await as(PERSON, () => restore('site', { values: { title: 'Papa Cotta' } }))

    expect(back?.version).toBe(3)
    expect((await read()).values.title).toBe('Papa Cotta')

    await as(PERSON, () => restore('site', null))

    expect(await read()).toMatchObject({ values: {}, version: 0 })
  })
})

describe('the ForbiddenError a singleton answers with', () => {
  it('is the same class an entry answers with, so a client tells them apart the same way', async () => {
    await expect(
      as(AGENT, () =>
        app.commands.execute('singletons.update', { name: 'site', values: { open: false } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
