/**
 * Making a collection (SPEC.md §37, §38, §86).
 *
 * These are the commands behind "a user must be able to create a collection through
 * Studio or AI without changing source code". They go through the Command Bus like
 * everything else, so they are MCP tools by generation (ADR-0020), an agent's proposal
 * is applied by a person (SPEC.md §75), and the definition they store is checked by
 * `parseDynamicDefinition` — declarative JSON, registered field kinds, nothing else.
 *
 * What arrives instantly and what waits for a restart is spelled out in every answer
 * they give, because the difference is not something anybody should have to discover.
 */
import {
  AssemoraError,
  type CommandContext,
  command,
  NotFoundError,
  query,
  ValidationError,
} from '@assemora/core'
import type { Issue } from '@assemora/schema'
import { array, string } from '@assemora/schema'

import {
  type Collection,
  collectionByName,
  droppedFieldsOf,
  installCollection,
  refuseTakenName,
  registeredCollections,
  withdrawCollection,
} from './collections.js'
import { type ApiExposure, humanize } from './descriptor.js'
import { type DynamicDefinition, dynamicResource, parseDynamicDefinition } from './dynamic.js'
import { definitionSchema, type FieldSpec } from './field-registry.js'
import { hasResource, registeredResources } from './registry.js'
import { ResourceDefinitionModel, ResourceEntryModel } from './system-models.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'collection.created': { readonly name: string }
    'collection.updated': { readonly name: string }
    'collection.deleted': { readonly name: string }
  }
}

/**
 * What these commands act on, and therefore the permission they take.
 *
 * A command name is a permission name (ADR-0015), so `collections.create` is `create` on
 * `collections`. Nothing grants it by accident: `articles.*` is a different subject, and
 * the wildcard that covers this one is `collections.*` — which is deliberately not
 * `entries.*`, because deciding what a collection *is* is a bigger right than writing
 * one of its entries.
 *
 * `resources` was the obvious name and is taken: `@assemora/mcp` registers
 * `assemora.resources.list` and `assemora.resources.describe`, and a `resources.list`
 * here would generate a second MCP tool of exactly that name (ADR-0020). `collections`
 * is also the word SPEC.md §37 uses for the thing a person makes.
 */
const SUBJECT = 'collections'

/**
 * What a collection can be reached through the moment it is made, and what it cannot.
 *
 * CRUD is addressed by resource name rather than by route (ADR-0012), so the commands,
 * the queries, Studio and the MCP tools — which are one generic set, not one per
 * resource — carry a new collection immediately, and so does the API Explorer, which
 * hands back the registry as it stands.
 *
 * The generated REST paths of SPEC.md §43 are Fastify routes, mounted before the server
 * listens, and a route cannot be added to a started server. `/api/openapi.json` is split
 * by the same line, and the split is easy to mistake for a bug: its `components.schemas`
 * are built from the resources section and gain the collection at once, while its
 * `paths` are built from the routes section and do not.
 */
const LIVE_NOW =
  'Reachable now through entries.create, entries.update, entries.delete, entries.list and entries.get, so Studio, an agent over MCP and the API Explorer already have it.'

const REST_PENDING =
  'Its own REST paths are mounted when the server starts, so /api/<name> answers 404, and /api/openapi.json carries this collection as a component schema but not as a path, until the next restart.'

const DROPPED_VALUES =
  'A dropped field keeps its values in every entry, under the name it had. They are no longer readable, and a later field of that name is refused while the collection holds entries.'

/**
 * A definition whose label has been settled.
 *
 * The label is a column as well as part of the stored schema, and the two must never
 * disagree — so it is derived once, here, rather than by whoever writes the row.
 */
type LabelledDefinition = DynamicDefinition & { readonly label: string }

const named = (definition: DynamicDefinition): LabelledDefinition => ({
  ...definition,
  label: definition.label ?? humanize(definition.name),
})

/**
 * Registers the collection once the row that describes it is durable (ADR-0023).
 *
 * The two registries are process state, exactly as a queue is, and a dry run rolls the
 * row back without being able to roll anything else back. Registering inside the handler
 * would leave `changesets.propose` — which is how an agent's mutation arrives by default
 * (SPEC.md §75) — with a collection nobody committed: entries could be written against a
 * `resourceId` that does not exist, and it would vanish at the next boot.
 *
 * Through `context.afterCommit` and never through the transaction port directly. The
 * port registers against the *outermost* commit, which is what a committing command
 * wants and the exact opposite of what a previewed one does: inside `context.preview`
 * the outermost commit belongs to the command doing the previewing, so the registration
 * would survive the preview's rollback and be applied for real. The bus withholds the
 * whole batch from a preview instead.
 *
 * After-commit work has no caller left to reject to, so it reports its own failure. It
 * has one realistic way to fail — a name taken between the check and the commit — and
 * the unique index on `name` refuses that first.
 */
const onceCommitted = (context: CommandContext, register: () => void): void => {
  context.afterCommit(() => {
    try {
      register()
    } catch (error) {
      context.logger.error('A collection was stored but could not be registered', {
        reason: error instanceof Error ? error.message : String(error),
        effect: 'it is registered at the next boot',
      })
    }
  })
}

/** Whatever the row's settings hold, as something safe to spread over. */
const settingsOf = (settings: unknown): Record<string, unknown> =>
  typeof settings === 'object' && settings !== null && !Array.isArray(settings)
    ? { ...(settings as Record<string, unknown>) }
    : {}

const fieldNames = (definition: DynamicDefinition): ReadonlySet<string> =>
  new Set(definition.fields.map((field) => field.name))

const byName = (definition: DynamicDefinition): ReadonlyMap<string, FieldSpec> =>
  new Map(definition.fields.map((field) => [field.name, field]))

const refuse = (issues: readonly Issue[]): never => {
  throw new ValidationError(issues)
}

/**
 * A field leaves only when the caller says it is leaving.
 *
 * The entries hold `data` keyed by field name, so a field that quietly falls out of the
 * list takes its values out of sight with it. Studio sending a stale field list, or an
 * agent rewriting the definition from half a memory, is exactly how that happens — so
 * the removal has to be named, and naming a removal that is not happening is a mistake
 * worth reporting too.
 *
 * This is also the whole of "renaming a field": there is no rename. Two field lists are
 * compared by name, so a rename is indistinguishable from removing one field and adding
 * another, and the values do not travel.
 */
const removalsOf = (
  current: DynamicDefinition,
  next: DynamicDefinition,
  drop: readonly string[],
): readonly string[] => {
  const keeping = fieldNames(next)
  const removed = current.fields.map((field) => field.name).filter((name) => !keeping.has(name))
  const declared = new Set(drop)
  const issues: Issue[] = []

  for (const name of removed) {
    if (declared.has(name)) continue

    issues.push({
      path: ['fields'],
      code: 'field_removed',
      message: `"${name}" is no longer declared. ${DROPPED_VALUES} Name it in "drop" to say you mean it.`,
    })
  }

  for (const [index, name] of drop.entries()) {
    if (removed.includes(name)) continue

    issues.push({
      path: ['drop', index],
      code: 'not_removed',
      message: `"${name}" is named in "drop" but is not being removed.`,
    })
  }

  return issues.length > 0 ? refuse(issues) : removed
}

/**
 * What a stored value *is* cannot change once values exist; what it is shown and
 * searched as can.
 *
 * `text` → `number` over a stored `"hello"` has no honest answer. Coercing invents data,
 * failing halfway leaves the collection in two shapes at once, and keeping the old value
 * makes the declared kind a lie — so while the collection holds entries a field's kind,
 * its select options, its slug source and its relation target are frozen. Everything
 * presentational, and every flag that only decides how a value is offered — required,
 * searchable, sortable, filterable, hidden, read-only, agent access — changes freely.
 *
 * An empty collection is where people actually fix a wrong choice, and there is nothing
 * to convert, so nothing is refused there.
 */
const refuseUnsafeChanges = (
  current: DynamicDefinition,
  next: DynamicDefinition,
  entries: number,
  dropped: readonly string[],
): void => {
  if (entries === 0) return

  const existing = byName(current)
  const issues: Issue[] = []

  for (const [index, field] of next.fields.entries()) {
    const before = existing.get(field.name)

    if (before === undefined) {
      if (!dropped.includes(field.name)) continue

      issues.push({
        path: ['fields', index, 'name'],
        code: 'name_holds_values',
        message: `A field called "${field.name}" was removed while this collection held entries, and their values are still stored under that name. Choose another name, or empty the collection first.`,
      })
      continue
    }

    if (before.kind !== field.kind) {
      issues.push({
        path: ['fields', index, 'kind'],
        code: 'kind_frozen',
        message: `"${field.name}" is stored as ${before.kind} in ${entries} ${entries === 1 ? 'entry' : 'entries'}, so it cannot become ${field.kind}. Empty the collection first, or add a new field under another name.`,
      })
    }

    if (before.source !== field.source) {
      issues.push({
        path: ['fields', index, 'source'],
        code: 'source_frozen',
        message: `"${field.name}" derives from "${before.source}" in stored entries, so its source cannot change while the collection holds entries.`,
      })
    }

    if (before.target !== field.target) {
      issues.push({
        path: ['fields', index, 'target'],
        code: 'target_frozen',
        message: `"${field.name}" points at "${before.target}" in stored entries, so its target cannot change while the collection holds entries.`,
      })
    }

    // Widening is safe — a stored value still validates. Narrowing is not: an entry
    // holding a removed option would read back as a value the field says is impossible.
    const offered = new Set(field.options ?? [])
    const lost = (before.options ?? []).filter((option) => !offered.has(option))

    if (lost.length > 0) {
      issues.push({
        path: ['fields', index, 'options'],
        code: 'options_frozen',
        message: `"${field.name}" can gain options while the collection holds entries, but not lose ${lost.map((option) => `"${option}"`).join(', ')} — an entry may hold one.`,
      })
    }
  }

  if (issues.length > 0) refuse(issues)
}

const liveEntries = (id: string): Promise<number> =>
  ResourceEntryModel.where('resourceId', id).count()

const storedByName = (name: string) => ResourceDefinitionModel.where('name', name).first()

/**
 * A definition that is stored but not registered.
 *
 * The boot loader skips a definition it cannot parse rather than refusing to start
 * (SPEC.md §37), so its name is held by a row that no registry mentions. Without this
 * the two ways in would both mislead: creating that name would fail on a unique index
 * with a database error, and reading it would say it was not found.
 */
const SKIPPED =
  'is stored but was not registered when this application started, so it cannot be read or changed. The log line "A stored collection was skipped" says why. Delete it with collections.delete, or restore whatever provided its field kinds and restart.'

export const CreateCollection = command('collections.create', {
  description: 'Creates a collection: a resource whose schema is stored, not written in TypeScript',
  input: {
    name: definitionSchema.shape.name,
    label: definitionSchema.shape.label,
    fields: definitionSchema.shape.fields,
  },
  handle: async ({ name, label, fields }, context) => {
    // Everything goes through the parser, whatever the bus already checked. It is the
    // one place that knows a field kind has to be registered, and the one place §86 is
    // enforced — a second door into a stored definition is a second door round it.
    const definition = named(parseDynamicDefinition({ name, label, fields }))

    refuseTakenName(definition.name)

    if ((await storedByName(definition.name)) !== null) {
      throw new AssemoraError('RESOURCE_NAME_TAKEN', `"${definition.name}" ${SKIPPED}`, {
        status: 409,
      })
    }

    const row = await ResourceDefinitionModel.create({
      name: definition.name,
      label: definition.label,
      schema: definition,
      settings: {},
    })

    onceCommitted(context, () => {
      installCollection(row.id, definition)
    })

    context.revise({ entityType: SUBJECT, entityId: row.id, before: null, after: definition })
    context.emit('collection.created', { name: definition.name })

    return {
      id: row.id,
      name: definition.name,
      resource: dynamicResource(definition, { id: row.id }).descriptor,
      /** No generated REST paths in this process, and none until the next start. */
      restPathsPending: true,
      note: `${LIVE_NOW} ${REST_PENDING}`,
    }
  },
})

export const UpdateCollection = command('collections.update', {
  description: 'Changes a collection: its label, and the fields it declares',
  input: {
    name: definitionSchema.shape.name,
    label: definitionSchema.shape.label,
    fields: definitionSchema.shape.fields,
    /**
     * Every field this update removes, named. Anything removed and not named here is
     * refused, because the values stay behind in every entry.
     */
    drop: array(string()).optional(),
  },
  handle: async ({ name, label, fields, drop }, context) => {
    const row = await storedByName(name)

    if (row === null) throw new NotFoundError('collection', name)

    // The record itself decides, and it has to be read before it is written
    // (SPEC.md §51).
    await context.authorize(SUBJECT, 'update', row.toJSON())

    if (collectionByName(name) === undefined) {
      // Every rule below compares the new definition against the stored one, and a
      // stored one that cannot be parsed cannot be compared with. Overwriting it
      // regardless would drop exactly the checks that keep stored values readable, on
      // the one collection whose shape is least well known.
      throw new AssemoraError('COLLECTION_NOT_REGISTERED', `"${name}" ${SKIPPED}`, { status: 409 })
    }

    const current = parseDynamicDefinition(row.schema)
    const next = named(parseDynamicDefinition({ name, label: label ?? row.label, fields }))

    const entries = await liveEntries(row.id)
    const dropped = droppedFieldsOf(row.settings)
    const removed = removalsOf(current, next, drop ?? [])

    refuseUnsafeChanges(current, next, entries, dropped)

    const keeping = fieldNames(next)
    // Only what was removed *while values existed* is worth remembering, and a name
    // that is being declared again leaves the list — which only happens when the
    // collection is empty, so there is nothing left under it.
    const remembered = [...new Set([...dropped, ...(entries > 0 ? removed : [])])].filter(
      (field) => !keeping.has(field),
    )

    // Merged, not replaced. `settings` is one JSON column that this command writes one
    // key of, and an unrelated field edit must not take out whatever else is in there —
    // §43's per-collection API exposure is the value that will arrive next.
    await row.update({
      label: next.label,
      schema: next,
      settings: { ...settingsOf(row.settings), dropped: remembered },
    })

    onceCommitted(context, () => {
      withdrawCollection(next.name, row.id)
      installCollection(row.id, next, remembered)
    })

    context.revise({ entityType: SUBJECT, entityId: row.id, before: current, after: next })
    context.emit('collection.updated', { name: next.name })

    return {
      id: row.id,
      name: next.name,
      resource: dynamicResource(next, { id: row.id }).descriptor,
      dropped: removed,
      entries,
      note: removed.length > 0 ? DROPPED_VALUES : LIVE_NOW,
    }
  },
})

export const DeleteCollection = command('collections.delete', {
  description: 'Deletes an empty collection',
  input: { name: definitionSchema.shape.name },
  // Deliberately the one command that acts on a stored definition without needing it
  // to be registered: it is how a collection the parser refuses at boot is got rid of.
  handle: async ({ name }, context) => {
    const row = await storedByName(name)

    if (row === null) throw new NotFoundError('collection', name)

    await context.authorize(SUBJECT, 'delete', row.toJSON())

    const entries = await liveEntries(row.id)

    /**
     * The definition is what makes the JSONB readable, so deleting it while entries
     * exist orphans every one of them.
     *
     * Cascading is the alternative, and it is worse in both available shapes: deleting
     * the rows in one statement takes content out of the application with no revision
     * and no policy check per entry (SPEC.md §14, §64), and deleting them one by one is
     * an unbounded loop inside a request. So this refuses, and `entries.delete` — which
     * is audited, revised and authorized per entry — is how content goes away.
     */
    if (entries > 0) {
      throw new AssemoraError(
        'COLLECTION_NOT_EMPTY',
        `"${name}" holds ${entries} ${entries === 1 ? 'entry' : 'entries'}, and its definition is what makes them readable. Delete them with entries.delete first.`,
        { status: 409 },
      )
    }

    // Already deleted from the application's point of view, and this makes them
    // unrecoverable. Counted so the answer can say so rather than leave it to be found.
    const orphaned = await ResourceEntryModel.where('resourceId', row.id).onlyTrashed().count()
    const before = row.schema

    /**
     * Whether this row is the thing the registries are holding under that name.
     *
     * It is not, whenever the boot loader skipped it — which is exactly when somebody
     * is told to run this command. Then the name belongs to a static resource or to
     * nothing, the withdrawal is a no-op, and the answer must not claim otherwise.
     */
    const registered = collectionByName(name)?.id === row.id

    await row.delete()

    onceCommitted(context, () => {
      withdrawCollection(name, row.id)
    })

    context.revise({ entityType: SUBJECT, entityId: row.id, before, after: null })
    context.emit('collection.deleted', { name })

    return {
      id: row.id,
      name,
      orphanedEntries: orphaned,
      note: `${
        registered
          ? 'Gone from Studio, from what an agent can address and from the API Explorer. If this collection was loaded when the server started, its generated REST paths are still mounted and now answer 404.'
          : `The definition row is gone. It was not registered when this application started, so nothing was withdrawn — whatever answers to "${name}" now is not this collection and is untouched.`
      }${orphaned > 0 ? ` ${orphaned} soft-deleted ${orphaned === 1 ? 'entry' : 'entries'} can no longer be restored.` : ''}`,
    }
  },
})

export type CollectionSummary = {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly fields: number
  readonly api: ApiExposure
}

const summarize = (collection: Collection): CollectionSummary => ({
  id: collection.id,
  name: collection.resource.descriptor.name,
  label: collection.resource.descriptor.label,
  fields: collection.resource.descriptor.fields.length,
  api: collection.resource.descriptor.api,
})

export const ListCollections = query('collections.list', {
  description: 'The collections this application has, and every resource name already taken',
  input: {},
  handle: async () => ({
    // The registry, not the table: a collection is one that actually registered, and a
    // stored definition the parser refused at boot is deliberately not one of them.
    // Unpaginated on purpose — this is the shape of the project, not its content.
    data: registeredCollections()
      .map(summarize)
      .sort((left, right) => left.name.localeCompare(right.name)),
    /**
     * Every resource name in use, collections and source declarations alike.
     *
     * So a screen can refuse a taken name where it is typed rather than after it is
     * submitted, without reimplementing the rule `collections.create` enforces. Static
     * resources are not listed above because they are already in the registry every
     * caller of this reads — `/api/_introspection` and `assemora.describe` both carry
     * them, and a second copy is what the Schema Registry exists to prevent.
     */
    taken: registeredResources()
      .map((resource) => resource.name)
      .sort(),
  }),
})

export const GetCollection = query('collections.get', {
  description: 'One collection: its stored definition, its dropped field names, its entry count',
  input: { name: string() },
  handle: async ({ name }) => {
    const collection = collectionByName(name)

    if (collection === undefined) {
      // Three ways to have no collection under a name, and each of them has a different
      // thing to do about it. Answering "not found" to all three sends somebody looking
      // for a row that is either right there or was never going to exist.
      if (hasResource(name)) {
        throw new AssemoraError(
          'COLLECTION_NOT_FOUND',
          `"${name}" is a resource this application declares in its source, not a collection, so it has no stored definition to read or change.`,
          { status: 404 },
        )
      }

      if ((await storedByName(name)) !== null) {
        throw new AssemoraError('COLLECTION_NOT_REGISTERED', `"${name}" ${SKIPPED}`, {
          status: 409,
        })
      }

      throw new AssemoraError('COLLECTION_NOT_FOUND', `Collection ${name} was not found`, {
        status: 404,
      })
    }

    return {
      id: collection.id,
      resource: collection.resource.descriptor,
      definition: collection.definition,
      /** Names a later field may not take, because their values are still stored. */
      dropped: collection.dropped,
      /**
       * Why an edit may be refused. Above zero, a field's kind, options, slug source
       * and relation target are frozen, and the collection cannot be deleted.
       */
      entries: await liveEntries(collection.id),
    }
  },
})

export const collectionCommands = [CreateCollection, UpdateCollection, DeleteCollection] as const

export const collectionQueries = [ListCollections, GetCollection] as const
