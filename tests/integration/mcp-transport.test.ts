/**
 * The MCP endpoint, spoken to by the client that will actually speak to it.
 *
 * Every other test of this endpoint hands it a JSON-RPC message and reads the answer,
 * which proves the protocol and says nothing about the transport. What broke here was
 * entirely transport: a `GET` on the endpoint answered 404 because nothing routed that
 * verb, and the specification says a server with no stream to offer must answer 405.
 * The SDK's own client opens that `GET` the moment the handshake finishes and raises
 * anything but 405 as a failure — so every session died a moment after connecting, and
 * no test that posted messages by hand could see it.
 *
 * Hence the real client. `@modelcontextprotocol/sdk` is a dependency of this package
 * and of no other outside `@assemora/mcp`, which owns it: the rule that an
 * implementation library has one owning package is about what ships, and this package
 * ships nothing. Being the client is the whole point of the test.
 */

import { auth, createAgent } from '@assemora/auth'
import { createMemoryAdapter } from '@assemora/database'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type AssemoraApplication, assemora } from 'assemora'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: AssemoraApplication
let address: string
let token: string

/** Everything the transport reported as a failure, whether or not it also threw. */
const complaints: string[] = []

/**
 * Long enough for a failure that arrives after `connect()` has resolved.
 *
 * The client opens its stream in the background and reports what happens through
 * `onerror` — `.catch(error => this.onerror?.(error))`, with nobody awaiting it. So a
 * test that inspects the complaints the instant `connect()` returns inspects them
 * before the stream has had its answer, and passes whatever the server said. This one
 * did, against a 404, until it was made to wait.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 250))

const connected = async (): Promise<Client> => {
  const client = new Client({ name: 'transport-test', version: '1.0.0' })

  client.onerror = (error: Error) => {
    complaints.push(error.message)
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${address}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })

  // The SDK's own transport does not satisfy the SDK's own `Transport` under
  // `exactOptionalPropertyTypes`: its optional members are declared without
  // `| undefined`. That is a fact about a published type declaration, not about this
  // code, and the flag is not weakened for it (docs/rules/testing.md).
  await client.connect(transport as never)

  return client
}

beforeAll(async () => {
  app = assemora({
    database: createMemoryAdapter(),
    modules: [auth()],
    project: { name: 'transport-test', version: '0.0.0' },
    mcp: true,
    // An agent proposes and a person applies, and neither happens here — what is under
    // test is whether a client can hold a session at all.
    changeSets: true,
  })

  address = await app.listen(0)

  token = (
    await app.app.run({ source: 'cli' }, () =>
      createAgent({ name: 'transport-agent', permissions: ['assemora.*'] }),
    )
  ).token
}, 60_000)

afterAll(async () => {
  await app.shutdown()
}, 30_000)

describe('the endpoint an MCP client connects to (SPEC.md §68)', () => {
  it('refuses the server-to-client stream with 405, not 404', async () => {
    // Asserted directly as well as through the client, so that when the client test
    // fails this one says why in a line rather than in a stack.
    const answered = await fetch(`${address}/api/mcp`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    })

    expect(answered.status).toBe(405)
  })

  it('refuses session termination the same way, rather than pretending to be absent', async () => {
    const answered = await fetch(`${address}/api/mcp`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(answered.status).toBe(405)
  })

  it('lets a real client complete the handshake and stay connected', async () => {
    const client = await connected()

    expect(client.getServerVersion()).toMatchObject({ name: 'transport-test' })

    await settled()

    // The point of the whole file: the client opens its stream after the handshake and
    // must find the refusal acceptable. Anything else lands here.
    expect(complaints).toEqual([])

    await client.close()
  })

  it('answers that client the tools this project generates', async () => {
    const client = await connected()
    const listed = await client.listTools()

    expect(listed.tools.map((tool) => tool.name)).toContain('assemora.describe')

    await client.close()
  })

  it('runs a tool for it, past every check a tool call passes', async () => {
    const client = await connected()
    const called = (await client.callTool({ name: 'assemora.describe', arguments: {} })) as {
      content: { text: string }[]
    }

    const described = JSON.parse(called.content[0]?.text ?? '{}') as {
      project?: { name?: string }
    }

    expect(described.project?.name).toBe('transport-test')

    await client.close()
  })

  it('says which version the session settled on', async () => {
    // Read off the handshake rather than declared, so an upgrade of the SDK moves it
    // and nothing here has to be told.
    const answered = await fetch(`${address}/api/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'probe', version: '1' },
        },
      }),
    })

    expect(answered.headers.get('mcp-protocol-version')).toBeTruthy()
  })
})
