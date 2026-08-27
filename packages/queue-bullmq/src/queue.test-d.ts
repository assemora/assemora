import type { QueuedJob, QueuePort } from '@assemora/core'
import { describe, expectTypeOf, it } from 'vitest'

import { decodeJob } from './envelope.js'
import { type BullQueue, bullQueue, type QueueWorker } from './queue.js'

const queue = bullQueue({ connection: { url: 'redis://127.0.0.1:6379' } })

describe('the adapter satisfies the port core declares', () => {
  it('is a QueuePort, so createApplication({ queue }) takes it', () => {
    expectTypeOf(queue).toExtend<QueuePort>()
    expectTypeOf<BullQueue>().toExtend<QueuePort>()
  })

  it('decodes a queue payload into exactly the envelope core defined', () => {
    expectTypeOf(decodeJob({})).toEqualTypeOf<QueuedJob>()
  })

  it('hands back a handle whose only power is stopping', () => {
    expectTypeOf(queue.work()).resolves.toEqualTypeOf<QueueWorker>()
    expectTypeOf<QueueWorker>().toEqualTypeOf<{ stop(): Promise<void> }>()
  })
})

describe('invalid configuration does not compile', () => {
  it('needs somewhere to connect', () => {
    // @ts-expect-error a queue with no connection is not a queue
    bullQueue({})
  })

  it('refuses a connection field it does not understand', () => {
    // @ts-expect-error `sentinel` is not part of the connection this adapter takes
    bullQueue({ connection: { url: 'redis://127.0.0.1:6379', sentinel: true } })
  })

  it('refuses an option of the wrong type', () => {
    // @ts-expect-error the queue's name is a string
    bullQueue({ connection: {}, queue: 42 })
  })

  it('refuses concurrency that is not a number', () => {
    // @ts-expect-error concurrency counts jobs
    void queue.work({ concurrency: 'many' })
  })

  it('refuses a reclaim window that is not milliseconds', () => {
    // @ts-expect-error the lever on redelivery is a number of milliseconds
    void queue.work({ reclaimAfterMs: '30 seconds' })
  })

  it('refuses a worker option BullMQ has and this adapter does not expose', () => {
    // @ts-expect-error `lockDuration` is BullMQ's name for it, and BullMQ is not the API
    void queue.work({ lockDuration: 30_000 })
  })

  it('keeps the port narrow: a worker cannot be started through it', () => {
    const port: QueuePort = queue

    // @ts-expect-error `work` is the adapter's, not the port's — core never pulls
    void port.work
  })
})
