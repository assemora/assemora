/**
 * The Telegram driver (SPEC.md §81).
 *
 * A bot, a chat id and one method of the Bot API. It is the only file in this
 * repository that knows Telegram exists, and it holds no state beyond its token — the
 * same bargain `s3-storage.ts` makes with a bucket.
 *
 * There is deliberately no `parse_mode`. Telegram then reads the text literally, so a
 * customer called `*Ада*` arrives as those characters and a comment holding an HTML
 * tag cannot close one the message never opened. Formatting would have to be escaped
 * value by value, and a missed escape is not a cosmetic bug: it is a stranger writing
 * markup into a staff channel.
 */
import { ConfigurationError } from '@assemora/core'

import { type NotificationChannel, rejected, unreachable } from './channel.js'

export type TelegramOptions = {
  /** From @BotFather. A secret: it never reaches the registry, a log or an answer. */
  readonly token: string
  /** The Bot API root. Overridden by tests and by a self-hosted Bot API server. */
  readonly api?: string
  /** How long one send may take. A hung request holds the command that is sending. */
  readonly timeoutMs?: number
  /** Injected by tests; production uses the platform's. */
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Telegram's own ceiling, in UTF-16 code units, and the message is cut to fit.
 *
 * Refusing instead would be defensible for a message a person wrote; this is a
 * rendered notification, and half a kitchen order is worth more than none. The cut is
 * visible in the message so nobody reads a truncated address as a complete one.
 */
const LIMIT = 4096
const CUT = '…'

/** What the Bot API answers with, of the fields that decide anything. */
type BotAnswer = {
  readonly ok?: boolean
  readonly description?: string
  readonly error_code?: number
  readonly parameters?: { readonly retry_after?: number }
}

/**
 * Whether Telegram's refusal is about this address or about this moment.
 *
 * 429 is the rate limit and 5xx is Telegram itself, and both mean "later". Everything
 * else — a chat that does not exist, a bot nobody started, a revoked token — is the
 * same answer however many times it is asked.
 */
const isMomentary = (status: number): boolean => status === 429 || status >= 500

const bodyOf = async (response: Response): Promise<BotAnswer> => {
  try {
    return (await response.json()) as BotAnswer
  } catch {
    return {}
  }
}

export const telegram = (options: TelegramOptions): NotificationChannel => {
  if (options.token.trim() === '') {
    throw new ConfigurationError(
      'The Telegram channel was given an empty bot token. Set TELEGRAM_BOT_TOKEN, or leave the channel out until there is one.',
    )
  }

  const api = (options.api ?? 'https://api.telegram.org').replace(/\/+$/, '')
  const send = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    name: 'telegram',

    async send(address, message) {
      const text =
        message.text.length > LIMIT
          ? `${message.text.slice(0, LIMIT - CUT.length)}${CUT}`
          : message.text

      let response: Response

      try {
        response = await send(`${api}/bot${options.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: address,
            text,
            // A staff channel wants the order, not a preview card of whatever URL the
            // message happens to carry.
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        // A refused connection, a DNS failure, the timeout above. None of them say
        // anything about the address.
        throw unreachable('Telegram could not be reached', {
          reason: cause instanceof Error ? cause.message : String(cause),
        })
      }

      if (response.ok) return

      const answer = await bodyOf(response)
      // Telegram's own text, which names the reason: "chat not found", "bot was
      // blocked by the user", "Unauthorized". It carries no token and no message body.
      const description = answer.description ?? `HTTP ${response.status}`

      if (isMomentary(response.status)) {
        throw unreachable(`Telegram refused for now: ${description}`, {
          status: response.status,
          ...(answer.parameters?.retry_after === undefined
            ? {}
            : { retryAfter: answer.parameters.retry_after }),
        })
      }

      throw rejected(`Telegram refused this chat: ${description}`, { status: response.status })
    },
  }
}
