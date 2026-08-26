import { describe, expect, it, vi } from 'vitest'

import { createEventBus } from './events.js'
import { createLogger, type LogRecord } from './logger.js'

const busWithLog = () => {
  const records: LogRecord[] = []
  const bus = createEventBus(createLogger((record) => records.push(record)))
  return { bus, records }
}

describe('event bus', () => {
  it('delivers a payload to every listener', async () => {
    const { bus } = busWithLog()
    const first = vi.fn()
    const second = vi.fn()

    bus.on('page.published', first)
    bus.on('page.published', second)
    await bus.emit('page.published', { pageId: 'p-1' })

    expect(first).toHaveBeenCalledWith({ pageId: 'p-1' })
    expect(second).toHaveBeenCalledWith({ pageId: 'p-1' })
  })

  it('awaits asynchronous listeners', async () => {
    const { bus } = busWithLog()
    let finished = false

    bus.on('page.published', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      finished = true
    })

    await bus.emit('page.published', {})

    expect(finished).toBe(true)
  })

  it('stops delivering after unsubscribe', async () => {
    const { bus } = busWithLog()
    const listener = vi.fn()

    const unsubscribe = bus.on('page.published', listener)
    unsubscribe()
    await bus.emit('page.published', {})

    expect(listener).not.toHaveBeenCalled()
    expect(bus.listenerCount('page.published')).toBe(0)
  })

  it('ignores an event nobody listens to', async () => {
    const { bus } = busWithLog()

    await expect(bus.emit('nobody.cares', {})).resolves.toBeUndefined()
  })

  it('reports a failing listener instead of failing the caller', async () => {
    const { bus, records } = busWithLog()
    const healthy = vi.fn()

    bus.on('page.published', () => {
      throw new Error('indexing is down')
    })
    bus.on('page.published', healthy)

    await expect(bus.emit('page.published', {})).resolves.toBeUndefined()
    expect(healthy).toHaveBeenCalled()
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'Event listener failed',
        event: 'page.published',
        reason: 'indexing is down',
      }),
    )
  })
})
