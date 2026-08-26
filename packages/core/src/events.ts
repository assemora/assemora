/**
 * Domain events (SPEC.md §81).
 *
 * Events carry side effects — cache invalidation, notifications, indexing — and are
 * emitted after a command commits. Critical sequential logic belongs in the command
 * handler, never here: a failing listener must not fail the command.
 */
import type { Logger } from './logger.js'

/**
 * Packages declare their events by augmenting this interface, so a listener gets the
 * right payload type without core knowing what a page or an entry is.
 *
 * ```ts
 * declare module '@assemora/core' {
 *   interface AssemoraEventPayloads {
 *     'page.published': { pageId: string }
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation point for other packages
export interface AssemoraEventPayloads {}

export type PayloadOf<K extends string> = K extends keyof AssemoraEventPayloads
  ? AssemoraEventPayloads[K]
  : unknown

export type Unsubscribe = () => void

export type EventBus = {
  on<K extends string>(
    name: K,
    listener: (payload: PayloadOf<K>) => void | Promise<void>,
  ): Unsubscribe
  emit<K extends string>(name: K, payload: PayloadOf<K>): Promise<void>
  listenerCount(name: string): number
}

type AnyListener = (payload: never) => void | Promise<void>

export const createEventBus = (logger: Logger): EventBus => {
  const listeners = new Map<string, Set<AnyListener>>()

  return {
    on(name, listener) {
      const existing = listeners.get(name) ?? new Set<AnyListener>()
      existing.add(listener as AnyListener)
      listeners.set(name, existing)

      return () => {
        existing.delete(listener as AnyListener)
      }
    },

    async emit(name, payload) {
      const registered = listeners.get(name)
      if (registered === undefined || registered.size === 0) return

      const results = await Promise.allSettled(
        [...registered].map(async (listener) => {
          await (listener as (value: unknown) => void | Promise<void>)(payload)
        }),
      )

      for (const result of results) {
        if (result.status === 'rejected') {
          // The command has already committed. A broken side effect is reported,
          // never rethrown into the caller's transaction.
          logger.error('Event listener failed', {
            event: name,
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
        }
      }
    },

    listenerCount(name) {
      return listeners.get(name)?.size ?? 0
    },
  }
}
