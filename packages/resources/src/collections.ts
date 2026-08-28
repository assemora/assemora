/**
 * Collections: the resources an application grew rather than declared (SPEC.md §37).
 *
 * A static resource is a source file, registered once while the application is being
 * built. A collection is a row, and it arrives after boot, changes shape and is deleted
 * — so it needs somewhere to be put and somewhere to be taken from. That is all this
 * file is: the two registries a resource has to appear in, and the one place that keeps
 * them in step.
 *
 * Everything above it — CRUD, Studio, MCP, OpenAPI, the API Explorer — addresses a
 * resource by name (ADR-0012) and cannot tell the two apart, which is the point.
 */
import {
  AssemoraError,
  ConfigurationError,
  type Logger,
  type RegistryEntry,
  type SchemaRegistry,
  ValidationError,
} from '@assemora/core'

import { type DynamicDefinition, dynamicResource, parseDynamicDefinition } from './dynamic.js'
import { registerResource, resourceByName, unregisterResource } from './registry.js'
import type { AnyResource } from './resource.js'
import { registerEntryRestorer } from './restorer.js'
import { ResourceDefinitionModel } from './system-models.js'

export type Collection = {
  /** The row in `assemora_resource_definitions` this collection is. */
  readonly id: string
  readonly definition: DynamicDefinition
  /**
   * Field names removed while the collection held entries (SPEC.md §38).
   *
   * Their values are still in every entry's `data`, under those names. The list is
   * what stops a later field of the same name from inheriting them.
   */
  readonly dropped: readonly string[]
  readonly resource: AnyResource
}

const collections = new Map<string, Collection>()

/**
 * The Schema Registry of the running application.
 *
 * A command handler is given a context, not an application, so the registry has to be
 * findable rather than passed — the same bargain core makes for `dispatch()`, which is
 * a free function that has to reach the Job Bus. The `collections()` module puts it
 * here while it boots, which is before any command can run.
 */
let schemaRegistry: SchemaRegistry | undefined

export const useCollectionRegistry = (registry: SchemaRegistry): void => {
  schemaRegistry = registry
}

const currentRegistry = (): SchemaRegistry => {
  if (schemaRegistry === undefined) {
    throw new ConfigurationError(
      'Collections are not set up in this application, so a collection cannot be created, changed or deleted. Add collections() to "modules".',
    )
  }

  return schemaRegistry
}

/**
 * Puts a collection into both registries, and answers with what was installed.
 *
 * Both, always: the runtime registry is what `entries.*` looks a resource up in, and
 * the Schema Registry is what Studio, OpenAPI, the API Explorer and the MCP tool list
 * are generated from. A collection in one and not the other is a collection that is
 * either invisible or unusable.
 */
export const installCollection = (
  id: string,
  definition: DynamicDefinition,
  dropped: readonly string[] = [],
): Collection => {
  const resource = dynamicResource(definition, { id })

  // Throws when the name is taken, which is deliberate: it is the last line against a
  // collection shadowing a static resource, and it fires before the Schema Registry
  // is touched, so nothing half-registers.
  registerResource(resource)
  currentRegistry().register('resources', resource.descriptor)
  registerEntryRestorer(definition.name)

  const collection: Collection = { id, definition, dropped, resource }

  collections.set(definition.name, collection)

  return collection
}

/**
 * Takes a collection out of both registries. Says whether one was there.
 *
 * It withdraws what *this* module installed and nothing else, which is not the same as
 * withdrawing whatever answers to the name. `collections.delete` deliberately works on a
 * stored definition that was never registered — that is how a row the parser refuses at
 * boot is got rid of — and a name is skipped at boot precisely when something else
 * already holds it. Withdrawing by name alone therefore unregistered the *static*
 * resource of that name: a source-declared resource, its REST routes still mounted and
 * answering 404, gone from the live process until a restart. The path needs no SQL —
 * make a collection, ship a static resource of the same name, boot skips the collection
 * by design, somebody tidies up the row.
 *
 * `id` pins it to the row being acted on, so a definition row and a registered
 * collection that merely share a name are never mistaken for each other.
 */
export const withdrawCollection = (name: string, id?: string): boolean => {
  const installed = collections.get(name)

  if (installed === undefined) return false
  if (id !== undefined && installed.id !== id) return false

  collections.delete(name)
  unregisterResource(name)
  currentRegistry().withdraw('resources', name)

  return true
}

export const collectionByName = (name: string): Collection | undefined => collections.get(name)

export const registeredCollections = (): readonly Collection[] => [...collections.values()]

/** Exposed for tests. A running application never forgets its collections. */
export const clearCollections = (): void => {
  collections.clear()
  schemaRegistry = undefined
}

/**
 * Refuses a name something else already answers to.
 *
 * A static resource is a code-level declaration that a person editing in Studio cannot
 * see, so the collision has to be reported here rather than discovered at the next boot
 * — where the collection would simply be skipped and the person who made it would never
 * find out (SPEC.md §37).
 */
export const refuseTakenName = (name: string): void => {
  const taken = (() => {
    try {
      return resourceByName(name).descriptor.kind
    } catch {
      return undefined
    }
  })()

  if (taken !== undefined) {
    throw new AssemoraError(
      'RESOURCE_NAME_TAKEN',
      taken === 'static'
        ? `"${name}" is a resource this application declares in its source, so a collection cannot take that name. Choose another one.`
        : `A collection called "${name}" already exists.`,
      { status: 409 },
    )
  }

  refusePermissionSubject(name)
  refuseRouteCollision(name)
}

/**
 * The permission subjects this application already means something by.
 *
 * A command name is a permission name (ADR-0015), so every registered command and
 * query puts its group into the permission namespace: `revisions.list` and
 * `revisions.restore` make `revisions` a subject somebody may hold `revisions.*` on.
 * Reads and writes both count — half of what a permission opens is a query.
 */
const permissionSubjects = (): ReadonlyMap<string, readonly string[]> => {
  const registry = currentRegistry()
  const subjects = new Map<string, string[]>()

  for (const entry of [...registry.section('commands'), ...registry.section('queries')]) {
    const dot = entry.name.indexOf('.')

    if (dot <= 0) continue

    const subject = entry.name.slice(0, dot)
    const known = subjects.get(subject)

    if (known === undefined) subjects.set(subject, [entry.name])
    else known.push(entry.name)
  }

  return subjects
}

/**
 * Refuses a name that already means something in the permission namespace.
 *
 * `entries.list` on resource `X` authorizes `X.read` — the resource's *name* is the
 * subject. So a collection called `revisions` is covered by `revisions.*`, and an
 * editor granted that to read history silently gained create, read, update and delete
 * over a collection nobody granted them anything on. Nothing said so anywhere, and the
 * name is chosen by whoever makes the collection, an agent holding `collections.create`
 * included (SPEC.md §51, §76).
 *
 * It is read off the registry rather than a list of words, because the list would be a
 * second copy of what modules declare and would be wrong the day a package adds a
 * command group. `@assemora/auth` is not importable from here (SPEC.md §8), and it does
 * not need to be: the namespace is what the registry says it is.
 */
const refusePermissionSubject = (name: string): void => {
  const commands = permissionSubjects().get(name)

  if (commands === undefined) return

  throw new AssemoraError(
    'RESOURCE_NAME_TAKEN',
    `"${name}" is already a permission subject in this application (${[...commands].sort().slice(0, 3).join(', ')}${commands.length > 3 ? ', …' : ''}), so a collection of that name would be granted to everybody holding "${name}.*" without anybody granting it. Choose another name.`,
    { status: 409 },
  )
}

/** The two segments generated CRUD would claim for a resource (SPEC.md §43). */
const claimedBy = (name: string): ((path: string) => boolean) => {
  const base = `/${name}`

  return (path) => {
    if (path === base) return true
    if (!path.startsWith(`${base}/`)) return false

    const rest = path.slice(base.length + 1)

    // `/articles/:id` collides with the generated one; `/articles/by-slug/:slug` does
    // not, because a static segment and a parameter can share a position.
    return rest.startsWith(':') && !rest.includes('/')
  }
}

/** A described route, as much of one as this package is allowed to know about. */
type DescribedRoute = { readonly method: string; readonly path: string }

const isRoute = (entry: RegistryEntry): entry is RegistryEntry & DescribedRoute => {
  const candidate = entry as Partial<DescribedRoute>

  return typeof candidate.method === 'string' && typeof candidate.path === 'string'
}

/**
 * Refuses a name whose generated REST paths a route already serves.
 *
 * Those paths are mounted at startup, so the collision would not happen now — it would
 * happen at the *next* boot, as a server that refuses to start. A command must not be
 * able to leave that behind (SPEC.md §43, §98).
 *
 * The routes are read off `describe()` rather than `section('routes')`: that section is
 * declared by `@assemora/http`, which this package must not depend on (SPEC.md §8).
 */
const refuseRouteCollision = (name: string): void => {
  const registry = currentRegistry()
  const claims = claimedBy(name)
  const clashing = (registry.describe().routes ?? [])
    .filter(isRoute)
    .filter((route) => claims(route.path))
    .map((route) => `${route.method.toUpperCase()} ${route.path}`)

  if (clashing.length > 0) {
    throw new AssemoraError(
      'RESOURCE_NAME_TAKEN',
      `A collection called "${name}" would generate REST paths this application already serves (${clashing.join(', ')}), and the server would refuse to start. Choose another name.`,
      { status: 409 },
    )
  }
}

/** What a definition row remembers besides the definition itself. */
export const droppedFieldsOf = (settings: unknown): readonly string[] => {
  const dropped = (settings as { dropped?: unknown } | null)?.dropped

  return Array.isArray(dropped)
    ? dropped.filter((name): name is string => typeof name === 'string')
    : []
}

/**
 * The code an adapter reports a table that does not exist yet under.
 *
 * Compared as a string rather than imported from `@assemora/database`, which owns it:
 * the dependency graph puts that package below `@assemora/data` and outside this one's
 * reach (SPEC.md §8). No loss — an `AssemoraError` code is a public contract, it is
 * what a REST client reads out of `toPayload()`, and `@assemora/cli` compares
 * `FORBIDDEN` the same way. `collections.boot.test.ts` pins the two together by
 * throwing the real constructor at the real loader.
 */
const SCHEMA_NOT_APPLIED = 'SCHEMA_NOT_APPLIED'

type StoredDefinitions = Awaited<ReturnType<typeof ResourceDefinitionModel.all>>

/**
 * The stored definitions, or `undefined` when their table does not exist yet.
 *
 * The one failure this boot survives, and nothing wider. A refused connection, a
 * database that is not there, a privilege the user was never granted: each is an
 * application that cannot work, and each would otherwise become the same silent empty
 * boot as a schema waiting to be migrated (SPEC.md §86).
 */
const storedDefinitions = async (): Promise<StoredDefinitions | undefined> => {
  try {
    return await ResourceDefinitionModel.orderBy('createdAt', 'asc').get()
  } catch (error) {
    if (error instanceof AssemoraError && error.code === SCHEMA_NOT_APPLIED) return undefined

    throw error
  }
}

/** What a boot found in the definitions table. */
export type LoadedCollections = {
  readonly loaded: readonly string[]
  readonly skipped: readonly string[]
  /**
   * True when the table does not exist yet, so nothing was read at all.
   *
   * A different fact from `loaded` being empty, and the one a caller has to branch on:
   * both boots register no collection, and only one of them is a working application.
   * The `collections()` module is that caller — it turns this into
   * `context.cannotStart()`, which is what a readiness probe eventually reads.
   */
  readonly pending: boolean
}

/**
 * Registers every stored collection, and refuses to let one of them stop the boot.
 *
 * A definition the parser rejects today is one a plugin's field kind used to make legal,
 * or a row somebody edited by hand. Refusing to start would take the whole application
 * down for one collection, so it is named in the log and skipped — and it stays in the
 * table, so re-registering the missing field kind brings it back (SPEC.md §37, §86).
 *
 * The table itself not existing is the other tolerated state, and it is a different
 * one: `pending` says the collections were not read at all rather than that there are
 * none.
 */
export const loadCollections = async (
  registry: SchemaRegistry,
  logger: Logger,
): Promise<LoadedCollections> => {
  useCollectionRegistry(registry)

  const rows = await storedDefinitions()

  if (rows === undefined) {
    // Warned rather than thrown, and warned in both cases. An application must be able
    // to boot against a schema that is not applied yet — `assemora db:generate` boots
    // it precisely to write that schema (ADR-0021) — so this cannot be fatal here. It
    // is also the only line a person gets who started a *server* this way, so it names
    // the remedy rather than the symptom.
    logger.warn('Collections were not loaded: their table does not exist yet', {
      table: ResourceDefinitionModel.table,
      remedy: 'assemora db:migrate',
    })

    return { loaded: [], skipped: [], pending: true }
  }

  const loaded: string[] = []
  const skipped: string[] = []

  for (const row of rows) {
    try {
      const definition = parseDynamicDefinition(row.schema)

      if (definition.name !== row.name) {
        throw new ValidationError([
          {
            path: ['name'],
            code: 'mismatch',
            message: `the stored schema calls this collection "${definition.name}"`,
          },
        ])
      }

      // Asked again at boot, not only when the collection was made: a release that
      // adds a command group turns a name that was free into one that grants itself
      // to whoever holds that group's wildcard. Skipping is what the loader already
      // does for a name a static resource has since taken, and it leaves the row in
      // place so the definition is not lost.
      refusePermissionSubject(definition.name)

      installCollection(row.id, definition, droppedFieldsOf(row.settings))
      loaded.push(definition.name)
    } catch (error) {
      skipped.push(row.name)
      logger.warn('A stored collection was skipped', {
        collection: row.name,
        id: row.id,
        reason: error instanceof Error ? error.message : String(error),
        ...(error instanceof ValidationError ? { fields: error.fields } : {}),
      })
    }
  }

  if (loaded.length > 0 || skipped.length > 0) {
    logger.info('Collections registered', { loaded: loaded.length, skipped: skipped.length })
  }

  return { loaded, skipped, pending: false }
}
