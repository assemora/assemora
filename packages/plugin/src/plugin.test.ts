import {
  ConfigurationError,
  clearModuleFacets,
  command,
  createApplication,
  defineModuleFacet,
  MODULE,
  type ModuleBuilder,
  module,
  permitAll,
  query,
  token,
} from '@assemora/core'
import { string } from '@assemora/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installedPlugins, type PluginOptions, plugin } from './plugin.js'

/**
 * `.resources()`, `.blocks()`, `.routes()`, `.models()` and `.policies()` are
 * contributed by the packages above core, which this one may depend on none of
 * (SPEC.md §8). Each of them contributes a facet and augments `ModuleBuilder` with its
 * signature (ADR-0009); both halves stand in for them here, so what the tests below
 * exercise is the arrangement a real installation is in.
 */
declare module '@assemora/core' {
  interface ModuleBuilder {
    resources(...resources: unknown[]): ModuleBuilder
    blocks(...blocks: unknown[]): ModuleBuilder
    routes(...routes: unknown[]): ModuleBuilder
    models(...models: unknown[]): ModuleBuilder
    policies(...policies: unknown[]): ModuleBuilder
  }
}

const applied: { facet: string; module: string; args: readonly unknown[] }[] = []

const defineStandInFacets = (): void => {
  for (const facet of ['resources', 'blocks', 'routes', 'models', 'policies']) {
    defineModuleFacet(facet, (internals, args) => {
      internals.addRegistration(() => {
        applied.push({ facet, module: internals.name, args })
      })
    })
  }
}

const seoPlugin = (options?: PluginOptions): ModuleBuilder => plugin('seo', options)

const SeoSettings = { name: 'seoSettings' }
const FaqBlock = { node: 'block', type: 'faq' }
const sitemap = { node: 'route', method: 'get', path: '/sitemap.xml' }
const SeoMeta = { table: 'seo_meta' }

/**
 * A policy is `{ node, subject, rules }` (`packages/auth/src/policies.ts`) — no
 * `name`, no `type`, no `table`. It is the facet that proves a declaration this
 * package cannot label must not be reported as nothing.
 */
const SeoPolicy = { node: 'policy', subject: 'seoSettings', rules: {} }
const RedirectPolicy = { node: 'policy', subject: 'seoRedirects', rules: {} }

const RegenerateSitemap = command('seo.regenerateSitemap', {
  input: { host: string() },
  handle: async ({ host }) => `${host}/sitemap.xml`,
})

const LatestSitemap = query('seo.latestSitemap', {
  input: { host: string() },
  handle: async ({ host }) => `${host}/sitemap.xml`,
})

beforeEach(() => {
  applied.length = 0
  clearModuleFacets()
  defineStandInFacets()
})

describe('a plugin is a module', () => {
  it('registers what it declares through the application, like any other module', async () => {
    const app = createApplication({
      modules: [seoPlugin().commands(RegenerateSitemap)],
      authorization: permitAll(),
    })

    expect(app.modules).toEqual(['seo'])
    expect(app.commands.has('seo.regenerateSitemap')).toBe(true)
    expect(app.registry.find('commands', 'seo.regenerateSitemap')?.module).toBe('seo')

    await expect(
      app.run({ source: 'internal' }, () =>
        app.commands.execute(RegenerateSitemap, { host: 'https://assemora.dev' }),
      ),
    ).resolves.toBe('https://assemora.dev/sitemap.xml')
  })

  it('carries the facets installed packages contribute and stays one builder', () => {
    const seo = seoPlugin()

    expect(seo.resources(SeoSettings).blocks(FaqBlock).routes(sitemap)).toBe(seo)

    createApplication({ modules: [seo] })

    expect(applied).toEqual([
      { facet: 'resources', module: 'seo', args: [SeoSettings] },
      { facet: 'blocks', module: 'seo', args: [FaqBlock] },
      { facet: 'routes', module: 'seo', args: [sitemap] },
    ])
  })

  it('has only the facets an installed package actually contributed', () => {
    clearModuleFacets()

    const bare: Partial<ModuleBuilder> = plugin('bare')

    expect(bare.resources).toBeUndefined()
    expect(bare.commands).toBeTypeOf('function')
  })

  it('has the property surface of the module it wraps, descriptor for descriptor', () => {
    const seo = plugin('seo')
    const blog = module('blog')

    expect(Reflect.ownKeys(seo)).toEqual(Reflect.ownKeys(blog))
    // A facet is installed non-enumerably and cannot be replaced; core's own methods
    // are plain properties. A plugin has to be the same object to walk and the same
    // object to write to, or code that inspects a builder sees two different things.
    for (const key of Object.getOwnPropertyNames(blog)) {
      expect([key, Object.getOwnPropertyDescriptor(seo, key)]).toEqual([
        key,
        { ...Object.getOwnPropertyDescriptor(blog, key), value: expect.anything() },
      ])
    }
  })

  it('refuses to have a facet replaced, exactly as a module does', () => {
    const seo = plugin('seo')
    const blog = module('blog')

    expect(() => {
      blog.resources = () => blog
    }).toThrow(TypeError)
    expect(() => {
      seo.resources = () => seo
    }).toThrow(TypeError)
  })

  it('carries its definition into a copy of the builder, as a module does', () => {
    const seo = plugin('seo').commands(RegenerateSitemap)

    expect({ ...seo }[MODULE].name).toBe('seo')
  })

  it('runs its lifecycle hooks in the application it is installed into', async () => {
    const booted = vi.fn()
    const stopped = vi.fn()

    const app = createApplication({ modules: [plugin('seo').boot(booted).shutdown(stopped)] })

    expect(booted).not.toHaveBeenCalled()

    await app.boot()
    expect(booted).toHaveBeenCalledTimes(1)

    await app.shutdown()
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('is refused twice under the same name, as a module is', () => {
    expect(() => createApplication({ modules: [plugin('seo'), plugin('seo')] })).toThrow(
      ConfigurationError,
    )
  })
})

describe('what an installation added', () => {
  it('describes the package the plugin ships as', () => {
    const app = createApplication({
      modules: [seoPlugin({ version: '1.4.0', description: 'Meta tags and sitemaps' })],
    })

    expect(app.registry.find('plugins', 'seo')).toEqual({
      name: 'seo',
      version: '1.4.0',
      description: 'Meta tags and sitemaps',
      contributes: {},
    })
  })

  it('omits a version and a description it was never given', () => {
    const app = createApplication({ modules: [plugin('seo')] })
    const descriptor = app.registry.find('plugins', 'seo')

    expect(descriptor).toEqual({ name: 'seo', contributes: {} })
    expect(Object.keys(descriptor ?? {})).not.toContain('version')
  })

  it('lists what it brought, under the method that brought it', () => {
    const seo = seoPlugin({ version: '1.4.0' })

    seo.resources(SeoSettings).blocks(FaqBlock).commands(RegenerateSitemap)

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      resources: { count: 1, names: ['seoSettings'] },
      blocks: { count: 1, names: ['faq'] },
      commands: { count: 1, names: ['seo.regenerateSitemap'] },
    })
  })

  it('counts a query, which declares a read rather than wiring one up', () => {
    const seo = seoPlugin()

    seo.queries(LatestSitemap)

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      queries: { count: 1, names: ['seo.latestSitemap'] },
    })
  })

  it('names a route the way the registry names one: method, then path, lowercase', () => {
    const seo = seoPlugin()

    seo.routes(sitemap, { node: 'route', method: 'post', path: '/ping' }).models(SeoMeta)

    const app = createApplication({ modules: [seo] })

    // `routeName()` in @assemora/http is `${method} ${path}` and `HttpMethod` is
    // lowercase, so this is the name `registry.find('routes', …)` answers to.
    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      routes: { count: 2, names: ['get /sitemap.xml', 'post /ping'] },
      models: { count: 1, names: ['seo_meta'] },
    })
  })

  it('names a policy by the subject it guards', () => {
    const seo = seoPlugin()

    seo.policies(SeoPolicy, RedirectPolicy)

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      policies: { count: 2, names: ['seoSettings', 'seoRedirects'] },
    })
  })

  it('collects repeated calls to the same method', () => {
    const seo = seoPlugin()

    seo.blocks(FaqBlock).blocks({ node: 'block', type: 'breadcrumbs' })

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      blocks: { count: 2, names: ['faq', 'breadcrumbs'] },
    })
  })

  it('counts what it cannot name rather than reporting that nothing was added', () => {
    const seo = seoPlugin()

    // Neither declaration carries a key this package reads. "Two, unnamed" is the
    // truth; an empty list would be read as "installing this added no policies",
    // which is the one thing a person auditing somebody else's package must not be
    // told wrongly.
    seo.policies({ node: 'policy', rules: {} }, { node: 'policy', rules: {} })

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      policies: { count: 2, names: [] },
    })
  })

  it('tells a declaration it could not name apart from one that was never made', () => {
    const seo = seoPlugin()
    const search = plugin('search')

    seo.resources(SeoSettings, { fields: {} })
    search.resources(SeoSettings)

    const app = createApplication({ modules: [seo, search] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      resources: { count: 2, names: ['seoSettings'] },
    })
    expect(app.registry.find('plugins', 'search')?.contributes).toEqual({
      resources: { count: 1, names: ['seoSettings'] },
    })
  })

  it('takes a name given as one', () => {
    const seo = seoPlugin()

    seo.models('seo_redirects')

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      models: { count: 1, names: ['seo_redirects'] },
    })
  })

  it('does not count wiring as a contribution', () => {
    const seo = plugin('seo')
      .provide(token<Map<string, string>>('seo.sitemapCache'), () => new Map())
      .boot(vi.fn())
      .ready(vi.fn())
      .shutdown(vi.fn())
      .on('page.published', vi.fn())

    const app = createApplication({ modules: [seo] })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({})
  })

  it('is recorded when the application registers it, before anything boots', () => {
    const app = createApplication({ modules: [seoPlugin().resources(SeoSettings)] })

    expect(installedPlugins(app.registry)).toEqual([
      { name: 'seo', contributes: { resources: { count: 1, names: ['seoSettings'] } } },
    ])
  })

  it('keeps saying what was installed even if the builder is chained again', () => {
    const seo = seoPlugin()

    seo.resources(SeoSettings)

    const app = createApplication({ modules: [seo] })

    seo.blocks(FaqBlock).resources({ name: 'seoRedirects' })

    expect(app.registry.find('plugins', 'seo')?.contributes).toEqual({
      resources: { count: 1, names: ['seoSettings'] },
    })
  })

  it('lists the plugins and only the plugins', () => {
    const app = createApplication({
      modules: [
        plugin('seo', { version: '1.4.0' }),
        plugin('search', { version: '0.2.0' }),
        // A module the application wrote itself was never installed, so it is not
        // one of the answers to "what does this application have in it".
        module('blog').commands(RegenerateSitemap),
      ],
    })

    expect(installedPlugins(app.registry).map((installed) => installed.name)).toEqual([
      'seo',
      'search',
    ])
  })

  it('does not publish a plugins section by being asked whether there are plugins', () => {
    const app = createApplication({ modules: [module('blog').commands(RegenerateSitemap)] })

    expect(installedPlugins(app.registry)).toEqual([])

    // `describe()` is the body of `GET /api/_introspection`. A read must not change
    // what an application publishes, and core's `section()` creates on read.
    expect(app.registry.sections()).not.toContain('plugins')
    expect(Object.keys(app.registry.describe())).not.toContain('plugins')
  })

  it('leaves the module definition otherwise untouched', () => {
    const seo = seoPlugin().resources(SeoSettings).commands(RegenerateSitemap)

    expect(seo.name).toBe('seo')
    expect(seo[MODULE].name).toBe('seo')
    // Its own entry, the resources facet, and the commands.
    expect(seo[MODULE].registrations).toHaveLength(3)
    expect(seo[MODULE].hooks.boot).toEqual([])
  })
})
