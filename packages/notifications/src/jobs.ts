/**
 * The sending itself (SPEC.md §82).
 *
 * One job per delivery, dispatched by `notifications.send` and handed to the queue
 * only once the outermost transaction commits (ADR-0023) — so a rollback tells nobody,
 * and the network call happens after the request that caused it has answered.
 *
 * The handler sends and then executes a command to write down what happened, rather
 * than writing the row itself: a job is not a mutation, and the rows it changes go
 * through the Command Bus like every other row (SPEC.md §14). It executes it by name
 * so that this file does not import the file that dispatches this job.
 */
import { job } from '@assemora/core'
import { uuid } from '@assemora/schema'

import { channelNamed, isRejection } from './channel.js'
import { NotificationDelivery } from './models.js'

export const DeliverNotification = job('notifications.deliver', {
  description: 'Sends one notification over its channel and records what came back',
  input: { deliveryId: uuid() },
  handle: async ({ deliveryId }, context) => {
    const delivery = await NotificationDelivery.find(deliveryId)

    // The row is gone, or somebody has already sent it. A queue delivers at least
    // once, so a worker killed between the send and the record hands this to another
    // worker — and the second one must not send the kitchen a duplicate.
    if (delivery === null || delivery.status === 'sent') return

    const channel = channelNamed(delivery.channel)

    if (channel === undefined) {
      await context.commands.execute('notifications.record', {
        deliveryId,
        outcome: 'failed',
        error: `No channel named "${delivery.channel}" is configured`,
      })

      return
    }

    try {
      await channel.send(delivery.address, { text: delivery.body })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      await context.commands.execute('notifications.record', {
        deliveryId,
        outcome: 'failed',
        error: reason,
      })

      // A rejection is the channel's final answer — a chat that does not exist will
      // not start existing on the third attempt, and a queue retrying it spends the
      // afternoon on a typo. Everything else is a moment that has passed by the time
      // the queue tries again, so it is rethrown and the adapter decides when
      // (ADR-0023).
      if (isRejection(error)) return

      throw error
    }

    await context.commands.execute('notifications.record', { deliveryId, outcome: 'sent' })
  },
})

export const notificationJobs = [DeliverNotification] as const
