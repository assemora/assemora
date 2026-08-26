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
 * Runs an operation inside a transaction. Everything the operation awaits sees the
 * transactional adapter without being told about it.
 */
export const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
  const adapter = currentAdapter()

  return adapter.transaction(() => scoped.run(adapter, operation))
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
})
