/**
 * What an application can announce (SPEC.md §81).
 *
 * ```ts
 * export const OrderPlaced = notification('orders.placed', {
 *   description: 'A new order is waiting for the kitchen',
 *   input: { code: string(), total: integer(), phone: string() },
 *   render: (order) => `Order ${order.code}\n${order.total} · ${order.phone}`,
 * })
 * ```
 *
 * The fourth member of the family beside `command()`, `query()` and `job()`, and
 * declared the same way: a name, an input schema and a function. The schema is what
 * makes `notifications.send` a typed act rather than a text box — the payload is
 * validated before anybody is told anything, so a topic cannot be sent with a field
 * missing and a chat cannot be reached with arbitrary prose.
 *
 * `render` is a function and therefore lives on the server only. The descriptor a
 * generator reads carries the name, the description and the input schema, which is
 * everything a form or an agent needs to *ask* for a notification, and nothing that
 * would have to survive `JSON.stringify` (ADR-0027).
 */
import type { InferShape, Schema, Shape } from '@assemora/schema'
import { object } from '@assemora/schema'

import type { NotificationMessage } from './channel.js'

export type NotificationDefinition<S extends Shape> = {
  readonly node: 'notification'
  readonly topic: string
  readonly description: string | undefined
  readonly input: Schema<InferShape<S>>
  /** A string is the message; the object form is there for a channel that grows one. */
  render(payload: InferShape<S>): NotificationMessage | string
}

/** A notification of any shape, as the module stores it. */
export type AnyNotification = {
  readonly node: 'notification'
  readonly topic: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  render(payload: never): NotificationMessage | string
}

/** How a topic describes itself in the Schema Registry (ADR-0002). */
export type NotificationDescriptor = {
  readonly name: string
  readonly description?: string
  readonly input: ReturnType<Schema<unknown>['toJsonSchema']>
  readonly module?: string
}

declare module '@assemora/core' {
  interface RegistrySections {
    notifications: NotificationDescriptor
  }
}

export const notification = <S extends Shape>(
  topic: string,
  definition: {
    readonly input: S
    readonly description?: string
    render(payload: InferShape<S>): NotificationMessage | string
  },
): NotificationDefinition<S> => ({
  node: 'notification',
  topic,
  description: definition.description,
  input: object(definition.input),
  render: definition.render,
})

/**
 * The topics this application declared.
 *
 * Filled by `notifications({ topics })` rather than by importing a file, for the
 * reason `pages({ blocks })` takes its blocks that way: a declaration that registers
 * itself at import time is in the application whether the module was switched on or
 * not, and the list is also what the recipient form's checkboxes are built from.
 */
let declared: ReadonlyMap<string, AnyNotification> = new Map()

export const useNotifications = (topics: readonly AnyNotification[]): void => {
  declared = new Map(topics.map((topic) => [topic.topic, topic]))
}

export const notificationTopics = (): readonly string[] => [...declared.keys()]

export const notificationFor = (topic: string): AnyNotification | undefined => declared.get(topic)

export const clearNotifications = (): void => {
  declared = new Map()
}

/**
 * The text a recipient reads, from a payload that has already been validated.
 *
 * Trimmed, because a template literal that spans lines in a source file arrives with
 * the indentation of the file it was written in.
 */
export const renderMessage = (
  definition: AnyNotification,
  payload: unknown,
): NotificationMessage => {
  const rendered = (definition.render as (payload: unknown) => NotificationMessage | string)(
    payload,
  )

  return typeof rendered === 'string' ? { text: rendered.trim() } : { text: rendered.text.trim() }
}
