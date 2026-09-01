/**
 * `@assemora/notifications` — what an application announces, to whom, over what
 * (SPEC.md §81).
 *
 * §81 lists notifications among the side effects an event exists for and stops there.
 * This is the contract behind that word: a topic is declared like a command, a
 * recipient is a row somebody adds in Studio, a delivery is a record of one attempt,
 * and a channel is a driver — the same three-part shape storage and queues already
 * have. Nothing here knows what Telegram is except `telegram.ts`.
 *
 * ```ts
 * export const OrderPlaced = notification('orders.placed', {
 *   input: { code: string(), total: integer() },
 *   render: (order) => `Order ${order.code} — ${order.total}`,
 * })
 *
 * // inside a job, once the order is really an order:
 * await context.commands.execute('notifications.send', {
 *   topic: 'orders.placed',
 *   payload: { code: order.code, total: order.total },
 * })
 * ```
 *
 * Who may send is the application's decision: authorization denies by default and
 * this package registers no policy of its own — see `commands.ts` for the four lines
 * an application writes.
 */

export {
  channelNamed,
  channelNames,
  clearChannels,
  isRejection,
  NOTIFICATION_REJECTED,
  NOTIFICATION_UNREACHABLE,
  type NotificationChannel,
  type NotificationMessage,
  rejected,
  unreachable,
  useChannels,
} from './channel.js'
export { notificationCommands, RecordDelivery, SendNotification } from './commands.js'
export { DeliverNotification, notificationJobs } from './jobs.js'
export {
  DELIVERY_STATUSES,
  type DeliveryStatus,
  NotificationDelivery,
  NotificationRecipient,
  notificationModels,
} from './models.js'
export { type NotificationsOptions, notifications } from './module.js'
export {
  type AnyNotification,
  clearNotifications,
  type NotificationDefinition,
  type NotificationDescriptor,
  notification,
  notificationFor,
  notificationTopics,
  renderMessage,
  useNotifications,
} from './notification.js'
export {
  DELIVERIES,
  type NotificationResourceOptions,
  notificationResources,
  RECIPIENTS,
} from './resources.js'
export { type TelegramOptions, telegram } from './telegram.js'
