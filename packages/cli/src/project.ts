/**
 * The project's own application, booted once (ADR-0021).
 *
 * The CLI never constructs an application — it cannot, because it does not depend on
 * a single feature package. It asks the config for one and boots it, and everything
 * that needs an application comes through here so that `assemora console`, which
 * asks many times, opens one database pool rather than one per question.
 *
 * Booting is the honest cost of describing the real application instead of parsing
 * its source, which is the trade ADR-0021 accepted.
 */
import { type Application, ConfigurationError } from '@assemora/core'

import type { LoadedConfig } from './config.js'

/**
 * Keyed by config file rather than held as a single value.
 *
 * One process only ever runs one project, so the key is never observable to a user.
 * It is observable to a test that drives two projects in a row, and the alternative
 * there is the first project's application answering the second project's question.
 */
const booted = new Map<string, Promise<Application>>()

const looksLikeApplication = (value: unknown): value is Application => {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<
    Record<'boot' | 'shutdown' | 'registry' | 'commands' | 'queries', unknown>
  >

  return (
    typeof candidate.boot === 'function' &&
    typeof candidate.shutdown === 'function' &&
    typeof candidate.registry === 'object' &&
    typeof candidate.commands === 'object' &&
    typeof candidate.queries === 'object'
  )
}

const bootOnce = async (loaded: LoadedConfig): Promise<Application> => {
  const created: unknown = await loaded.config.app()

  if (!looksLikeApplication(created)) {
    throw new ConfigurationError(
      `${loaded.file}: "app" did not return an Assemora application. It must return what ` +
        'createApplication() produced, un-booted — not a server and not a promise of nothing.',
    )
  }

  // `boot()` refuses an application that is already running, and its message says so:
  // an `app()` that boots on the developer's behalf is a mistake worth hearing about
  // rather than one to paper over here.
  return created.boot()
}

/** The application this config describes. The same one, however often it is asked for. */
export const loadApplication = (loaded: LoadedConfig): Promise<Application> => {
  const existing = booted.get(loaded.file)
  if (existing !== undefined) return existing

  const pending = bootOnce(loaded)
  booted.set(loaded.file, pending)

  // A boot that failed is not worth remembering — and attaching this handler is also
  // what stops the rejection being reported as unhandled when nobody awaits it twice.
  pending.catch(() => {
    booted.delete(loaded.file)
  })

  return pending
}

/**
 * Closes everything this process booted, newest first.
 *
 * `run()` calls it when a command returns, so a database pool never outlives the
 * invocation that opened it. It is safe to call again — an application already
 * stopped ignores a second `shutdown()`.
 */
export const shutdown = async (): Promise<void> => {
  const pending = [...booted.values()].reverse()
  booted.clear()

  for (const entry of pending) {
    // An application that never finished booting has nothing to close, and its
    // failure was already delivered to whoever asked for it.
    const application = await entry.catch(() => undefined)
    await application?.shutdown()
  }
}
