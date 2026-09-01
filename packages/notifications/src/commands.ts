/**
 * Announcing, and recording what came of it (SPEC.md §14, §81).
 *
 * Two commands, because two things happen at two different times. `notifications.send`
 * decides who is to be told and writes one pending row per address — all inside the
 * transaction of whoever is sending, so an order that rolls back tells nobody.
 * `notifications.record` writes down what the channel answered, minutes later and in
 * the job that did the sending.
 *
 * Both are commands and not internal writes, so they are validated, authorized and
 * audited like everything else (SPEC.md §14). Neither of them is granted to anybody
 * here: authorization denies by default, and who may announce is the application's
 * decision, not this package's. A package that registered a policy for its own
 * subject would be an installed dependency handing out permissions nobody granted.
 * An application that announces from a job writes it once:
 *
 * ```ts
 * export const notificationPolicy = policy('notifications', {
 *   // The site announces its own events; a request never does.
 *   send: ({ context }) => context.source === 'job',
 *   record: ({ context }) => context.source === 'job',
 * })
 * ```
 */
import { command, NotFoundError, ValidationError } from '@assemora/core'
import { enumOf, string, unknown as unknownSchema, uuid } from '@assemora/schema'

import { channelNamed } from './channel.js'
import { DeliverNotification } from './jobs.js'
import { NotificationDelivery, NotificationRecipient } from './models.js'
import { notificationFor, notificationTopics, renderMessage } from './notification.js'

/**
 * How much of a channel's refusal is kept.
 *
 * Enough to name the reason, and not so much that a driver quoting the request back
 * fills the column. It is read in a list.
 */
const REASON_LIMIT = 500

const shorten = (reason: string): string =>
  reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT - 1)}…` : reason

/** Whether a recipient asked for this topic. No topics ticked means all of them. */
const wants = (topics: readonly string[], topic: string): boolean =>
  topics.length === 0 || topics.includes(topic)

export const SendNotification = command('notifications.send', {
  description:
    'Announces a declared topic to every active recipient subscribed to it. The payload is validated against the topic',
  input: { topic: string(), payload: unknownSchema() },
  handle: async ({ topic, payload }, context) => {
    const definition = notificationFor(topic)

    if (definition === undefined) {
      // A refusal a caller can act on: the topics are declared, so the list of what
      // they could have meant is known and short.
      throw new ValidationError(
        [
          {
            path: ['topic'],
            code: 'unknown_topic',
            message: `"${topic}" is not a declared notification. Declared: ${notificationTopics().join(', ') || 'none'}`,
            params: { topic, declared: notificationTopics() },
          },
        ],
        `"${topic}" is not a declared notification`,
      )
    }

    const parsed = definition.input.parse(payload)

    if (!parsed.ok) {
      throw new ValidationError(parsed.issues, `"${topic}" was sent a payload it cannot accept`)
    }

    // Once, not once per recipient: the message is a function of the payload, and two
    // people reading different text for one event is a support call nobody can answer.
    const message = renderMessage(definition, parsed.value)
    const subscribed = (await NotificationRecipient.where('active', true).get()).filter(
      (recipient) => wants(recipient.topics, topic),
    )

    const deliveries = []

    for (const recipient of subscribed) {
      const configured = channelNamed(recipient.channel) !== undefined
      const delivery = await NotificationDelivery.create({
        topic,
        channel: recipient.channel,
        address: recipient.address,
        recipientId: recipient.id,
        body: message.text,
        // A recipient pointing at a driver this process was not given is a
        // misconfiguration, and it is written down as a failed delivery rather than
        // skipped: the log is where somebody looks when the kitchen says nothing
        // arrived, and a row that is not there answers nothing.
        ...(configured
          ? {}
          : {
              status: 'failed' as const,
              error: `No channel named "${recipient.channel}" is configured`,
            }),
      })

      if (configured) context.dispatch(DeliverNotification({ deliveryId: delivery.id }))

      deliveries.push({
        id: delivery.id,
        channel: delivery.channel,
        address: delivery.address,
        status: delivery.status,
      })
    }

    if (deliveries.length === 0) {
      // Not a failure. A site with nobody in its address book is the ordinary state of
      // a site the day before somebody adds the staff chat, and the sending code has
      // no way to know that and nothing to do about it.
      context.logger.info('A notification reached nobody', { topic })
    }

    return { topic, deliveries }
  },
})

export const RecordDelivery = command('notifications.record', {
  description: 'Writes down what a channel answered for one delivery',
  input: {
    deliveryId: uuid(),
    outcome: enumOf('sent', 'failed'),
    error: string().optional(),
  },
  handle: async ({ deliveryId, outcome, error }) => {
    const delivery = await NotificationDelivery.find(deliveryId)

    if (delivery === null) throw new NotFoundError('That delivery does not exist')

    await delivery.update({
      status: outcome,
      attempts: delivery.attempts + 1,
      error: error === undefined ? null : shorten(error),
      sentAt: outcome === 'sent' ? new Date() : delivery.sentAt,
    })

    return { id: delivery.id, status: delivery.status, attempts: delivery.attempts }
  },
})

export const notificationCommands = [SendNotification, RecordDelivery] as const
