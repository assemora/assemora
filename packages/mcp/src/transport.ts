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

/**
 * Whether this is an answer to something rather than a fresh request.
 *
 * A response carries `result` or `error`; a request carries `method`. The server is
 * built with `{ tools: {} }` and asks nothing of its own today, but it numbers any
 * outbound request from a counter of its own — and a counter of its own is exactly
 * what could otherwise be mistaken for one of the tickets below.
 */
const isReply = (message: JSONRPCMessage): boolean => 'result' in message || 'error' in message

class DirectTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void

  /**
   * Who is waiting, by the id *this* transport issued — never by the id the caller
   * sent.
   *
   * One endpoint serves every request the process answers, so two callers routinely
   * hold messages numbered the same: JSON-RPC ids are the client's to choose, every
   * client starts at 1, and nothing coordinates between them. Keyed by the caller's
   * id, the second `deliver` overwrote the first one's entry — so the first caller
   * waited for a reply that would never be delivered to it, and the second was handed
   * an answer computed for somebody else, along with whatever it contained. That is a
   * leak between actors rather than a mix-up: an MCP call is authorized as the agent
   * that made it, and the reply is the data that authorization decided on.
   *
   * So the caller's id never reaches the server. It is swapped for a ticket only this
   * transport issues, and put back on the way out, which also fixes the same defect
   * within one caller: an agent with two calls in flight is as entitled to reuse an
   * id as two agents are.
   */
  private readonly waiting = new Map<number, Pending>()

  /** The next ticket. Monotonic, so no two in-flight requests can share one. */
  private ticket = 0

  start(): Promise<void> {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage): Promise<void> {
    const id = idOf(message)

    if (typeof id === 'number' && isReply(message)) {
      const settle = this.waiting.get(id)

      if (settle !== undefined) {
        this.waiting.delete(id)
        settle(message)
      }
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

    const ticket = this.ticket
    this.ticket += 1

    return new Promise((resolve) => {
      // The answer is the server's, addressed back to the id the caller used: a client
      // matches replies to its own requests, and a ticket would match nothing it sent.
      this.waiting.set(ticket, (reply) => resolve({ ...reply, id }))
      this.onmessage?.({ ...message, id: ticket })
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
 * initialization handshake — and a reply is matched to its request by a ticket this
 * transport issues, never by the id the caller chose. Two callers routinely choose
 * the same one.
 */
export const connectDirectly = async (server: Server): Promise<McpEndpoint> => {
  const transport = new DirectTransport()

  await server.connect(transport)

  return {
    handle: (message) => transport.deliver(message as JSONRPCMessage),
    close: () => server.close(),
  }
}
