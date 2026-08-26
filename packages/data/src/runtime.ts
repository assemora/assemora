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
export const dataTransactions = (): TransactionPort => ({
  run: (operation) => transaction(operation),
})
