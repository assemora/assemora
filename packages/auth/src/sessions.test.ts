import { useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { resolveActor, SESSION_COOKIE } from './actors.js'
import { hashPassword } from './credentials.js'
import { Session, User } from './models.js'
import { endSession, purgeExpiredSessions, sessionActor, startSession } from './sessions.js'
import { createAgent, createApiToken, tokenActor } from './tokens.js'

const account = async (active = true) =>
  User.create({
    email: 'ada@x.io',
    name: 'Ada',
    passwordHash: await hashPassword('correct horse battery staple'),
    active,
  })

beforeEach(() => {
  useAdapter(createMemoryAdapter({}))
})

describe('sessions (SPEC.md §49)', () => {
  it('hands back a secret and stores only its digest', async () => {
    const user = await account()
    const started = await startSession(user.id)

    expect(started.token.startsWith('ses_')).toBe(true)

    const stored = await Session.findOrFail(started.sessionId)

    expect(stored.tokenHash).not.toBe(started.token)
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the secret out of serialized output', async () => {
    const user = await account()
    const started = await startSession(user.id)
    const stored = await Session.findOrFail(started.sessionId)

    expect(stored.toJSON()).not.toHaveProperty('tokenHash')
  })

  it('resolves the user behind a live session', async () => {
    const user = await account()
    const started = await startSession(user.id)

    expect(await sessionActor(started.token)).toEqual({ type: 'user', id: user.id })
  })

  it('resolves nobody for a secret that was never issued', async () => {
    expect(await sessionActor('ses_made-up')).toBeUndefined()
  })

  it('resolves nobody once the session has expired', async () => {
    const user = await account()
    const started = await startSession(user.id, { ttlMs: -1 })

    expect(await sessionActor(started.token)).toBeUndefined()
  })

  it('resolves nobody for a user who was deactivated', async () => {
    const user = await account()
    const started = await startSession(user.id)

    await user.update({ active: false })

    expect(await sessionActor(started.token)).toBeUndefined()
  })

  it('ends on request, and ending an unknown session is not an error', async () => {
    const user = await account()
    const started = await startSession(user.id)

    await endSession(started.token)

    expect(await sessionActor(started.token)).toBeUndefined()
    await expect(endSession('ses_never-existed')).resolves.toBeUndefined()
  })

  it('sweeps what has expired', async () => {
    const user = await account()
    await startSession(user.id, { ttlMs: -1 })
    const live = await startSession(user.id)

    expect(await purgeExpiredSessions()).toBe(1)
    expect(await sessionActor(live.token)).not.toBeUndefined()
  })
})

describe('tokens (SPEC.md §49, §72)', () => {
  it('resolves an API token to an api actor', async () => {
    const issued = await createApiToken({ name: 'ci', permissions: ['articles.read'] })

    expect(await tokenActor(issued.token)).toEqual({ type: 'api', id: issued.id })
  })

  it('resolves an agent token to an agent actor', async () => {
    const created = await createAgent({ name: 'content-agent', permissions: [] })

    expect(await tokenActor(created.token)).toEqual({ type: 'agent', id: created.agentId })
  })

  it('resolves nobody once a token has expired', async () => {
    const issued = await createApiToken({
      name: 'ci',
      permissions: [],
      expiresAt: new Date(Date.now() - 1000),
    })

    expect(await tokenActor(issued.token)).toBeUndefined()
  })

  it('resolves nobody for an agent that was switched off', async () => {
    const created = await createAgent({ name: 'content-agent', permissions: [] })
    const { Agent } = await import('./models.js')

    await (await Agent.findOrFail(created.agentId)).update({ enabled: false })

    expect(await tokenActor(created.token)).toBeUndefined()
  })

  it('records when a token was last used', async () => {
    const issued = await createApiToken({ name: 'ci', permissions: [] })
    const { ApiToken } = await import('./models.js')

    await tokenActor(issued.token)

    expect((await ApiToken.findOrFail(issued.id)).lastUsedAt).toBeInstanceOf(Date)
  })
})

describe('turning a request into an actor', () => {
  it('reads a bearer token', async () => {
    const issued = await createApiToken({ name: 'ci', permissions: [] })

    expect(await resolveActor({ authorization: `Bearer ${issued.token}` })).toEqual({
      type: 'api',
      id: issued.id,
    })
  })

  it('reads the session cookie', async () => {
    const user = await account()
    const started = await startSession(user.id)

    expect(
      await resolveActor({ cookie: `theme=dark; ${SESSION_COOKIE}=${started.token}; other=1` }),
    ).toEqual({ type: 'user', id: user.id })
  })

  it('is nobody when nothing was sent, or when what was sent means nothing', async () => {
    expect(await resolveActor({})).toBeUndefined()
    expect(await resolveActor({ authorization: 'Bearer nonsense' })).toBeUndefined()
    expect(await resolveActor({ authorization: 'Basic abc' })).toBeUndefined()
    expect(await resolveActor({ cookie: `${SESSION_COOKIE}=nonsense` })).toBeUndefined()
  })
})
