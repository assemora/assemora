import { boolean, string, uuid } from '@assemora/schema'
import { describe, expect, it, vi } from 'vitest'

import { command, createCommandBus } from './commands.js'
import { createContext, runInContext } from './context.js'
import { ForbiddenError, UnknownCommandError, ValidationError } from './errors.js'
import { createEventBus } from './events.js'
import { createLogger, silentWriter } from './logger.js'
import {
  type AuditEntry,
  type AuthorizationPort,
  collectAudit,
  collectRevisions,
  denyAll,
  permitAll,
  type QueuedJob,
  type QueuePort,
  type RevisionEntry,
  type TransactionPort,
} from './ports.js'
import { createSchemaRegistry } from './registry.js'

const PAGE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

type Harness = {
  readonly authorization?: AuthorizationPort
  readonly transactions?: TransactionPort
}

const harness = (overrides: Harness = {}) => {
  const trace: string[] = []
  const logger = createLogger(silentWriter)
  const events = createEventBus(logger)
  const registry = createSchemaRegistry()
  const revisions = collectRevisions()
  const audit = collectAudit()

  const tracedRevisions = {
    entries: revisions.entries,
    record: async (entries: readonly RevisionEntry[]) => {
      trace.push('revisions')
      await revisions.record(entries)
    },
  }

  const tracedAudit = {
    entries: audit.entries,
    record: async (entry: AuditEntry) => {
      trace.push(`audit:${entry.outcome}`)
      await audit.record(entry)
    },
  }

  const authorization: AuthorizationPort = overrides.authorization ?? {
    authorize: async () => {
      trace.push('authorize')
    },
  }

  const transactions: TransactionPort = overrides.transactions ?? {
    run: async (operation) => {
      trace.push('transaction:open')
      const result = await operation()
      trace.push('transaction:commit')
      return result
    },
    // This harness models no nesting, so every commit is the outermost one and work
    // registered against it runs straight away.
    afterCommit: (work) => work(),
  }

  const pushed: QueuedJob[] = []

  const queue: QueuePort = {
    push: async (jobs) => {
      trace.push('queue')
      pushed.push(...jobs)
    },
  }

  const bus = createCommandBus({
    authorization,
    transactions,
    revisions: tracedRevisions,
    audit: tracedAudit,
    events,
    queue,
    registry,
    logger,
  })

  return { bus, trace, events, registry, revisions, audit, pushed }
}

const PublishPage = command('pages.publish', {
  input: { id: uuid(), notify: boolean().optional() },
  description: 'Publishes a page',
  handle: async ({ id }, context) => {
    context.revise({
      entityType: 'page',
      entityId: id,
      before: { status: 'draft' },
      after: { status: 'published' },
    })
    context.emit('page.published', { pageId: id })
    return { id, status: 'published' as const }
  },
})

describe('command pipeline', () => {
  it('walks the stages of SPEC.md §14 in order', async () => {
    const { bus, trace } = harness()

    await bus.execute(PublishPage, { id: PAGE_ID })

    expect(trace).toEqual([
      'authorize',
      'transaction:open',
      'revisions',
      'transaction:commit',
      'audit:succeeded',
    ])
  })

  it('rejects invalid input before authorization runs', async () => {
    const { bus, trace } = harness()

    await expect(bus.execute(PublishPage, { id: 'not-a-uuid' })).rejects.toThrowError(
      ValidationError,
    )
    expect(trace).toEqual(['audit:failed'])
  })

  it('reports validation failures by field', async () => {
    const { bus, registry } = harness()

    await expect(bus.execute(PublishPage, { id: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { id: ['Invalid UUID'] },
    })
  })

  it('hands the handler validated input with unknown keys stripped', async () => {
    const handle = vi.fn(async () => 'done')
    const Probe = command('probe.run', { input: { id: uuid() }, handle })
    const { bus, registry } = harness()

    await bus.execute(Probe, { id: PAGE_ID, isAdmin: true })

    expect(handle).toHaveBeenCalledWith({ id: PAGE_ID }, expect.anything())
  })

  it('denies everything until a policy provider is registered', async () => {
    const handle = vi.fn(async () => 'done')
    const Probe = command('probe.denied', { input: { id: uuid() }, handle })
    const { bus, trace } = harness({ authorization: denyAll() })

    await expect(bus.execute(Probe, { id: PAGE_ID })).rejects.toThrowError(ForbiddenError)
    expect(handle).not.toHaveBeenCalled()
    expect(trace).toEqual(['audit:failed'])
  })

  it('records revisions inside the transaction', async () => {
    const { bus, revisions, trace } = harness()

    await bus.execute(PublishPage, { id: PAGE_ID })

    expect(trace.indexOf('revisions')).toBeGreaterThan(trace.indexOf('transaction:open'))
    expect(trace.indexOf('revisions')).toBeLessThan(trace.indexOf('transaction:commit'))
    expect(revisions.entries).toEqual([
      {
        entityType: 'page',
        entityId: PAGE_ID,
        command: 'pages.publish',
        before: { status: 'draft' },
        after: { status: 'published' },
        requestId: expect.any(String),
      },
    ])
  })

  it('emits events only after the transaction commits', async () => {
    const { bus, events, trace } = harness()
    events.on('page.published', () => {
      trace.push('listener')
    })

    await bus.execute(PublishPage, { id: PAGE_ID })

    expect(trace.indexOf('listener')).toBeGreaterThan(trace.indexOf('transaction:commit'))
  })

  it('does not emit events when the transaction fails', async () => {
    const listener = vi.fn()
    const { bus, events } = harness({
      transactions: {
        run: async () => {
          throw new Error('rolled back')
        },
        afterCommit: (work) => work(),
      },
    })
    events.on('page.published', listener)

    await expect(bus.execute(PublishPage, { id: PAGE_ID })).rejects.toThrowError('rolled back')
    expect(listener).not.toHaveBeenCalled()
  })

  it('audits both outcomes with the actor and the request', async () => {
    const { bus, audit } = harness()

    await runInContext(
      createContext({ source: 'mcp', requestId: 'req-9', actor: { type: 'agent', id: 'writer' } }),
      async () => {
        await bus.execute(PublishPage, { id: PAGE_ID })
        await expect(bus.execute(PublishPage, { id: 'bad' })).rejects.toThrowError(ValidationError)
      },
    )

    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'pages.publish',
        source: 'mcp',
        requestId: 'req-9',
        actor: { type: 'agent', id: 'writer' },
        outcome: 'succeeded',
      }),
      expect.objectContaining({ outcome: 'failed', metadata: { reason: 'VALIDATION_ERROR' } }),
    ])
  })

  it('stamps revisions with the acting agent', async () => {
    const { bus, revisions } = harness()

    await runInContext(
      createContext({ source: 'mcp', actor: { type: 'agent', id: 'writer' } }),
      () => bus.execute(PublishPage, { id: PAGE_ID }),
    )

    expect(revisions.entries[0]?.actor).toEqual({ type: 'agent', id: 'writer' })
  })

  it('returns whatever the handler returns', async () => {
    const { bus, registry } = harness()

    await expect(bus.execute(PublishPage, { id: PAGE_ID })).resolves.toEqual({
      id: PAGE_ID,
      status: 'published',
    })
  })
})

describe('registration and dispatch by name', () => {
  it('describes a registered command in the schema registry', () => {
    const { bus, registry } = harness()
    bus.register(PublishPage, 'pages')

    expect(registry.find('commands', 'pages.publish')).toEqual({
      name: 'pages.publish',
      description: 'Publishes a page',
      module: 'pages',
      input: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          notify: { type: 'boolean' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    })
  })

  it('executes a command addressed by name, as MCP and REST do', async () => {
    const { bus } = harness({ authorization: permitAll() })
    bus.register(PublishPage)

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).resolves.toEqual({
      id: PAGE_ID,
      status: 'published',
    })
    expect(bus.names()).toEqual(['pages.publish'])
    expect(bus.has('pages.publish')).toBe(true)
  })

  it('refuses an unknown name', () => {
    const { bus, registry } = harness()

    expect(() => bus.execute('pages.vanish', {})).toThrowError(UnknownCommandError)
  })

  it('validates a named call exactly like a typed one', async () => {
    const { bus, registry } = harness()
    bus.register(PublishPage)

    await expect(bus.execute('pages.publish', { id: 'nope' })).rejects.toThrowError(ValidationError)
  })
})

describe('command definition', () => {
  it('turns its input shape into an object schema', () => {
    expect(PublishPage.name).toBe('pages.publish')
    expect(PublishPage.input.parse({ id: PAGE_ID }).ok).toBe(true)
    expect(PublishPage.input.parse({}).ok).toBe(false)
  })

  it('keeps the description optional', () => {
    const Bare = command('bare.run', { input: { name: string() }, handle: async () => null })

    expect(Bare.description).toBeUndefined()
  })
})

describe('where a command may be called from (SPEC.md §85)', () => {
  const SignIn = command('auth.login', {
    description: 'Exchanges an email and a password for a session',
    reachableFrom: 'its own route',
    input: { email: string() },
    handle: async () => ({ token: 'ses_secret' }),
  })

  it('is reachable from anywhere unless the command says otherwise', () => {
    expect(PublishPage.reachableFrom).toBe('anywhere')
    expect(SignIn.reachableFrom).toBe('its own route')
  })

  it('tells the registry, because the generators read the registry and not the bus', () => {
    const { bus, registry } = harness()
    bus.register(SignIn, 'auth')

    // The generated HTTP endpoints and the MCP tool list are both built from this
    // descriptor. A declaration the registry does not carry is a declaration no
    // generator can honour (ADR-0002).
    expect(registry.find('commands', 'auth.login')).toMatchObject({
      reachableFrom: 'its own route',
    })
  })

  it('says nothing about a command that made no such declaration', () => {
    const { bus, registry } = harness()
    bus.register(PublishPage, 'pages')

    expect(registry.find('commands', 'pages.publish')).not.toHaveProperty('reachableFrom')
  })

  it('does not stop the bus: the route it was written for calls the same command', async () => {
    const { bus } = harness({ authorization: permitAll() })
    bus.register(SignIn, 'auth')

    // The declaration removes generated doors, never the command itself. The route
    // written for it reaches the bus by name like every other caller.
    await expect(bus.execute('auth.login', { email: 'ada@assemora.dev' })).resolves.toEqual({
      token: 'ses_secret',
    })
  })

  it('cannot be previewed, because a preview is not a call through that route', async () => {
    const { bus } = harness({ authorization: permitAll() })
    bus.register(SignIn, 'auth')
    bus.register(PublishPage, 'pages')

    // `changesets.propose` previews whatever commands it is handed, so a preview is
    // the third generic door: without this, an agent holding only `changesets.propose`
    // proposes `auth.login` and reads the password out of whether the preview
    // succeeded (SPEC.md §85).
    await expect(bus.dryRun('auth.login', { email: 'ada@assemora.dev' })).rejects.toMatchObject({
      code: 'UNREACHABLE_COMMAND',
    })

    await expect(
      bus.dryRunAll([
        { command: 'pages.publish', input: { id: PAGE_ID } },
        { command: 'auth.login', input: { email: 'ada@assemora.dev' } },
      ]),
    ).rejects.toMatchObject({ code: 'UNREACHABLE_COMMAND' })
  })
})

/**
 * The second stage is owed, not merely offered (SPEC.md §50, §51, ADR-0015).
 *
 * A rule about the row cannot be answered before the row is read, so the first stage
 * lets a command as far as reading it and the second asks again with the record in
 * hand. That is a guarantee only while the second question is actually put — and until
 * the bus held commands to it, a handler that forgot produced a command anybody could
 * run, with the first stage already having said yes.
 */
describe('a command that was only deferred, not allowed', () => {
  const deferring: AuthorizationPort = {
    authorize: async () => ({ deferredTo: { subject: 'pages', action: 'publish' } }),
    authorizeRecord: async () => {},
  }

  const Forgetful = command('pages.publish', {
    input: { id: uuid() },
    description: 'Publishes a page without asking who may publish this one',
    handle: async ({ id }, context) => {
      context.revise({
        entityType: 'page',
        entityId: id,
        before: { status: 'draft' },
        after: { status: 'published' },
      })

      return { id }
    },
  })

  const Careful = command('pages.publish', {
    input: { id: uuid() },
    description: 'Publishes a page, having asked about this one',
    handle: async ({ id }, context) => {
      await context.authorize('pages', 'publish', { id, status: 'draft' })

      return { id }
    },
  })

  it('is refused when the handler never asked, and the refusal names it', async () => {
    const { bus } = harness({ authorization: deferring })

    bus.register(Forgetful, 'pages')

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).rejects.toThrow(/pages\.publish/)
  })

  it('says which question was owed, so the fix is the message', async () => {
    const { bus } = harness({ authorization: deferring })

    bus.register(Forgetful, 'pages')

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).rejects.toThrow(
      /context\.authorize\("pages", "publish", record\)/,
    )
  })

  it('takes the handler’s writes with it, rather than committing them', async () => {
    const { bus, trace, revisions } = harness({ authorization: deferring })

    bus.register(Forgetful, 'pages')

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).rejects.toThrow()

    // The handler had already revised by the time the question came due, so the only
    // thing left that can be true is that none of it lasts.
    expect(trace).not.toContain('transaction:commit')
    expect(revisions.entries).toHaveLength(0)
  })

  it('lets through the handler that asked', async () => {
    const { bus } = harness({ authorization: deferring })

    bus.register(Careful, 'pages')

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).resolves.toEqual({ id: PAGE_ID })
  })

  it('demands nothing of a command the first stage allowed outright', async () => {
    // Nothing was deferred, so nothing is owed. A permission held outright is a whole
    // answer, and a handler that does not ask again is not withholding anything.
    const { bus } = harness()

    bus.register(Forgetful, 'pages')

    await expect(bus.execute('pages.publish', { id: PAGE_ID })).resolves.toEqual({ id: PAGE_ID })
  })
})
