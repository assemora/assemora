/**
 * Signing in is a command with exactly one door (SPEC.md §49, §85).
 *
 * `auth.login` is the one command an application authorizes publicly — it has to be,
 * because the caller is nobody yet. Everything that makes it safe therefore lives in
 * the route written for it, so the command says so out loud and the generators leave
 * it alone.
 */
import { createApplication, createLogger, module, silentWriter } from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { policies } from './authorization.js'
import { authCommands, publicAuthPolicy, SignIn, SignOut } from './commands.js'
import { hashPassword } from './credentials.js'
import { Session, User } from './models.js'
import { clearPolicies, registerPolicy } from './policies.js'

const PASSWORD = 'correct horse battery staple'

let app: ReturnType<typeof createApplication>

beforeEach(async () => {
  clearPolicies()
  registerPolicy(publicAuthPolicy)
  useAdapter(createMemoryAdapter())

  app = createApplication({
    modules: [module('auth').commands(...authCommands)],
    authorization: policies(),
    transactions: dataTransactions(),
    logger: createLogger(silentWriter),
  })

  await app.boot()

  await User.create({
    email: 'ada@assemora.dev',
    name: 'Ada',
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    version: 1,
  })
})

describe('the session commands are reachable only through their own routes', () => {
  it('says so, so no generator has to keep a list of their names', () => {
    expect(SignIn.reachableFrom).toBe('its own route')
    expect(SignOut.reachableFrom).toBe('its own route')
  })

  it('cannot be previewed, which is how a proposal would have reached it', async () => {
    await expect(
      app.run({ source: 'mcp', actor: { type: 'agent', id: 'agent-1' } }, () =>
        app.commands.dryRunAll([
          { command: 'auth.login', input: { email: 'ada@assemora.dev', password: 'a guess' } },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'UNREACHABLE_COMMAND' })
  })

  it('still works for the route, which is the whole point of naming one', async () => {
    const started = await app.run({ source: 'studio' }, () =>
      app.commands.execute(SignIn, { email: 'ada@assemora.dev', password: PASSWORD }),
    )

    expect(started.token.startsWith('ses_')).toBe(true)
  })
})

describe('the forensic fields are the request’s, never the caller’s (SPEC.md §85)', () => {
  it('records the user agent the context carries', async () => {
    const started = await app.run(
      { source: 'studio', userAgent: 'Mozilla/5.0 (a real browser)' },
      () => app.commands.execute(SignIn, { email: 'ada@assemora.dev', password: PASSWORD }),
    )

    expect((await Session.where('userId', started.userId).firstOrFail()).userAgent).toBe(
      'Mozilla/5.0 (a real browser)',
    )
  })

  it('ignores a user agent the caller puts in the body', async () => {
    const started = await app.run({ source: 'studio', userAgent: 'the real one' }, () =>
      // Unknown keys are dropped by the input schema rather than carried through,
      // so a caller cannot dictate what the session says about it.
      app.commands.execute(SignIn, {
        email: 'ada@assemora.dev',
        password: PASSWORD,
        userAgent: 'forged',
        ipAddress: '10.0.0.1',
      }),
    )

    const session = await Session.where('userId', started.userId).firstOrFail()

    expect(session.userAgent).toBe('the real one')
    // Nothing in the framework knows the client address honestly — see the comment
    // on `SignIn` — so the column stays empty rather than holding a claim.
    expect(session.ipAddress).toBeNull()
  })

  it('leaves both out of the published input schema', () => {
    const described = SignIn.input.toJsonSchema() as {
      properties: Record<string, unknown>
    }

    expect(Object.keys(described.properties)).toEqual(['email', 'password'])
  })
})
