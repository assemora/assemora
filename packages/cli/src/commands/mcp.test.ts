/**
 * `assemora mcp` (SPEC.md §68, §76).
 *
 * The session is typed into a `PassThrough` and read back out of a sink, so every claim
 * below is about bytes rather than about intent. The endpoint is a stand-in: what this
 * file is responsible for is the transport — framing, the credential, and what happens
 * to a session when one message is bad — and none of that is the protocol's business.
 *
 * The protocol itself is `@assemora/mcp`'s, and it is tested there and end to end over
 * the real endpoint in `tests/integration/`.
 */
import { PassThrough, Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { captureOutput } from '../output.js'
import type { McpEndpoint } from '../project.js'
import { serveMcp } from './mcp.js'

const sink = (): { readonly stream: Writable; readonly lines: () => string[] } => {
  const chunks: string[] = []

  return {
    stream: new Writable({
      write(chunk: unknown, _encoding, done) {
        chunks.push(String(chunk))
        done()
      },
    }),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== ''),
  }
}

/** Drives a whole session: writes the lines, closes the input, reads what came back. */
const speak = async (
  endpoint: McpEndpoint,
  lines: readonly string[],
  token = 'agt_test',
): Promise<string[]> => {
  const input = new PassThrough()
  const output = sink()
  const captured = captureOutput()

  const served = serveMcp(endpoint, token, { input, output: output.stream })

  for (const line of lines) input.write(`${line}\n`)
  input.end()

  await served
  captured.restore()

  return output.lines()
}

const answering = (answer: unknown): McpEndpoint => ({
  handle: async () => answer,
})

describe('serving MCP over a pipe', () => {
  it('answers one message per line', async () => {
    const written = await speak(answering({ jsonrpc: '2.0', id: 1, result: {} }), [
      '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    ])

    expect(written).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}'])
  })

  it('hands the endpoint the token, because a pipe carries no headers', async () => {
    const seen: { token?: string } = {}
    const endpoint: McpEndpoint = {
      handle: async (_message, credential) => {
        seen.token = credential.token

        return { jsonrpc: '2.0', id: 1, result: {} }
      },
    }

    await speak(endpoint, ['{"jsonrpc":"2.0","id":1,"method":"ping"}'], 'agt_secret')

    expect(seen.token).toBe('agt_secret')
  })

  it('writes nothing for a notification', async () => {
    // JSON-RPC answers a notification by not answering, and a blank line here is a
    // reply a client never asked for and will try to match against a request.
    const written = await speak(answering(undefined), [
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    ])

    expect(written).toEqual([])
  })

  it('ignores a blank line rather than calling the endpoint with nothing', async () => {
    let calls = 0
    const endpoint: McpEndpoint = {
      handle: async () => {
        calls += 1

        return undefined
      },
    }

    await speak(endpoint, ['', '   '])

    expect(calls).toBe(0)
  })

  it('answers a line that is not JSON, and keeps the session', async () => {
    // A transport that dies on one bad line takes the whole session with it. The client
    // that sent it is owed an answer rather than a closed pipe.
    const written = await speak(answering({ jsonrpc: '2.0', id: 2, result: 'still here' }), [
      'not json at all',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',
    ])

    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ error: { code: -32_700 } })
    expect(written).toHaveLength(2)
    expect(written[1]).toContain('still here')
  })

  it('turns a thrown refusal into an error addressed to the message that caused it', async () => {
    const endpoint: McpEndpoint = {
      handle: async () => {
        throw new Error('This endpoint needs an agent token')
      },
    }

    const written = await speak(endpoint, ['{"jsonrpc":"2.0","id":7,"method":"tools/list"}'])

    expect(JSON.parse(written[0] ?? '{}')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32_603, message: 'This endpoint needs an agent token' },
    })
  })

  it('keeps answering after one message was refused', async () => {
    let asked = 0
    const endpoint: McpEndpoint = {
      handle: async () => {
        asked += 1

        if (asked === 1) throw new Error('no')

        return { jsonrpc: '2.0', id: 2, result: 'second' }
      },
    }

    const written = await speak(endpoint, [
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',
    ])

    expect(written).toHaveLength(2)
    expect(written[1]).toContain('second')
  })

  it('answers in the order the messages arrived', async () => {
    // One process talking to one process: answering out of order would buy nothing and
    // would put two writes to one pipe in the hands of whichever handler finished first.
    const endpoint: McpEndpoint = {
      handle: async (message) => {
        const id = (message as { id: number }).id

        // The first is slower on purpose, which is what would reorder them.
        await new Promise((resolve) => setTimeout(resolve, id === 1 ? 20 : 0))

        return { jsonrpc: '2.0', id, result: {} }
      },
    }

    const written = await speak(endpoint, [
      '{"jsonrpc":"2.0","id":1,"method":"ping"}',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',
    ])

    expect(written.map((line) => (JSON.parse(line) as { id: number }).id)).toEqual([1, 2])
  })
})
