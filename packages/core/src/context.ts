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
  /**
   * What the client said it was, when the operation arrived over a network.
   *
   * It belongs here rather than in the input of the commands that record it. A
   * command that takes it as an argument lets the caller choose what the session
   * and the audit row say about it, which is a forged forensic trail written by the
   * person it would be used to identify (SPEC.md §85).
   *
   * Absent outside a request — a CLI run, a scheduled job, a test — and absent is
   * the truthful answer there.
   *
   * There is deliberately no `ipAddress` beside it. The process cannot know the
   * client's address honestly: behind any proxy the socket peer is the proxy, and
   * believing `X-Forwarded-For` without a configured chain of trusted hops is the
   * same forgery one layer down. Recording it would take a trusted-proxy option on
   * the HTTP server first.
   */
  readonly userAgent?: string
}

const storage = new AsyncLocalStorage<AssemoraContext>()

export type ContextInit = {
  readonly source: ContextSource
  readonly requestId?: string
  readonly actor?: Actor
  readonly locale?: string
  readonly userAgent?: string
}

export const createContext = (init: ContextInit): AssemoraContext => ({
  requestId: init.requestId ?? randomUUID(),
  source: init.source,
  ...(init.actor === undefined ? {} : { actor: init.actor }),
  ...(init.locale === undefined ? {} : { locale: init.locale }),
  ...(init.userAgent === undefined ? {} : { userAgent: init.userAgent }),
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
