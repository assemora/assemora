import { command, createApplication, type ModuleBuilder } from '@assemora/core'
import { string, uuid } from '@assemora/schema'
import { describe, expectTypeOf, it } from 'vitest'

import { type Contribution, installedPlugins, type PluginDescriptor, plugin } from './plugin.js'

/**
 * `.resources()` and `.routes()` reach a builder because `@assemora/resources` and
 * `@assemora/http` contribute them — a facet plus an augmentation of `ModuleBuilder`
 * (ADR-0009). This package may depend on neither (SPEC.md §8), so the augmentation is
 * restated here in the shape those packages declare it. What the test proves is that
 * a plugin is a thing those methods land on, without `plugin()` knowing they exist.
 */
declare module '@assemora/core' {
  interface ModuleBuilder {
    resources(...resources: unknown[]): ModuleBuilder
    routes(...routes: unknown[]): ModuleBuilder
  }
}

const SeoSettings = { name: 'seoSettings' }
const sitemap = { node: 'route', method: 'get', path: '/sitemap.xml' }

const RegenerateSitemap = command('seo.regenerateSitemap', {
  input: { id: uuid(), host: string() },
  handle: async ({ host }) => host,
})

describe('the plugin builder', () => {
  it('is a module, and carries the facets other packages contribute', () => {
    const seo = plugin('seo', { version: '1.0.0', description: 'Sitemaps' })
      .resources(SeoSettings)
      .routes(sitemap)
      .commands(RegenerateSitemap)

    expectTypeOf(seo).toEqualTypeOf<ModuleBuilder>()
  })

  it('installs through the one registration path a module uses', () => {
    const app = createApplication({ modules: [plugin('seo').commands(RegenerateSitemap)] })

    expectTypeOf(app.modules).toEqualTypeOf<readonly string[]>()
  })

  it('takes a name and, optionally, the package it ships as', () => {
    expectTypeOf(plugin).toBeCallableWith('seo')
    expectTypeOf(plugin).toBeCallableWith('seo', { version: '1.0.0' })

    // @ts-expect-error a plugin is named, always
    plugin()
    // @ts-expect-error the name is a string
    plugin(Symbol('seo'))
    // @ts-expect-error a version is written the way npm writes it
    plugin('seo', { version: 1 })
    // @ts-expect-error the plugin's package metadata is exactly these two fields
    plugin('seo', { author: 'Ada Lovelace' })
    // @ts-expect-error only a declared command is a command
    plugin('seo').commands('seo.regenerateSitemap')
  })
})

describe('the plugins section of the registry', () => {
  it('reads back as plugin descriptors', () => {
    const app = createApplication({ modules: [plugin('seo')] })

    expectTypeOf(installedPlugins(app.registry)).toEqualTypeOf<readonly PluginDescriptor[]>()
    expectTypeOf(app.registry.find('plugins', 'seo')).toEqualTypeOf<PluginDescriptor | undefined>()
  })

  it('is a description, not a thing to edit', () => {
    const descriptor: PluginDescriptor = {
      name: 'seo',
      contributes: { blocks: { count: 1, names: ['faq'] } },
    }

    expectTypeOf(descriptor.contributes.blocks).toEqualTypeOf<Contribution | undefined>()

    // @ts-expect-error the registry describes what was installed; it is not a setting
    descriptor.name = 'search'
  })

  it('counts every declaration, and names the ones it could', () => {
    const contribution: Contribution = { count: 2, names: ['faq'] }

    expectTypeOf(contribution.count).toEqualTypeOf<number>()
    expectTypeOf(contribution.names).toEqualTypeOf<readonly string[]>()

    // @ts-expect-error how many were declared is not a thing a reader decides
    contribution.count = 5
    // @ts-expect-error nor is what they were called
    contribution.names.push('breadcrumbs')

    // @ts-expect-error a facet that declared nothing nameable still says how many
    const missingCount: Contribution = { names: [] }
    expectTypeOf(missingCount).toEqualTypeOf<Contribution>()
  })
})
