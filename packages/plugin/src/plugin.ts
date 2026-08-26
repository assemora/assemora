/**
 * The plugin API (SPEC.md §80).
 *
 * A plugin is a module (SPEC.md §13). It declares resources, blocks, routes and
 * commands with the same builder, registers through `createApplication({ modules })`
 * like every other module, and runs the same application layer — so there is nothing
 * a plugin can do that an application could not have written itself, and no second
 * registration path for a policy to be missing from.
 *
 * What a plugin has that a module does not is provenance. It arrives as an npm
 * package the application did not write, so it carries that package's version and
 * description, and it writes down what it brought: `plugins` in the Schema Registry
 * is how a person sees that installing one package added a resource, two blocks and
 * a route (SPEC.md §42).
 */
import {
  type LifecycleHook,
  MODULE,
  type ModuleBuilder,
  type ModuleDefinition,
  module,
  type SchemaRegistry,
} from '@assemora/core'

export type PluginOptions = {
  /** The version of the npm package the plugin ships as. */
  readonly version?: string
  readonly description?: string
}

/**
 * What one builder method of a plugin was handed.
 *
 * `count` is every declaration that went through it. `names` are the ones this
 * package could name, and it is deliberately allowed to be shorter: a policy is
 * `{ node, subject, rules }`, a future facet may be anything, and a list of names is
 * not a count. Reporting only the names it recognised would say "this plugin added no
 * policies" about a plugin that added five, which is the reading a person auditing
 * somebody else's package must never be given.
 */
export type Contribution = {
  readonly count: number
  readonly names: readonly string[]
}

/** How a plugin describes itself in the Schema Registry (SPEC.md §42, §80). */
export type PluginDescriptor = {
  readonly name: string
  readonly version?: string
  readonly description?: string
  /** What the plugin declared, under the builder method that declared it. */
  readonly contributes: Readonly<Record<string, Contribution>>
}

declare module '@assemora/core' {
  interface RegistrySections {
    plugins: PluginDescriptor
  }
}

/**
 * Builder methods that wire a module up rather than declare anything (SPEC.md §13).
 *
 * Everything else counts as a contribution, including a facet this package has never
 * heard of: a plugin gains `.resources()` and `.routes()` because other packages
 * contribute them (ADR-0009), and a plugin should describe what it brought through a
 * facet added tomorrow just as well.
 *
 * `queries` is not in the set on purpose. A query is a declaration — the read half of
 * what an installation added (SPEC.md §15) — so it belongs in `contributes` beside
 * the commands, while `provide`, `on` and the three lifecycle hooks only connect the
 * module to the application it is installed into.
 */
const WIRING: ReadonlySet<string> = new Set(['provide', 'on', 'boot', 'ready', 'shutdown'])

/**
 * What a declaration handed to the builder is called.
 *
 * Every DSL in Assemora names its declarations, but not all of them under the same
 * key: a resource, a command and a query carry `name`, a block carries `type`, a
 * model carries `table`, a policy carries the `subject` it guards, and a route is
 * known by its method and path. This package may depend on none of those (SPEC.md
 * §8), so it reads the label off the declaration instead of asking the package that
 * owns it. Anything that answers to none of them is counted without a name rather
 * than named by invention — see `Contribution`.
 */
const labelOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined

  const declaration = value as {
    readonly name?: unknown
    readonly type?: unknown
    readonly table?: unknown
    readonly subject?: unknown
    readonly method?: unknown
    readonly path?: unknown
  }

  if (typeof declaration.name === 'string') return declaration.name
  if (typeof declaration.type === 'string') return declaration.type
  if (typeof declaration.table === 'string') return declaration.table
  // A policy is `{ node: 'policy', subject, rules }` and is registered under its
  // subject (`packages/auth/src/policies.ts`), so that is its name here too.
  if (typeof declaration.subject === 'string') return declaration.subject
  if (typeof declaration.method === 'string' && typeof declaration.path === 'string') {
    // `routeName()` in @assemora/http is `${method} ${path}` with a lowercase method,
    // and that is the name the `routes` section of this same registry is keyed by.
    // Changing the case here would make `registry.find('routes', name)` miss for
    // every route a plugin contributed; this package may not import the function
    // that decides it, so it agrees with it verbatim instead.
    return `${declaration.method} ${declaration.path}`
  }

  return undefined
}

/**
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
 * The result is a `ModuleBuilder`, so an application installs it the way it registers
 * anything else: `createApplication({ modules: [seo] })`.
 */
export const plugin = (name: string, options: PluginOptions = {}): ModuleBuilder => {
  const built = module(name)
  const contributes = new Map<string, { count: number; names: string[] }>()

  const record = (facet: string, args: readonly unknown[]): void => {
    const recorded = contributes.get(facet) ?? { count: 0, names: [] }

    recorded.count += args.length
    for (const argument of args) {
      const label = labelOf(argument)
      if (label !== undefined) recorded.names.push(label)
    }

    contributes.set(facet, recorded)
  }

  const describe = (): PluginDescriptor => ({
    name,
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.description === undefined ? {} : { description: options.description }),
    // Copied, because the entry has to keep saying what was installed even if the
    // builder is chained again after the application has read it.
    contributes: Object.fromEntries(
      [...contributes].map(([facet, recorded]) => [
        facet,
        { count: recorded.count, names: [...recorded.names] },
      ]),
    ),
  })

  const announce: LifecycleHook = (context) => {
    context.registry.register('plugins', describe())
  }

  /**
   * A plugin is the module it wraps, plus a note of every call that went through it.
   *
   * Every method is forwarded rather than reimplemented, and they are read off the
   * module instead of listed here, because they are not all known to this package:
   * `module()` grows a method for every facet an installed package contributes, and a
   * list of them is the one thing that would have to be maintained twice (ADR-0009).
   * A facet nobody contributed is missing here exactly as it is missing there.
   */
  const facade: Record<PropertyKey, unknown> = {}

  for (const key of Reflect.ownKeys(built)) {
    if (key === MODULE) continue

    const descriptor = Reflect.getOwnPropertyDescriptor(built, key)
    if (descriptor === undefined) continue

    const method: unknown = Reflect.get(built, key)

    if (typeof method !== 'function') {
      Object.defineProperty(facade, key, descriptor)
      continue
    }

    const forward = (...args: unknown[]): ModuleBuilder => {
      Reflect.apply(method, built, args)

      if (typeof key === 'string' && !WIRING.has(key)) record(key, args)

      return wrapped
    }

    // The descriptor is copied, not re-invented: core installs a facet with
    // `Object.defineProperty(builder, name, { enumerable: false })` while its own
    // methods are plain properties (`packages/core/src/module.ts`). A plain
    // assignment here would make every method enumerable and writable, so
    // `seo.resources = …` would silently replace a facet where the same line throws
    // on a module, and `{ ...builder }` would see a different surface for the two.
    Object.defineProperty(facade, key, {
      value: forward,
      writable: descriptor.writable ?? false,
      enumerable: descriptor.enumerable ?? false,
      configurable: descriptor.configurable ?? false,
    })
  }

  // Read rather than stored: the application reads the definition once every module
  // has been declared, which is the first moment the whole chain — and therefore the
  // whole contribution list — is known. Enumerable, because a module's own `[MODULE]`
  // is, and a copy of a plugin has to carry its definition just as a copy of a module
  // does.
  Object.defineProperty(facade, MODULE, {
    enumerable: true,
    configurable: true,
    get: (): ModuleDefinition => {
      const definition = built[MODULE]

      return { ...definition, registrations: [announce, ...definition.registrations] }
    },
  })

  // Assembled key by key, so it has to be told what it grew into.
  const wrapped = facade as unknown as ModuleBuilder

  return wrapped
}

/**
 * What this application has installed, and what each installation brought.
 *
 * The section is asked for only once it exists. `registry.section()` creates the
 * section it is handed when it is missing (`packages/core/src/registry.ts`), and
 * `registry.describe()` is the body of `GET /api/_introspection` — so asking this
 * question of an application with no plugins would otherwise publish an empty
 * `plugins` section that was not there before. A read causes no side effects
 * (`docs/rules/architecture.md`), including the read a screen makes on every load.
 */
export const installedPlugins = (registry: SchemaRegistry): readonly PluginDescriptor[] =>
  registry.sections().includes('plugins') ? registry.section('plugins') : []
