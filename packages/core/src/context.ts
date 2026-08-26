/**
 * Application context (SPEC.md §12).
 *
 * The context travels through AsyncLocalStorage rather than through every function
 * signature, so logs, commands, events, revisions and audit entries can attach the
 * actor and request id without anyone passing them by hand.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type ActorType = 'user' | 'agent' | 'api'

export type Actor = {
  readonly type: ActorType
  readonly id: string
}

export type ContextSource = 'studio' | 'rest' | 'sdk' | 'mcp' | 'cli' | 'internal'

export type AssemoraContext = {
  readonly requestId: string
  readonly actor?: Actor
  readonly source: ContextSource
  readonly locale?: string
}

const storage = new AsyncLocalStorage<AssemoraContext>()

export type ContextInit = {
  readonly source: ContextSource
  readonly requestId?: string
  readonly actor?: Actor
  readonly locale?: string
}

export const createContext = (init: ContextInit): AssemoraContext => ({
  requestId: init.requestId ?? randomUUID(),
  source: init.source,
  ...(init.actor === undefined ? {} : { actor: init.actor }),
  ...(init.locale === undefined ? {} : { locale: init.locale }),
})

/** Runs `operation` with `context` visible to everything it awaits. */
export const runInContext = <T>(context: AssemoraContext, operation: () => T): T =>
  storage.run(context, operation)

/** The context of the current operation, or `undefined` outside of one. */
export const currentContext = (): AssemoraContext | undefined => storage.getStore()

/**
 * The context of the current operation, creating an internal one when there is
 * none. Used by entry points that may be called from a script as well as a request.
 */
export const contextOrInternal = (): AssemoraContext =>
  storage.getStore() ?? createContext({ source: 'internal' })
