/**
 * The address book and the log, as Studio sees them (SPEC.md §35, §58).
 *
 * They are resources rather than screens, so the list, the form, the filters, the REST
 * endpoints, the OpenAPI document, the SDK and the MCP tools all follow from these two
 * declarations and nothing is written twice (ADR-0027).
 *
 * Both are built by a function rather than exported as constants, because two of the
 * fields are choices and the choices are configuration: the channels are the drivers
 * this application was given, and the topics are what it declared. A free-text
 * "channel" column is a typo waiting to become a delivery nobody receives.
 */
import {
  checkboxes,
  datetime,
  integer,
  json,
  resource,
  select,
  text,
  textarea,
  toggle,
} from '@assemora/resources'

import { DELIVERY_STATUSES, NotificationDelivery, NotificationRecipient } from './models.js'

export const RECIPIENTS = 'notificationRecipients'
export const DELIVERIES = 'notificationDeliveries'

/** Studio's heading for both of them (SPEC.md §58). */
const GROUP = 'Notifications'

/** A non-empty tuple, or nothing — which is what `select()` and `checkboxes()` need. */
const choices = (values: readonly string[]): readonly [string, ...string[]] | undefined =>
  values.length === 0 ? undefined : (values as unknown as readonly [string, ...string[]])

export type NotificationResourceOptions = {
  readonly channels: readonly string[]
  readonly topics: readonly string[]
}

export const notificationResources = (options: NotificationResourceOptions) => {
  const channels = choices(options.channels)
  const topics = choices(options.topics)

  const recipients = resource(
    NotificationRecipient,
    {
      label: text().required().searchable().sortable().label('Name'),
      // A driver that is not configured cannot deliver, so the form offers the ones
      // that are. With none configured the column is still a column, and a text box
      // is a better answer than a form nobody can submit.
      channel:
        channels === undefined
          ? text().required().label('Channel')
          : select(...channels)
              .required()
              .filterable()
              .label('Channel'),
      address: text().required().label('Address'),
      // Nothing ticked means every topic, which is what the column says and what the
      // hint has to repeat, because an empty box reads as "none" to everybody.
      topics:
        topics === undefined
          ? json<string[]>().label('Topics')
          : checkboxes(...topics).label('Topics'),
      active: toggle().filterable().label('Active'),
    },
    {
      name: RECIPIENTS,
      label: 'Notification recipients',
      group: GROUP,
      icon: 'contact',
      titleField: 'label',
      defaultSort: 'label',
    },
  )

  const deliveries = resource(
    NotificationDelivery,
    {
      topic: text().searchable().filterable().sortable().label('Topic'),
      channel: text().filterable().label('Channel'),
      address: text().searchable().label('Address'),
      status: select(...DELIVERY_STATUSES)
        .filterable()
        .sortable()
        .label('Status'),
      attempts: integer().sortable().label('Attempts'),
      error: textarea().label('Error'),
      body: textarea().label('Message'),
      sentAt: datetime().sortable().label('Sent'),
      createdAt: datetime().sortable().label('Queued'),
    },
    {
      name: DELIVERIES,
      label: 'Notification deliveries',
      group: GROUP,
      icon: 'bell',
      titleField: 'topic',
      defaultSort: '-createdAt',
      perPage: 30,
      // A log is written by the sending and read by everybody else. Editing one would
      // be editing what happened, and creating one would be a delivery nobody sent —
      // the flags are what make that true in Studio, over REST, in the SDK and over
      // MCP at once (SPEC.md §43).
      api: { create: false, update: false, delete: false },
    },
  )

  return { recipients, deliveries }
}
