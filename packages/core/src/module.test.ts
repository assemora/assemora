import { string } from '@assemora/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApplication } from './application.js'
import { command } from './commands.js'
import { token } from './container.js'
import { ConfigurationError } from './errors.js'
import { clearModuleFacets, defineModuleFacet, MODULE, module } from './module.js'
import { permitAll } from './ports.js'

const Rename = command('blog.rename', {
  input: { title: string() },
  handle: async ({ title }) => title,
})

afterEach(() => {
  clearModuleFacets()
})

describe('module builder', () => {
  it('chains and keeps its name', () => {
    const blog = module('blog').commands(Rename).boot(vi.fn())

    expect(blog.name).toBe('blog')
    expect(blog[MODULE].registrations).toHaveLength(1)
    expect(blog[MODULE].hooks.boot).toHaveLength(1)
  })

  it('collects hooks per phase', () => {
    const blog = module('blog').boot(vi.fn()).ready(vi.fn()).ready(vi.fn()).shutdown(vi.fn())

    expect(blog[MODULE].hooks.boot).toHaveLength(1)
    expect(blog[MODULE].hooks.ready).toHaveLength(2)
    expect(blog[MODULE].hooks.shutdown).toHaveLength(1)
  })

  it('registers its commands, providers and listeners with the application', async () => {
    const clock = token<number>('clock')
    const listener = vi.fn()

    const blog = module('blog')
      .commands(Rename)
      .provide(clock, () => 7)
      .on('blog.renamed', listener)

    const app = createApplication({ modules: [blog], authorization: permitAll() })

    expect(app.commands.has('blog.rename')).toBe(true)
    expect(app.registry.find('commands', 'blog.rename')?.module).toBe('blog')
    expect(app.container.get(clock)).toBe(7)

    await app.events.emit('blog.renamed', { title: 'x' })
    expect(listener).toHaveBeenCalledWith({ title: 'x' })
  })
})

describe('facets contributed by packages above core', () => {
  it('adds a builder method that registers through the module', async () => {
    const seen: unknown[] = []

    defineModuleFacet('models', (internals, args) => {
      internals.addRegistration(() => {
        seen.push({ module: internals.name, args })
      })
    })

    // A package that defines a facet also augments the ModuleBuilder interface; the
    // cast stands in for that augmentation inside this test.
    const blog = module('blog') as ReturnType<typeof module> & {
      models(...names: string[]): ReturnType<typeof module>
    }

    createApplication({ modules: [blog.models('Post', 'Category')] })

    expect(seen).toEqual([{ module: 'blog', args: ['Post', 'Category'] }])
  })

  it('refuses to define the same facet twice', () => {
    defineModuleFacet('models', () => {})

    expect(() => defineModuleFacet('models', () => {})).toThrowError(ConfigurationError)
  })

  it('refuses a registration that is asynchronous', () => {
    defineModuleFacet('lateModels', (internals) => {
      internals.addRegistration(async () => {
        await Promise.resolve()
      })
    })

    const blog = module('blog') as ReturnType<typeof module> & {
      lateModels(): ReturnType<typeof module>
    }

    // Registration must stay synchronous so introspection sees a complete picture
    // the moment the application exists; asynchronous setup belongs in boot().
    expect(() => createApplication({ modules: [blog.lateModels()] })).toThrowError(
      'registered asynchronously',
    )
  })

  it('leaves the core methods alone', () => {
    defineModuleFacet('resources', () => {})

    const blog = module('blog')

    expect(typeof blog.commands).toBe('function')
    expect(Object.keys(blog)).not.toContain('resources')
  })
})
