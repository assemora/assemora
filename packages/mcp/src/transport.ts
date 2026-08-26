/**
 * Delivering one JSON-RPC message and waiting for its answer (SPEC.md §68).
 *
 * The SDK ships HTTP transports of its own, and they bring express or hono with
 * them. This project has one owning package for an HTTP server, and it is
 * `@assemora/http` — so the protocol stays the SDK's and the delivery stays ours.
 * A transport is four methods and a callback, which is a small thing to own in
 * exchange for not running a second web server (ADR-0020).
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

type Pending = (reply: JSONRPCMessage) => void

/** A request without an id is a notification: it is answered by not answering. */
const idOf = (message: unknown): string | number | undefined =>
  (message as { id?: string | number }).id

class DirectTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void

  private readonly waiting = new Map<string | number, Pending>()

  start(): Promise<void> {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage): Promise<void> {
    const id = idOf(message)

    if (id !== undefined) {
      this.waiting.get(id)?.(message)
      this.waiting.delete(id)
    }

    return Promise.resolve()
  }

  close(): Promise<void> {
    this.onclose?.()

    return Promise.resolve()
  }

  /** Hands a message to the server, and resolves with the reply it produces. */
  deliver(message: JSONRPCMessage): Promise<JSONRPCMessage | undefined> {
    const id = idOf(message)

    if (id === undefined) {
      this.onmessage?.(message)

      return Promise.resolve(undefined)
    }

    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      this.onmessage?.(message)
    })
  }
}

export type McpEndpoint = {
  /** Answers one JSON-RPC message. `undefined` for a notification. */
  handle(message: unknown): Promise<unknown>
  close(): Promise<void>
}

/**
 * Connects a server to a transport that carries messages straight in.
 *
 * One endpoint serves many requests: the server is stateful — it remembers the
 * initialization handshake — and replies are matched to requests by their id.
 */
export const connectDirectly = async (server: Server): Promise<McpEndpoint> => {
  const transport = new DirectTransport()

  await server.connect(transport)

  return {
    handle: (message) => transport.deliver(message as JSONRPCMessage),
    close: () => server.close(),
  }
}
