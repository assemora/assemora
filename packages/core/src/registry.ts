/**
 * Schema Registry (SPEC.md §42).
 *
 * One declaration is described once and read by OpenAPI, Studio, the SDK, MCP and
 * introspection. Sections are declared through interface augmentation, so `core`
 * never has to know what a resource or a block is (SPEC.md §8).
 */
import type { JsonSchema } from '@assemora/schema'

import { ConfigurationError } from './errors.js'
import type { Unsubscribe } from './events.js'

export type RegistryEntry = {
  readonly name: string
}

/**
 * Where a command may be called from (SPEC.md §85).
 *
 * `'anywhere'` is the default and the ordinary case: the generated
 * `POST /commands/<name>` endpoint and the MCP tool are safe by construction,
 * because the bus authorizes first and authorization denies by default.
 *
 * `'its own route'` is for the handful of commands that are *publicly* authorized —
 * a login has to be callable by somebody who is nobody yet. For those, the checks
 * that make them safe live in the route written for them (cookie-only issuance,
 * CSRF minting, the forensic fields taken from the request rather than the caller),
 * and a generated endpoint or a tool beside it would be a second, unhardened door on
 * to the same handler.
 */
export type CommandReach = 'anywhere' | 'its own route'

/** A command as the outside world sees it. */
export type CommandDescriptor = RegistryEntry & {
  readonly description?: string
  readonly input: JsonSchema
  readonly module?: string
  /**
   * Absent when the command is reachable from anywhere, which is nearly all of them.
   *
   * The generators read this section rather than the bus, so a restriction the
   * registry does not carry is one no generator can honour (ADR-0002).
   */
  readonly reachableFrom?: CommandReach
  /**
   * Absent when a proposal may be made of this command, which is nearly all of them.
   *
   * `false` says the command *is* the proposal mechanism, so wrapping it in one would
   * be circular: a proposal to propose is a row nobody can act on, and a proposal to
   * reject a proposal is one somebody has to approve before the first can be refused.
   *
   * It is a declaration rather than a list of names in `@assemora/mcp`, for the reason
   * `reachableFrom` is: a package that generates a tool for every command must not also
   * keep an opinion about which commands are special (ADR-0020).
   */
  readonly proposable?: boolean
}

/**
 * Packages add their sections by augmenting this interface:
 *
 * ```ts
 * declare module '@assemora/core' {
 *   interface RegistrySections {
 *     resources: ResourceDescriptor
 *   }
 * }
 * ```
 */
export interface RegistrySections {
  commands: CommandDescriptor
}

export type SectionName = keyof RegistrySections & string

/**
 * What moved, for a listener that keeps something derived from the registry.
 *
 * `section` is a `string` and not a `SectionName`, for the reason `describe()` hands
 * back a `Record<string, …>`: a section is declared by whichever package owns it
 * (SPEC.md §8), so `keyof RegistrySections` means something different in every package,
 * and the packages that most need to watch a section are exactly the ones that may not
 * depend on its owner. `@assemora/http` derives a resource's REST paths without being
 * allowed to know what a resource is.
 */
export type RegistryChange = {
  readonly section: string
  readonly name: string
  readonly change: 'registered' | 'withdrawn'
}

export type RegistryListener = (change: RegistryChange) => void

/**
 * Where this process publishes the generated REST paths of SPEC.md §43, or `undefined`
 * when it publishes none.
 *
 * Not every section of the registry is served the same way, and one of them is not
 * always served at all. `createApplication({ api: { crud: false } })` is a supported
 * answer — the option even recommends itself for resources that should answer only
 * under a version — and in such an application the whole `resources` section has no
 * generated address. So does a worker, a CLI run and a test: an application is not a
 * server.
 *
 * It lives beside `CommandReach`, which answers the same question for the `commands`
 * section, and for the same reason: what a declaration is reachable through is decided
 * above core and read below it, and core is the only package both ends can see.
 */
let generatedCrudAt: string | undefined

/**
 * Says where generated CRUD answers. Called by whatever serves it.
 *
 * ```ts
 * publishGeneratedCrud('/api') // this server answers GET /api/articles
 * publishGeneratedCrud() // this process publishes no generated REST paths at all
 * ```
 *
 * Process state, like the routes a module declares, and re-declared by every server as
 * it is built: the most recently built server speaks for the process, and a process
 * that builds one and never mounts resources says so by never calling this with a
 * prefix.
 */
export const publishGeneratedCrud = (prefix?: string): void => {
  generatedCrudAt = prefix
}

/**
 * The prefix generated CRUD answers below, or `undefined` when nothing publishes it.
 *
 * Read by whoever has to tell somebody what they just made. `collections.create` is the
 * caller that matters: it answers a person in Studio and an agent over MCP with the
 * addresses of a collection that did not exist a moment ago, and a sentence generated
 * from the collection's own `api` flags cannot know whether this application serves any
 * of them. It promised five addresses that answered 404.
 */
export const generatedCrudPrefix = (): string | undefined => generatedCrudAt

export type SchemaRegistry = {
  register<K extends SectionName>(section: K, entry: RegistrySections[K]): void
  /**
   * Takes a description back out, and says whether one was there.
   *
   * Everything a source file declares is registered once and stays: a second entry
   * under one name is a defect, and `register` refuses it. Two things, though, arrive
   * and leave while the process runs. A collection created through Studio or by an
   * agent is registered after boot and deleted long before shutdown (SPEC.md §37), and
   * the §47 review wanted the same seam for a withdrawn version. Without it the
   * registry could learn about a description and never unlearn it, so `/api/openapi.json`,
   * the API Explorer and the generated MCP tools would go on publishing a collection
   * that no longer exists.
   *
   * Replacing a description is `withdraw` then `register`, deliberately. The refusal of
   * a duplicate is what keeps two declarations from quietly sharing a name, and a
   * caller that means to take a name over should have to say so.
   */
  withdraw<K extends SectionName>(section: K, name: string): boolean
  section<K extends SectionName>(section: K): readonly RegistrySections[K][]
  find<K extends SectionName>(section: K, name: string): RegistrySections[K] | undefined
  sections(): readonly SectionName[]
  /** The whole registry as plain data — the seed of `assemora.describe` (SPEC.md §71). */
  describe(): Readonly<Record<string, readonly RegistryEntry[]>>
  /**
   * Watches the registry, and answers with the way to stop watching.
   *
   * ```ts
   * const stop = registry.onChange((change) => {
   *   if (change.section === 'resources') describeTheirRestPaths()
   * })
   * ```
   *
   * Some sections are not declarations but *consequences*: a resource's generated REST
   * paths are generated from the resource, so their description has to arrive and leave
   * with it (SPEC.md §37, §42). While nothing could change after start-up, deriving once
   * at mount time was the same thing. A collection is registered by a command in the
   * middle of a running process, and whatever was derived is then a section behind.
   *
   * The registry is the only thing that sees the change, so it is the only thing that
   * can say so. `@assemora/http` used to go looking on every request instead — a full
   * `describe()` per request to find out that nothing had happened, and a description
   * that was still one request stale for anybody reading the registry directly.
   *
   * Listeners are called after the change is applied, so a listener sees the registry it
   * was told about. A listener that registers is therefore calling itself back: react to
   * the section you derive *from*, never to the one you write.
   */
  onChange(listener: RegistryListener): Unsubscribe
  /**
   * Which module registered an entry, when one did (ADR-0027).
   *
   * A registry entry says what a thing is and, until now, nothing about where it came
   * from. That is enough while every module is first-party, and it stops being enough
   * the day a package is installable: a rule of the form "a module may only speak for
   * what it declared" cannot be written unless somebody remembers who declared what.
   *
   * Absent means the entry did not arrive through a module's registration — a
   * collection created by a command while the process runs, or a registration made
   * directly against the application's own registry.
   */
  registeredBy(section: string, name: string): string | undefined
  /**
   * The same registry, attributing everything registered through it to `module`.
   *
   * Handed to a module by the application, so a facet writes its own name without
   * being asked and without being able to give another. It is not a sandbox — a
   * package that calls this itself can name anybody, and inside one process nothing
   * short of a separate realm could stop it. What it removes is the *casual* case:
   * writing an entry attributed to a module you are not is now a deliberate act that
   * reads as one, rather than the default.
   */
  forModule(module: string): SchemaRegistry
}

/** Any entry the registry can hold — the union over every declared section. */
type AnyEntry = RegistrySections[SectionName]

/**
 * Sections whose names come out of one namespace, so a name in either is taken in both.
 *
 * Commands and queries are the pair. They are separate sections because they are
 * separate things — one writes and one does not — but everything downstream addresses
 * them by a single flat name, and a name that means two things means one of them is
 * unreachable:
 *
 * - A command name *is* a permission name (ADR-0015), so `orders.sync` declared as both
 *   makes one permission cover a read and a write, and no role can grant one without
 *   the other.
 * - `@assemora/mcp` generates a tool per command and per query, and finds the tool to
 *   call by name. Two tools with one name is a `find`, so the first wins — and since
 *   reads are generated first, the mutation is the half that disappears.
 *
 * Within a section this is already refused. Across the pair it was not, and being
 * separate maps is the whole reason: neither could see the other.
 */
const SHARED_NAMESPACES: readonly (readonly string[])[] = [['commands', 'queries']]

/** The other sections a name registered in this one also claims. */
const alsoClaims = (section: string): readonly string[] =>
  SHARED_NAMESPACES.find((group) => group.includes(section))?.filter((name) => name !== section) ??
  []

export const createSchemaRegistry = (): SchemaRegistry => {
  const sections = new Map<string, Map<string, AnyEntry>>()
  const listeners = new Set<RegistryListener>()

  /**
   * Told after the change, and over a copy of the set.
   *
   * A listener that reacts by registering something is the ordinary case — that is what
   * a derived section is — so the set is free to grow and shrink while it is being
   * walked, and iterating it directly would either miss a listener or visit one twice.
   */
  const announce = (change: RegistryChange): void => {
    for (const listener of [...listeners]) listener(change)
  }

  const bucket = (section: string): Map<string, AnyEntry> => {
    const existing = sections.get(section)
    if (existing !== undefined) return existing

    const created = new Map<string, AnyEntry>()
    sections.set(section, created)
    return created
  }

  /** `section` and `name` together, which is what an entry is addressed by. */
  const owners = new Map<string, string>()

  const attributionKey = (section: string, name: string): string => `${section}\u0000${name}`

  /**
   * @param attributedTo the module a registration through this view belongs to.
   */
  const build = (attributedTo?: string): SchemaRegistry => ({
    register(section, entry) {
      const entries = bucket(section)

      if (entries.has(entry.name)) {
        throw new ConfigurationError(`"${entry.name}" is already registered in ${section}`)
      }

      // Named in the other half of a shared namespace. Refused here, at the moment the
      // second one arrives, because that is the only moment both are known and the only
      // moment the message can name them both.
      for (const claimed of alsoClaims(section)) {
        // Looked up rather than `bucket`ed: that one creates the section it is asked
        // for, and an empty `queries` conjured by registering a command is a section
        // `describe()` would then carry.
        if (sections.get(claimed)?.has(entry.name) !== true) continue

        throw new ConfigurationError(
          `"${entry.name}" is already registered in ${claimed}, so it cannot also be registered in ${section}. A command and a query are addressed by one name — as a permission, and as a tool an agent calls — so one of the two would be unreachable. Rename one of them.`,
        )
      }

      entries.set(entry.name, entry)

      if (attributedTo !== undefined) owners.set(attributionKey(section, entry.name), attributedTo)

      announce({ section, name: entry.name, change: 'registered' })
    },

    withdraw(section, name) {
      // Only a name that was there. "Nothing happened" is not a change, and a listener
      // that rebuilt a derived section on every failed withdrawal would do the work of
      // the registry's whole contents for a call that did nothing.
      if (!bucket(section).delete(name)) return false

      // Or a name registered, withdrawn and registered again by somebody else would
      // still answer with the first module.
      owners.delete(attributionKey(section, name))

      announce({ section, name, change: 'withdrawn' })

      return true
    },

    section<K extends SectionName>(section: K): readonly RegistrySections[K][] {
      /**
       * The section name determines which member of the union is stored under it, and
       * narrowing happens here once instead of at every call site.
       *
       * Through `unknown` because `RegistrySections` is an interface other packages
       * augment: for a section name TypeScript has not resolved, `RegistrySections[K]`
       * in this position is the *intersection* of every declared section, and no single
       * entry is comparable to that. The name is the fact the compiler cannot see.
       */
      return [...bucket(section).values()] as unknown as readonly RegistrySections[K][]
    },

    find<K extends SectionName>(section: K, name: string): RegistrySections[K] | undefined {
      return bucket(section).get(name) as RegistrySections[K] | undefined
    },

    sections() {
      return [...sections.keys()] as readonly SectionName[]
    },

    describe() {
      const snapshot: Record<string, readonly RegistryEntry[]> = {}

      for (const [section, entries] of sections) {
        snapshot[section] = [...entries.values()]
      }

      return snapshot
    },

    onChange(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    registeredBy(section, name) {
      return owners.get(attributionKey(section, name))
    },

    // The attribution is the only thing a view changes, so a view of a view is the
    // inner one's — there is nothing else to carry over.
    forModule(module) {
      return build(module)
    },
  })

  return build()
}
