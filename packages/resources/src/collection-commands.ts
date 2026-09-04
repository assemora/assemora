/**
 * Making a collection (SPEC.md §37, §38, §86).
 *
 * These are the commands behind "a user must be able to create a collection through
 * Studio or AI without changing source code". They go through the Command Bus like
 * everything else, so they are MCP tools by generation (ADR-0020), an agent's proposal
 * is applied by a person (SPEC.md §75), and the definition they store is checked by
 * `parseDynamicDefinition` — declarative JSON, registered field kinds, nothing else.
 *
 * Every answer says where the collection can be reached, because "made in Studio" and
 * "written in TypeScript" have to produce the same resource for §37 to mean anything.
 */
import {
  AssemoraError,
  type CommandContext,
  command,
  generatedCrudPrefix,
  NotFoundError,
  query,
  ValidationError,
} from '@assemora/core'
import type { Issue } from '@assemora/schema'
import { array, boolean, json, number, object, string, uuid } from '@assemora/schema'

import {
  type Collection,
  collectionByName,
  droppedFieldsOf,
  installCollection,
  refuseTakenName,
  registeredCollections,
  withdrawCollection,
} from './collections.js'
import { apiExposureOf, collectionDefinitionSchema } from './definition.js'
import { type ApiExposure, humanize, type ResourceDescriptor } from './descriptor.js'
import {
  type DynamicDefinition,
  dynamicResource,
  parseDeclaredDefinition,
  parseDynamicDefinition,
} from './dynamic.js'
import type { FieldShapeSpec, FieldSpec } from './field-registry.js'
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
 * The `entries.*` operations a resource's `api` flags leave open (SPEC.md §43).
 *
 * The flags are enforced in `entries.*` themselves and not only where the REST paths
 * are generated, exactly as they are for a resource declared in source: a collection
 * with `create: false` has no create operation, wherever it is asked for. So this list
 * is the whole of what can be done to its entries, through any door.
 */
const operationsOf = (api: ApiExposure): readonly string[] => [
  ...(api.create ? ['entries.create'] : []),
  ...(api.update ? ['entries.update'] : []),
  ...(api.delete ? ['entries.delete'] : []),
  ...(api.read ? ['entries.list', 'entries.get'] : []),
]

/**
 * What a collection can be reached through the moment it is made.
 *
 * CRUD is addressed by resource name rather than by route (ADR-0012), so the commands,
 * the queries, Studio and the MCP tools — which are one generic set, not one per
 * resource — carry a new collection immediately, and so does the API Explorer, which
 * hands back the registry as it stands.
 *
 * So do the generated REST paths of SPEC.md §43, which used to be the one thing that
 * did not: they are Fastify routes, a started server takes no new route, and
 * `/api/<name>` therefore answered 404 for the life of the process. `@assemora/http`
 * now serves them through one parameterised pair of endpoints that dispatches by name,
 * and keeps the routes section of the Schema Registry level with the resources section
 * — so `/api/openapi.json` carries this collection as a path as well as a component
 * schema, and the generated SDK does too.
 */
const liveNow = (api: ApiExposure): string => {
  const open = operationsOf(api)

  return open.length === 0
    ? 'It has no operations at all: its api option switches every one off (SPEC.md §43), so nothing can read or write its entries — not Studio, not an agent over MCP, not a REST caller. That is almost certainly not what was meant.'
    : `Reachable now through ${open.join(', ')}, so Studio, an agent over MCP and the API Explorer already have it.`
}

/** The five addresses a resource's `api` flags publish, written the way a caller reads them. */
const addressesOf = (name: string, api: ApiExposure): readonly string[] => [
  ...(api.read ? [`GET /${name}`, `GET /${name}/:id`] : []),
  ...(api.create ? [`POST /${name}`] : []),
  ...(api.update ? [`PATCH /${name}/:id`] : []),
  ...(api.delete ? [`DELETE /${name}/:id`] : []),
]

/** The addresses a definition publishes, as one string, so "did they change" is one ===. */
const exposureOf = (definition: DynamicDefinition): string =>
  addressesOf(definition.name, apiExposureOf(definition.api)).join(' ')

/**
 * What an application that publishes no generated CRUD has to say instead.
 *
 * Both halves are worth saying. The reader is being told that the addresses they might
 * reasonably go looking for do not exist, and that the obvious workaround is not one:
 * a version publishes the resources named in the callback that declared it, and a
 * collection made afterwards was never in that callback (SPEC.md §47).
 */
const NO_GENERATED_REST =
  'This application publishes no generated REST paths at all — it was built with api: { crud: false }, or this process serves no HTTP (SPEC.md §43) — so the collection has none of its own, and no version can give it one: a version carries the resources named when it was declared (SPEC.md §47).'

/**
 * Which REST paths this collection has, and which it deliberately has not.
 *
 * Written out rather than promised in general, because the `api` flags are the answer
 * to "what did I just publish" and a sentence that describes the default would be wrong
 * for exactly the collection that said something else (SPEC.md §43).
 *
 * The flags decide *which* of the five addresses exist. Whether any of them exist is a
 * different question and not this package's to answer: it is the server that publishes
 * generated CRUD, and an application is allowed to publish none. Built from the flags
 * alone, this sentence promised five addresses that answered Fastify's bare 404 in every
 * application built with `api: { crud: false }` — and it is a command, so an MCP tool, so
 * an agent read it and called them.
 */
const restNow = (name: string, api: ApiExposure): string => {
  const prefix = generatedCrudPrefix()

  if (prefix === undefined) return NO_GENERATED_REST

  const published = addressesOf(name, api)
  const withheld = addressesOf(name, {
    create: !api.create,
    read: !api.read,
    update: !api.update,
    delete: !api.delete,
  })

  if (published.length === 0) return `Every ${prefix}/${name} address answers 404.`

  // The prefix is named rather than alluded to — "under this API prefix" told a caller
  // nothing it could act on — and the description is credited to the Schema Registry
  // rather than to `/api/openapi.json`, because an application may serve no document at
  // all (`documentation: false`) and the description is there either way. It is what all
  // three of them are generated from.
  return `Its generated REST paths answer straight away as well — ${published.join(', ')}, below ${prefix} — and they are described in the Schema Registry, which ${prefix}/openapi.json, the API Explorer and the generated SDK are generated from. No restart.${
    withheld.length === 0
      ? ''
      : ` It has no ${withheld.join(', ')}: those addresses answer 404 and are in no document, for a collection exactly as for a resource written in TypeScript (SPEC.md §43).`
  }`
}

/**
 * What deleting took away over REST, which is nothing at all in some applications.
 *
 * The mirror of `restNow`, and wrong in the same way before this: an application that
 * publishes no generated CRUD had nothing to withdraw, and a note saying its addresses
 * "are no longer described" named a document that never described them.
 */
const restGone = (): string => {
  const prefix = generatedCrudPrefix()

  return prefix === undefined
    ? ' It had no generated REST paths: this application publishes none.'
    : ` Its generated REST paths under ${prefix} now answer 404, and the Schema Registry no longer describes them, so neither does ${prefix}/openapi.json, the API Explorer or the generated SDK.`
}

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
 * searchable, filterable, hidden, read-only, agent access — changes freely. So does the
 * collection's `api`: which endpoints exist says nothing about what is stored.
 *
 * An empty collection is where people actually fix a wrong choice, and there is nothing
 * to convert, so nothing is refused there.
 */
const plural = (entries: number): string => `${entries} ${entries === 1 ? 'entry' : 'entries'}`

/**
 * The same rule, applied inside a group or a repeater.
 *
 * A group's values are stored in the entry's JSONB under the group's own name, so an
 * inner field's kind decides what is stored there exactly as an outer field's kind
 * decides what is stored at the top. Removing one is worse than removing a top-level
 * field, not better: `object()` keeps only the keys its shape mentions, so the value
 * would not merely stop being readable — the next ordinary save of the entry would
 * delete it. `drop` names a collection's own fields and has no way to name this one, so
 * a nested removal is refused outright while entries exist.
 *
 * Adding an inner field stays free, exactly as adding a top-level one is: stored values
 * simply do not have it yet.
 */
const insideIssues = (
  before: FieldShapeSpec,
  next: FieldShapeSpec,
  path: readonly (string | number)[],
  where: string,
  entries: number,
): Issue[] => {
  const issues: Issue[] = []
  const kept = new Map((next.fields ?? []).map((field) => [field.name, field]))

  for (const field of before.fields ?? []) {
    const still = kept.get(field.name)

    if (still === undefined) {
      issues.push({
        path: [...path, 'fields'],
        code: 'nested_field_removed',
        message: `"${field.name}" is a field of "${where}" and ${plural(entries)} hold values under it. A nested field cannot be removed while the collection holds entries — the next save of an entry would delete the value rather than leave it behind, and "drop" names a collection's own fields only. Empty the collection first.`,
      })
      continue
    }

    issues.push(
      ...frozenIssues(field, still, [...path, 'fields'], `${where}.${field.name}`, entries),
    )
  }

  return before.element === undefined || next.element === undefined
    ? issues
    : [
        ...issues,
        ...frozenIssues(
          before.element,
          next.element,
          [...path, 'element'],
          `${where}.element`,
          entries,
        ),
      ]
}

/** What a nested field may not change about itself. The outer loop's rules, one level in. */
const frozenIssues = (
  before: FieldShapeSpec,
  next: FieldShapeSpec,
  path: readonly (string | number)[],
  where: string,
  entries: number,
): Issue[] => {
  if (before.kind !== next.kind) {
    // Nothing below is worth comparing once the two are different shapes.
    return [
      {
        path,
        code: 'kind_frozen',
        message: `"${where}" is stored as ${before.kind} in ${plural(entries)}, so it cannot become ${next.kind}. Empty the collection first, or add a new field under another name.`,
      },
    ]
  }

  const issues: Issue[] = []

  if (before.source !== next.source) {
    issues.push({
      path,
      code: 'source_frozen',
      message: `"${where}" derives from "${before.source}" in stored entries, so its source cannot change while the collection holds entries.`,
    })
  }

  if (before.target !== next.target) {
    issues.push({
      path,
      code: 'target_frozen',
      message: `"${where}" points at "${before.target}" in stored entries, so its target cannot change while the collection holds entries.`,
    })
  }

  const offered = new Set(next.options ?? [])
  const lost = (before.options ?? []).filter((option) => !offered.has(option))

  if (lost.length > 0) {
    issues.push({
      path,
      code: 'options_frozen',
      message: `"${where}" can gain options while the collection holds entries, but not lose ${lost.map((option) => `"${option}"`).join(', ')} — an entry may hold one.`,
    })
  }

  return [...issues, ...insideIssues(before, next, path, where, entries)]
}

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

    // Only once the two are the same kind: an `object` compared against an `array` has
    // already been refused above, and comparing their insides would say so twice.
    if (before.kind === field.kind) {
      issues.push(...insideIssues(before, field, ['fields', index], field.name, entries))
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
    name: collectionDefinitionSchema.shape.name,
    label: collectionDefinitionSchema.shape.label,
    icon: collectionDefinitionSchema.shape.icon,
    fields: collectionDefinitionSchema.shape.fields,
    /**
     * Which CRUD operations this collection has (SPEC.md §43).
     *
     * Untrusted data like everything else here: four booleans, parsed. Left out, it has
     * all four — the same default `resource(Article, fields)` has. This is the half of
     * equal rights that was missing: a collection could already do everything a static
     * resource could, and could not do less.
     */
    api: collectionDefinitionSchema.shape.api,
  },
  // The resource is its registry description, handed on as the registry holds it.
  output: {
    id: uuid(),
    name: string(),
    resource: json<ResourceDescriptor>(),
    note: string(),
  },
  handle: async ({ name, label, icon, fields, api }, context) => {
    // Everything goes through the parser, whatever the bus already checked. It is the
    // one place that knows a field kind has to be registered, and the one place §86 is
    // enforced — a second door into a stored definition is a second door round it.
    const definition = named(parseDeclaredDefinition({ name, label, icon, fields, api }))

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

    const descriptor = dynamicResource(definition, { id: row.id }).descriptor

    return {
      id: row.id,
      name: definition.name,
      resource: descriptor,
      note: `${liveNow(descriptor.api)} ${restNow(definition.name, descriptor.api)}`,
    }
  },
})

export const UpdateCollection = command('collections.update', {
  description: 'Changes a collection: its label, its icon, and the fields it declares',
  input: {
    name: collectionDefinitionSchema.shape.name,
    label: collectionDefinitionSchema.shape.label,
    icon: collectionDefinitionSchema.shape.icon,
    fields: collectionDefinitionSchema.shape.fields,
    /**
     * Which CRUD operations this collection has (SPEC.md §43).
     *
     * Left out it keeps whatever is stored, the way `label` does — and for a stronger
     * reason than symmetry. Studio's editor does not send this in v1, so an absent
     * `api` meaning "all four" would have every save of a restricted collection quietly
     * hand it back the operations somebody deliberately took away. Widening is a thing
     * a caller has to say.
     */
    api: collectionDefinitionSchema.shape.api,
    /**
     * Every field this update removes, named. Anything removed and not named here is
     * refused, because the values stay behind in every entry.
     */
    drop: array(string()).optional(),
  },
  output: {
    id: uuid(),
    name: string(),
    resource: json<ResourceDescriptor>(),
    dropped: array(string()),
    entries: number(),
    note: string(),
  },
  handle: async ({ name, label, icon, fields, api, drop }, context) => {
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

    // The stored side with the parser that reads rows back, the caller's side with the
    // one that judges a declaration. A row written before a declaration rule existed
    // still has to load, or an edit could never be the thing that fixes it.
    const current = parseDynamicDefinition(row.schema)
    const next = named(
      parseDeclaredDefinition({
        name,
        label: label ?? row.label,
        // Left out it keeps what is stored, the way `label` and `api` do. There is no
        // way to say "no icon" — the name pattern refuses an empty string — and that is
        // the honest state rather than a second value meaning absence nobody asked for.
        icon: icon ?? current.icon,
        fields,
        api: api ?? current.api,
      }),
    )

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
    // key of, and an unrelated field edit must not take out whatever else is in there.
    // §43's API exposure is part of the definition rather than a setting, because it is
    // something the caller declares and not something this command remembers for them.
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

    const descriptor = dynamicResource(next, { id: row.id }).descriptor
    // Only when it changed. A note that repeats the REST surface on every field edit is
    // a note nobody finishes reading, and this one is worth reading: a narrowed
    // exposure takes an address out of /api/openapi.json and out of service at once.
    const exposure =
      exposureOf(current) === exposureOf(next) ? '' : ` ${restNow(next.name, descriptor.api)}`

    return {
      id: row.id,
      name: next.name,
      resource: descriptor,
      dropped: removed,
      entries,
      note: `${removed.length > 0 ? DROPPED_VALUES : liveNow(descriptor.api)}${exposure}`,
    }
  },
})

export const DeleteCollection = command('collections.delete', {
  description: 'Deletes an empty collection',
  input: { name: collectionDefinitionSchema.shape.name },
  output: { id: uuid(), name: string(), orphanedEntries: number(), note: string() },
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
          ? `Gone from Studio, from what an agent can address and from the API Explorer.${restGone()}`
          : `The definition row is gone. It was not registered when this application started, so nothing was withdrawn — whatever answers to "${name}" now is not this collection and is untouched.`
      }${orphaned > 0 ? ` ${orphaned} soft-deleted ${orphaned === 1 ? 'entry' : 'entries'} can no longer be restored.` : ''}`,
    }
  },
})

export type CollectionSummary = {
  readonly id: string
  readonly name: string
  readonly label: string
  /** What it is drawn as, so a list of collections looks like the sidebar does. */
  readonly icon?: string
  readonly fields: number
  readonly api: ApiExposure
}

const summarize = (collection: Collection): CollectionSummary => ({
  id: collection.id,
  name: collection.resource.descriptor.name,
  label: collection.resource.descriptor.label,
  ...(collection.resource.descriptor.icon === undefined
    ? {}
    : { icon: collection.resource.descriptor.icon }),
  fields: collection.resource.descriptor.fields.length,
  api: collection.resource.descriptor.api,
})

export const ListCollections = query('collections.list', {
  description: 'The collections this application has, and every resource name already taken',
  input: {},
  output: {
    data: array(
      object({
        id: uuid(),
        name: string(),
        label: string(),
        icon: string().optional(),
        fields: number(),
        api: object({ create: boolean(), read: boolean(), update: boolean(), delete: boolean() }),
      }),
    ),
    taken: array(string()),
  },
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
  // The definition is the document a declaration is parsed from, so it is described by
  // the same schema; the resource is what the registry made of it.
  output: {
    id: uuid(),
    resource: json<ResourceDescriptor>(),
    definition: collectionDefinitionSchema,
    dropped: array(string()),
    entries: number(),
  },
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
