/**
 * What a stranger may do to this application, pinned.
 *
 * The playground exists to be curled and to be looked at, and until it registered a
 * policy the first thing it said to anybody without a session was `403 FORBIDDEN` — on
 * the one URL the README, the boot output and the guide all name. That is worth a test
 * rather than a comment: the rule is one line, and one line is exactly what somebody in
 * a hurry widens.
 *
 * Reading is open and writing is not. A policy grants only the actions it names, and
 * `PublicArticles` names one, so what follows is the whole of it in both directions.
 *
 * The second stage is where a write is refused, not the first. Stage one asks whether
 * the actor holds the permission or a policy exists for the subject at all; a
 * record-scoped action then asks the rule again with the row in hand (ADR-0015), and
 * that is the question with no answer here. Both are asserted below, because only the
 * pair of them is the guarantee — `entries.update` and `entries.delete` do pass stage
 * one, and the refusal a caller actually receives comes from the stage the command's
 * own handler asks for.
 */
import { clearPolicies, policies, registerPolicy } from '@assemora/auth'
import { createContext } from '@assemora/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PublicArticles } from './blog.ts'

/** Nobody signed in, which is what a `curl` with no cookie and no bearer token is. */
const stranger = () => createContext({ source: 'rest' })

const article = { id: 'a1', title: 'Notes on the Analytical Engine', status: 'published' }

describe('what the playground lets a reader with no session do', () => {
  beforeEach(() => {
    clearPolicies()
    registerPolicy(PublicArticles)
  })

  afterEach(() => {
    clearPolicies()
  })

  it('opens reading, which is the whole point of a demo somebody curls', async () => {
    await expect(
      policies().authorize({
        command: 'entries.list',
        input: { resource: 'articles' },
        context: stranger(),
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses creating, which has no record and so is settled at the first stage', async () => {
    await expect(
      policies().authorize({
        command: 'entries.create',
        input: { resource: 'articles' },
        context: stranger(),
      }),
    ).rejects.toThrow()
  })

  it('refuses changing and deleting a row, once the row is in hand', async () => {
    for (const action of ['update', 'delete']) {
      await expect(
        policies().authorizeRecord?.({
          subject: 'articles',
          action,
          record: article,
          context: stranger(),
        }),
      ).rejects.toThrow()
    }
  })

  it('does not open the other subjects this application serves', async () => {
    await expect(
      policies().authorize({
        command: 'entries.list',
        input: { resource: 'pages' },
        context: stranger(),
      }),
    ).rejects.toThrow()
  })
})
