/**
 * The `notifications()` module (SPEC.md §13, §81).
 *
 * ```ts
 * assemora({
 *   modules: [
 *     notifications({
 *       channels: [telegram({ token: process.env.TELEGRAM_BOT_TOKEN ?? '' })],
 *       topics: [OrderPlaced],
 *     }),
 *   ],
 * })
 * ```
 *
 * The two lists are configuration and declaration: a channel is a driver this
 * deployment was given, a topic is something this application can announce. Both are
 * passed rather than discovered by import, for the reason `pages({ blocks })` takes
 * its blocks that way — a registration that happens at import time is in the
 * application whether the module was switched on or not.
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { type NotificationChannel, useChannels } from './channel.js'
import { notificationCommands } from './commands.js'
import { notificationJobs } from './jobs.js'
import { notificationModels } from './models.js'
import { type AnyNotification, useNotifications } from './notification.js'
import { notificationResources } from './resources.js'

export type NotificationsOptions = {
  /** The drivers this deployment can send over. None means nothing can be delivered. */
  readonly channels?: readonly NotificationChannel[]
  /** What this application can announce, declared with `notification()`. */
  readonly topics?: readonly AnyNotification[]
}

export const notifications = (options: NotificationsOptions = {}): ModuleBuilder => {
  const channels = options.channels ?? []
  const topics = options.topics ?? []
  const { recipients, deliveries } = notificationResources({
    channels: channels.map((channel) => channel.name),
    topics: topics.map((topic) => topic.topic),
  })

  return module('notifications')
    .models(...notificationModels)
    .resources(recipients, deliveries)
    .commands(...notificationCommands)
    .jobs(...notificationJobs)
    .boot((context) => {
      useChannels(channels)
      useNotifications(topics)

      for (const topic of topics) {
        context.registry.register('notifications', {
          name: topic.topic,
          ...(topic.description === undefined ? {} : { description: topic.description }),
          input: topic.input.toJsonSchema(),
          module: context.module,
        })
      }

      // Said rather than refused. An application configured with no channel still
      // boots, still shows the address book and still records what it would have
      // sent — which is what a project looks like the week before somebody creates
      // the bot. Silence here is how it stays that way for a month.
      if (channels.length === 0) {
        context.logger.warn(
          'The notifications module has no channel, so nothing can be delivered. Pass channels: [telegram({ token })].',
        )
      }

      if (topics.length === 0) {
        context.logger.warn(
          'The notifications module declares no topics, so there is nothing to announce. Pass topics: [ ... ] built with notification().',
        )
      }
    })
}
