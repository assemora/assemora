/**
 * `@assemora/queue-bullmq` — the production queue adapter of SPEC.md §82.
 *
 * BullMQ and ioredis are declared here and nowhere else in the repository (SPEC.md
 * §8, §125.1); `pnpm boundaries` enforces that, and nothing of either library
 * appears in a signature this package exports. Everything above it speaks
 * `QueuePort`, which `@assemora/core` owns (ADR-0023).
 *
 * ```ts
 * const queue = bullQueue({ connection: { url: process.env.REDIS_URL } })
 *
 * const app = createApplication({ queue, modules, authorization })
 * const worker = await queue.work({ concurrency: 4 })
 * ```
 */

export {
  type BullQueue,
  type BullQueueOptions,
  bullQueue,
  type FailedJob,
  type QueueConnection,
  type QueueWorker,
  type WorkOptions,
} from './queue.js'
