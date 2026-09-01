/**
 * Where a notification goes out (SPEC.md §81).
 *
 * The interface names no messenger. A channel is handed an address and a message and
 * says nothing else about either: what a chat id is, how a bot authenticates and what
 * a 429 means belong to the driver, the way a bucket belongs to the storage driver and
 * Redis to the queue adapter (ADR-0023).
 *
 * A message is text and only text. Nothing here carries markup, a template or a
 * payload a channel would interpret, because the values in it come from an order a
 * stranger typed: a name holding `<b>` or `*` must arrive as those characters and not
 * as an instruction. A driver that has to escape something escapes it, and the
 * contract stays "this is what the person reads".
 */
import { AssemoraError } from '@assemora/core'

export type NotificationMessage = {
  readonly text: string
}

export type NotificationChannel = {
  /** What a recipient's `channel` column holds, and what the driver is chosen by. */
  readonly name: string
  /**
   * Delivers, or throws.
   *
   * Two failures are worth telling apart and the driver is the only layer that can:
   * `rejected()` for an address that will never work — a wrong chat id, a bot nobody
   * has started — and `unreachable()` for a network that was down for a minute. The
   * first must not be retried, and retrying it is how a queue spends an afternoon on
   * a typo.
   */
  send(address: string, message: NotificationMessage): Promise<void>
}

export const NOTIFICATION_REJECTED = 'NOTIFICATION_REJECTED'
export const NOTIFICATION_UNREACHABLE = 'NOTIFICATION_UNREACHABLE'

/** The channel answered, and the answer was no. Trying again changes nothing. */
export const rejected = (message: string, details?: unknown): AssemoraError =>
  new AssemoraError(NOTIFICATION_REJECTED, message, {
    status: 422,
    ...(details === undefined ? {} : { details }),
  })

/** Nobody answered. The same message may well arrive a minute from now. */
export const unreachable = (message: string, details?: unknown): AssemoraError =>
  new AssemoraError(NOTIFICATION_UNREACHABLE, message, {
    status: 503,
    // An unreachable messenger is not this application failing, and a delivery that
    // retries and succeeds is not an incident anybody has to be paged about
    // (SPEC.md §88).
    expected: true,
    ...(details === undefined ? {} : { details }),
  })

export const isRejection = (error: unknown): boolean =>
  error instanceof AssemoraError && error.code === NOTIFICATION_REJECTED

/**
 * The channels this process can send over.
 *
 * A process-wide slot, like the storage driver and the job bus: `notifications()` is
 * given the drivers and the command that sends has no application in scope. One
 * process runs one application, which is the trade those two already make.
 */
let configured: ReadonlyMap<string, NotificationChannel> = new Map()

export const useChannels = (channels: readonly NotificationChannel[]): void => {
  configured = new Map(channels.map((channel) => [channel.name, channel]))
}

export const channelNames = (): readonly string[] => [...configured.keys()]

export const channelNamed = (name: string): NotificationChannel | undefined => configured.get(name)

export const clearChannels = (): void => {
  configured = new Map()
}
