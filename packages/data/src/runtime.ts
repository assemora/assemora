/**
 * Where the data layer finds its adapter (SPEC.md §33).
 *
 * The current adapter and the current transaction travel through AsyncLocalStorage,
 * so a developer never passes `tx` by hand.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { ConfigurationError, type TransactionPort } from '@assemora/core'
import type { DatabaseAdapter } from '@assemora/database'

let ambient: DatabaseAdapter | undefined

const scoped = new AsyncLocalStorage<DatabaseAdapter>()

/** Binds the adapter every model will use. Called once, when the application boots. */
export const useAdapter = (adapter: DatabaseAdapter): void => {
  ambient = adapter
}

export const clearAdapter = (): void => {
  ambient = undefined
}

export const currentAdapter = (): DatabaseAdapter => {
  const adapter = scoped.getStore() ?? ambient

  if (adapter === undefined) {
    throw new ConfigurationError(
      'No database adapter is registered. Call useAdapter() before querying.',
    )
  }

  return adapter
}

/**
 * Work waiting for the OUTERMOST transaction to commit (ADR-0023).
 *
 * The store is the list itself, and a nested `transaction()` never replaces it — so
 * every layer inside registers against the one commit that actually makes rows
 * durable. A savepoint is not that commit: everything written under it is still the
 * caller's to undo.
 */
const waiting = new AsyncLocalStorage<(() => Promise<void>)[]>()

const drain = async (work: readonly (() => Promise<void>)[]): Promise<void> => {
  for (const item of work) {
    try {
      await item()
    } catch {
      // Swallowed on purpose, and documented on `TransactionPort.afterCommit`: this
      // runs after the commit, so there is no caller left to reject to, and one
      // registration's failure must not cancel the next one's. Whoever registers
      // reports its own failure — the command bus logs the job it could not queue.
    }
  }
}

/**
 * Runs an operation inside a transaction. Everything the operation awaits sees the
 * transactional adapter without being told about it.
 */
export const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
  const adapter = currentAdapter()
  const run = () => adapter.transaction(() => scoped.run(adapter, operation))

  // Nested: the caller owns the commit, so anything registered inside keeps waiting
  // for theirs.
  if (waiting.getStore() !== undefined) return run()

  const work: (() => Promise<void>)[] = []

  // `.then` is attached outside `waiting.run`, so the work drains with no transaction
  // in scope — a job dispatched by after-commit work has nothing left to wait for,
  // and would otherwise be appended to a list that is already being read.
  return waiting.run(work, run).then(async (value) => {
    await drain(work)

    return value
  })
}

/**
 * Holds `work` until the outermost transaction commits, and drops it if that
 * transaction is undone. With none open, "after commit" is "now".
 */
const afterCommit = (work: () => Promise<void>): Promise<void> => {
  const pending = waiting.getStore()

  if (pending === undefined) return work()

  pending.push(work)

  return Promise.resolve()
}

/**
 * The transaction stage of the command pipeline (SPEC.md §14, ADR-0008).
 *
 * `core` declares the port and cannot reach a database; this is the implementation
 * the data layer registers, so a handler that writes several rows either commits all
 * of them or none.
 */
/** Nothing else can be thrown by accident, so nothing else can be mistaken for it. */
const ROLLBACK = Symbol('assemora.rollback')

/**
 * Runs the operation inside a transaction that is always undone, and still answers
 * with what it returned (SPEC.md §73).
 *
 * Rejecting is the only way to make an adapter roll back — that is how both of them
 * implement it — so the value is carried out past the rejection rather than through
 * it. A real failure inside the operation is rethrown untouched.
 */
const rollingBack = async <T>(operation: () => Promise<T>): Promise<T> => {
  const carried: T[] = []

  try {
    await transaction(async () => {
      carried.push(await operation())

      throw ROLLBACK
    })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }

  const [value] = carried

  if (carried.length === 0) {
    throw new ConfigurationError('The transaction was undone before the operation answered')
  }

  return value as T
}

export const dataTransactions = (): TransactionPort => ({
  run: (operation, options) =>
    options?.rollback === true ? rollingBack(operation) : transaction(operation),
  afterCommit,
})
