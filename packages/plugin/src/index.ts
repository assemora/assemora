/**
 * `@assemora/plugin` — a module somebody else wrote (SPEC.md §80).
 *
 * ```ts
 * export default plugin('seo', {
 *   version: '1.0.0',
 *   description: 'Meta tags, sitemaps and structured data',
 * })
 *   .resources(SeoSettings)
 *   .blocks(FaqBlock)
 *   .routes(sitemap)
 *   .commands(RegenerateSitemap)
 * ```
 *
 * A plugin is a module, so it is installed as one — `createApplication({ modules:
 * [seo] })` — and everything it declares goes through the same Command Bus, policies
 * and revisions the application's own code does.
 *
 * The difference is that the application did not write it, so a plugin records what
 * the installation added in the `plugins` section of the Schema Registry, which is
 * where a person — or Studio, or an agent — reads it back from.
 */

export {
  type Contribution,
  installedPlugins,
  type PluginDescriptor,
  type PluginOptions,
  plugin,
} from './plugin.js'
