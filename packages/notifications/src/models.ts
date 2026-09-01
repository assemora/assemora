/**
 * Who is told, and what was told to them (SPEC.md §81).
 *
 * Two tables and no more. A recipient is an address somebody put in Studio; a
 * delivery is one attempt to reach one address with one message, kept whether it
 * worked or not — a notification that quietly did not arrive is the failure mode of
 * every notification system, and a row that says `failed` with the channel's own
 * words in it is the whole difference between "the kitchen was not told" and "nobody
 * knows whether the kitchen was told".
 */
import {
  boolean,
  enumOf,
  integer,
  json,
  model,
  string,
  text,
  timestamp,
  uuid,
} from '@assemora/data'

/** What a delivery can be. `pending` is a row nobody has tried to send yet. */
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const NotificationRecipient = model('assemora_notification_recipients', {
  id: uuid().primary().defaultRandom(),
  /** What a person calls this address: "Kitchen", "Ada's phone". */
  label: string(),
  /** The channel's own name, as the driver registered it. */
  channel: string(),
  /** A Telegram chat id today; an address, a number or a URL when a channel grows. */
  address: string(),
  /**
   * The topics this recipient asked for. Empty means all of them.
   *
   * Empty-is-everything because the first recipient anybody adds is the staff chat
   * that wants the lot, and making them tick every box would mean a new topic is one
   * nobody is told about until somebody remembers to go back and tick it.
   */
  topics: json<string[]>().default([]),
  /**
   * Off rather than deleted, so a chat can be silenced for an evening without losing
   * what it is and which topics it had.
   */
  active: boolean().default(true),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const NotificationDelivery = model('assemora_notification_deliveries', {
  id: uuid().primary().defaultRandom(),
  topic: string().index(),
  channel: string(),
  address: string(),
  /**
   * Null when the recipient row has been deleted since. The delivery is history and
   * outlives the address book.
   */
  recipientId: uuid().nullable(),
  /** What was rendered, so the log shows what was actually said, not what it would say now. */
  body: text(),
  status: enumOf(...DELIVERY_STATUSES)
    .default('pending')
    .index(),
  attempts: integer().default(0),
  /** The channel's refusal, in its own words. Null while nothing has gone wrong. */
  error: text().nullable(),
  sentAt: timestamp().nullable(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const notificationModels = [NotificationRecipient, NotificationDelivery] as const
