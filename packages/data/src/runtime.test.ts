/**
 * The transaction seam (ADR-0008, ADR-0023).
 *
 * `dataTransactions()` owns the AsyncLocalStorage the whole data layer runs inside,
 * which makes it the one place that knows whether a commit is the outermost one. It
 * is therefore also the one place that can say when work scheduled by a command —
 * jobs, and the events beside them — is safe to run.
 */
import { createMemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { dataTransactions, transaction, useAdapter } from './runtime.js'

beforeEach(() => {
  useAdapter(createMemoryAdapter())
})

describe('work registered for after the commit', () => {
  it('runs now when no transaction is open', async () => {
    const ran: string[] = []

    await dataTransactions().afterCommit(async () => {
      ran.push('work')
    })

    expect(ran).toEqual(['work'])
  })

  it('waits for the commit, and runs once it has happened', async () => {
    const order: string[] = []

    await transaction(async () => {
      await dataTransactions().afterCommit(async () => {
        order.push('work')
      })

      order.push('still inside')
    })

    expect(order).toEqual(['still inside', 'work'])
  })

  it('is discarded when the transaction is undone', async () => {
    const ran: string[] = []

    await expect(
      transaction(async () => {
        await dataTransactions().afterCommit(async () => {
          ran.push('work')
        })

        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    expect(ran).toEqual([])
  })

  it('waits for the outermost commit, not for the savepoint it was registered in', async () => {
    const order: string[] = []

    await transaction(async () => {
      // What a command's own `transactions.run` is, inside anything else.
      await transaction(async () => {
        await dataTransactions().afterCommit(async () => {
          order.push('work')
        })
      })

      order.push('the inner one has returned')
    })

    expect(order).toEqual(['the inner one has returned', 'work'])
  })

  it('goes with the outer rollback, though the savepoint it was registered in succeeded', async () => {
    const ran: string[] = []

    await expect(
      transaction(async () => {
        await transaction(async () => {
          await dataTransactions().afterCommit(async () => {
            ran.push('work')
          })
        })

        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    expect(ran).toEqual([])
  })

  it('runs nothing that a preview registered', async () => {
    const ran: string[] = []

    const value = await dataTransactions().run(
      async () => {
        await dataTransactions().afterCommit(async () => {
          ran.push('work')
        })

        return 'previewed'
      },
      { rollback: true },
    )

    // A dry run answers with what the handler returned and undoes everything else, so
    // work that was waiting for a commit that never came must never run (SPEC.md §73).
    expect(value).toBe('previewed')
    expect(ran).toEqual([])
  })

  it('lets one registration fail without cancelling the next', async () => {
    const ran: string[] = []

    // Nothing is left to reject to once the commit has happened, so a failure here is
    // the registrant's to report — and it must not take the work behind it down.
    await transaction(async () => {
      await dataTransactions().afterCommit(() => Promise.reject(new Error('the queue is asleep')))
      await dataTransactions().afterCommit(async () => {
        ran.push('second')
      })
    })

    expect(ran).toEqual(['second'])
  })

  it('hands over immediately once the commit it was waiting for has happened', async () => {
    const order: string[] = []

    await transaction(async () => {
      await dataTransactions().afterCommit(async () => {
        order.push('first')

        // Registered from inside after-commit work: there is no transaction left, so
        // this runs where it stands rather than joining a list already being read.
        await dataTransactions().afterCommit(async () => {
          order.push('second')
        })

        order.push('first is done')
      })
    })

    expect(order).toEqual(['first', 'second', 'first is done'])
  })
})
