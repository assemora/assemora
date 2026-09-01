/**
 * The Telegram driver (SPEC.md §81).
 *
 * What matters here is what the driver *does not* do: it sends no parse mode, so a
 * customer's name is characters rather than markup, and it tells a refusal about the
 * address apart from a refusal about the minute — the difference between a queue
 * giving up and a queue trying again.
 */
import { ConfigurationError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { NOTIFICATION_REJECTED, NOTIFICATION_UNREACHABLE } from './channel.js'
import { telegram } from './telegram.js'

const TOKEN = '123456:AAHfake-token'

type Call = { readonly url: string; readonly body: Record<string, unknown> }

/** A `fetch` that records the request and answers what the test says. */
const stub = (answer: () => Response | Promise<Response>, calls: Call[] = []) => {
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })

    return answer()
  }) as unknown as typeof globalThis.fetch

  return { fetch, calls }
}

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

const refusal = (status: number, description: string) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description }), { status })

const codeOf = async (send: Promise<unknown>): Promise<string> => {
  try {
    await send

    return 'no error'
  } catch (error) {
    return (error as { code: string }).code
  }
}

describe('the Telegram channel', () => {
  it('posts the chat id and the text, and no parse mode', async () => {
    const { fetch, calls } = stub(ok)

    await telegram({ token: TOKEN, fetch }).send('-100200', { text: 'Order A-17 <b>x2</b>' })

    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(calls[0]?.body.chat_id).toBe('-100200')
    // Literally, tags and all: Telegram renders it as text because no parse mode was
    // asked for, which is what keeps a stranger's comment out of a staff channel.
    expect(calls[0]?.body.text).toBe('Order A-17 <b>x2</b>')
    expect(calls[0]?.body).not.toHaveProperty('parse_mode')
  })

  it('cuts a message down to what Telegram accepts rather than losing it', async () => {
    const { fetch, calls } = stub(ok)

    await telegram({ token: TOKEN, fetch }).send('-100200', { text: 'x'.repeat(5000) })

    const text = String(calls[0]?.body.text)

    expect(text).toHaveLength(4096)
    expect(text.endsWith('…')).toBe(true)
  })

  it('calls a chat that does not exist a rejection, which is nobody trying again', async () => {
    const { fetch } = stub(() => refusal(400, 'Bad Request: chat not found'))

    expect(await codeOf(telegram({ token: TOKEN, fetch }).send('-1', { text: 'hello' }))).toBe(
      NOTIFICATION_REJECTED,
    )
  })

  it('calls a rate limit and a Telegram outage unreachable, which is worth retrying', async () => {
    const limited = stub(() => refusal(429, 'Too Many Requests'))
    const down = stub(() => refusal(502, 'Bad Gateway'))

    expect(
      await codeOf(telegram({ token: TOKEN, fetch: limited.fetch }).send('-1', { text: 'hello' })),
    ).toBe(NOTIFICATION_UNREACHABLE)
    expect(
      await codeOf(telegram({ token: TOKEN, fetch: down.fetch }).send('-1', { text: 'hello' })),
    ).toBe(NOTIFICATION_UNREACHABLE)
  })

  it('calls a network that never answered unreachable too', async () => {
    const { fetch } = stub(() => {
      throw new Error('ECONNREFUSED')
    })

    expect(await codeOf(telegram({ token: TOKEN, fetch }).send('-1', { text: 'hello' }))).toBe(
      NOTIFICATION_UNREACHABLE,
    )
  })

  it('refuses an empty token where it was configured, not at the first order', () => {
    expect(() => telegram({ token: '  ' })).toThrow(ConfigurationError)
  })
})
