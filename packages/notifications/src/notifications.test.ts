/**
 * Announcing (SPEC.md §81).
 *
 * Two claims carry this file. The first is that nobody is told by accident: a topic
 * nobody declared, a payload the topic cannot accept, a recipient who is switched off
 * or ticked another box — each of them ends in nothing being sent. The second is that
 * every attempt leaves a row, whichever way it went, because a notification system
 * whose failures are invisible is one nobody can trust with an order.
 */
import {
  type Application,
  createApplication,
  createLogger,
  permitAll,
  type QueuedJob,
  type QueuePort,
  runJob,
  silentWriter,
  ValidationError,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { clearResourceRegistry } from '@assemora/resources'
import { integer, string } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearChannels, type NotificationChannel, rejected, unreachable } from './channel.js'
import { NotificationDelivery } from './models.js'
import { notifications } from './module.js'
import { clearNotifications, notification } from './notification.js'

const KITCHEN = '11111111-1111-4111-8111-111111111111'
const COURIER = '22222222-2222-4222-8222-222222222222'
const OFF = '33333333-3333-4333-8333-333333333333'
const ELSEWHERE = '44444444-4444-4444-8444-444444444444'

const OrderPlaced = notification('orders.placed', {
  description: 'A new order is waiting',
  input: { code: string(), total: integer() },
  // Indented the way a template literal in a source file is, so the trimming is real.
  render: (order) => `
    Order ${order.code} — ${order.total}
  `,
})

const NightlyReport = notification('reports.nightly', {
  input: {},
  render: () => 'Yesterday, in one line',
})

/** What the channel was asked to send, and what it answers. */
let sent: { readonly address: string; readonly text: string }[] = []
let refusal: Error | undefined

const chat = (): NotificationChannel => ({
  name: 'chat',
  send: async (address, message) => {
    sent.push({ address, text: message.text })

    if (refusal !== undefined) throw refusal
  },
})

/** A queue that keeps what it was handed, so a test decides when the job runs. */
const holdingQueue = (): QueuePort & { readonly held: QueuedJob[] } => {
  const held: QueuedJob[] = []

  return {
    held,
    push: (jobs) => {
      held.push(...jobs)

      return Promise.resolve()
    },
  }
}

let app: Application
let queue: ReturnType<typeof holdingQueue>

const build = async ({
  channels = [chat()],
  topics = [OrderPlaced, NightlyReport],
}: {
  readonly channels?: readonly NotificationChannel[]
  readonly topics?: readonly (typeof OrderPlaced | typeof NightlyReport)[]
} = {}) => {
  sent = []
  refusal = undefined
  clearChannels()
  clearNotifications()
  clearResourceRegistry()
  queue = holdingQueue()

  useAdapter(
    createMemoryAdapter({
      assemora_notification_recipients: [
        {
          id: KITCHEN,
          label: 'Kitchen',
          channel: 'chat',
          address: '-100200',
          topics: [],
          active: true,
        },
        {
          id: COURIER,
          label: 'Courier',
          channel: 'chat',
          address: '-100300',
          topics: ['orders.placed'],
          active: true,
        },
        {
          id: OFF,
          label: 'Night shift',
          channel: 'chat',
          address: '-100400',
          topics: [],
          active: false,
        },
        {
          id: ELSEWHERE,
          label: 'Reports only',
          channel: 'chat',
          address: '-100500',
          topics: ['reports.nightly'],
          active: true,
        },
      ],
      assemora_notification_deliveries: [],
    }),
  )

  app = createApplication({
    modules: [notifications({ channels, topics })],
    authorization: permitAll(),
    transactions: dataTransactions(),
    queue,
    logger: createLogger(silentWriter),
  })

  await app.boot()

  return app
}

const send = (payload: unknown = { code: 'A-17', total: 480 }) =>
  app.commands.execute('notifications.send', { topic: 'orders.placed', payload }) as Promise<{
    readonly deliveries: readonly { readonly id: string; readonly status: string }[]
  }>

beforeEach(() => build())

describe('who is told (SPEC.md §81)', () => {
  it('writes one pending delivery per subscribed recipient and queues one job each', async () => {
    const result = await send()

    expect(result.deliveries.map((delivery) => delivery.status)).toEqual(['pending', 'pending'])
    expect(queue.held).toHaveLength(2)
    expect(queue.held.every((job) => job.name === 'notifications.deliver')).toBe(true)
  })

  it('tells a recipient who ticked no topic at all, because that means every topic', async () => {
    const result = await send()
    const addresses = await Promise.all(
      result.deliveries.map(
        async (delivery) => (await NotificationDelivery.find(delivery.id))?.address,
      ),
    )

    expect(addresses).toContain('-100200')
  })

  it('does not tell a recipient who ticked other topics, and does not tell an inactive one', async () => {
    const result = await send()
    const addresses = await Promise.all(
      result.deliveries.map(
        async (delivery) => (await NotificationDelivery.find(delivery.id))?.address,
      ),
    )

    expect(addresses).not.toContain('-100500')
    expect(addresses).not.toContain('-100400')
  })

  it('records a failed delivery, and queues nothing, when the channel is not configured', async () => {
    await build({ channels: [] })

    const result = await send()

    expect(result.deliveries.map((delivery) => delivery.status)).toEqual(['failed', 'failed'])
    expect(queue.held).toHaveLength(0)

    const delivery = await NotificationDelivery.find(result.deliveries[0]?.id ?? '')

    expect(delivery?.error).toContain('No channel named "chat" is configured')
  })

  it('says so rather than failing when the address book is empty', async () => {
    useAdapter(
      createMemoryAdapter({
        assemora_notification_recipients: [],
        assemora_notification_deliveries: [],
      }),
    )

    await expect(send()).resolves.toEqual({ topic: 'orders.placed', deliveries: [] })
  })
})

describe('what is sent', () => {
  it('refuses a topic nobody declared, and names the ones that were', async () => {
    const refused = app.commands.execute('notifications.send', {
      topic: 'orders.burnt',
      payload: {},
    })

    await expect(refused).rejects.toThrow(ValidationError)
    await expect(refused).rejects.toThrow('"orders.burnt" is not a declared notification')

    const thrown = await refused.catch((error: unknown) => error)

    // The refusal says what it could have been, because the topics are declared and
    // the list is therefore known and short.
    expect((thrown as ValidationError).issues[0]?.message).toContain('orders.placed')
  })

  it('refuses a payload the topic cannot accept, before anybody is told', async () => {
    await expect(send({ code: 'A-17' })).rejects.toThrow(ValidationError)
    expect(queue.held).toHaveLength(0)
  })

  it('renders once, and stores the text every recipient will read', async () => {
    const result = await send()
    const bodies = await Promise.all(
      result.deliveries.map(
        async (delivery) => (await NotificationDelivery.find(delivery.id))?.body,
      ),
    )

    // Trimmed: the template literal above is indented by the file it lives in.
    expect(bodies).toEqual(['Order A-17 — 480', 'Order A-17 — 480'])
  })
})

describe('delivery (SPEC.md §82)', () => {
  const first = async () => {
    const result = await send()
    const queued = queue.held[0]

    if (queued === undefined) throw new Error('nothing was queued')

    return { deliveryId: result.deliveries[0]?.id ?? '', queued }
  }

  it('sends over the channel and records that it went', async () => {
    const { deliveryId, queued } = await first()

    await runJob(queued)

    const delivery = await NotificationDelivery.find(deliveryId)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('Order A-17 — 480')
    expect(delivery?.status).toBe('sent')
    expect(delivery?.attempts).toBe(1)
    expect(delivery?.sentAt).not.toBeNull()
  })

  it('records a rejection and does not ask the queue to try again', async () => {
    const { deliveryId, queued } = await first()

    refusal = rejected('Telegram refused this chat: chat not found')

    await expect(runJob(queued)).resolves.toBeUndefined()

    const delivery = await NotificationDelivery.find(deliveryId)

    expect(delivery?.status).toBe('failed')
    expect(delivery?.error).toContain('chat not found')
  })

  it('records an unreachable channel and rethrows, so the queue tries again', async () => {
    const { deliveryId, queued } = await first()

    refusal = unreachable('Telegram could not be reached')

    await expect(runJob(queued)).rejects.toThrow('Telegram could not be reached')

    const delivery = await NotificationDelivery.find(deliveryId)

    expect(delivery?.status).toBe('failed')
    expect(delivery?.attempts).toBe(1)
  })

  it('does not send twice when the same job arrives twice', async () => {
    const { queued } = await first()

    await runJob(queued)
    await runJob(queued)

    expect(sent).toHaveLength(1)
  })
})
