import { describe, expect, it } from 'vitest'

import { contextOrInternal, createContext, currentContext, runInContext } from './context.js'

describe('context', () => {
  it('generates a request id when none is given', () => {
    const context = createContext({ source: 'rest' })

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(context.source).toBe('rest')
  })

  it('omits an absent actor rather than storing undefined', () => {
    expect('actor' in createContext({ source: 'cli' })).toBe(false)
    expect(createContext({ source: 'mcp', actor: { type: 'agent', id: 'writer' } }).actor).toEqual({
      type: 'agent',
      id: 'writer',
    })
  })

  it('is invisible outside a run', () => {
    expect(currentContext()).toBeUndefined()
  })

  it('survives awaits inside the operation', async () => {
    const context = createContext({ source: 'studio', requestId: 'req-1' })

    const seen = await runInContext(context, async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 1))
      return currentContext()?.requestId
    })

    expect(seen).toBe('req-1')
    expect(currentContext()).toBeUndefined()
  })

  it('keeps concurrent operations apart', async () => {
    const run = (id: string) =>
      runInContext(createContext({ source: 'rest', requestId: id }), async () => {
        await new Promise((resolve) => setTimeout(resolve, id === 'slow' ? 5 : 1))
        return currentContext()?.requestId
      })

    expect(await Promise.all([run('slow'), run('fast')])).toEqual(['slow', 'fast'])
  })

  it('falls back to an internal context outside a run', () => {
    expect(contextOrInternal().source).toBe('internal')
  })
})
