/**
 * CRUD commands (SPEC.md §14, §43, §111).
 *
 * One set of commands serves every resource, static and dynamic alike, and every
 * caller — Studio, REST, the SDK, the CLI and MCP — reaches content through them and
 * through nothing else (SPEC.md §2).
 */
import {
  AssemoraError,
  command,
  currentContext,
  ForbiddenError,
  isLocale,
  NotFoundError,
} from '@assemora/core'
import { UNSPECIFIED_LOCALE } from '@assemora/data'
import { json, string, unknown as unknownSchema, uuid } from '@assemora/schema'

import { refuseUnwritableFields } from './agent-fields.js'
import { resourceByName } from './registry.js'
import { PERSISTENCE } from './resource.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'entry.created': { readonly resource: string; readonly id: unknown }
    'entry.updated': { readonly resource: string; readonly id: unknown }
    'entry.deleted': { readonly resource: string; readonly id: unknown }
    'entry.translated': {
      readonly resource: string
      readonly id: unknown
      readonly translationOf: unknown
      readonly locale: string
    }
  }
}

const refuseWhenDisabled = (
  resource: string,
  allowed: boolean,
  action: 'created' | 'updated' | 'deleted',
): void => {
  if (!allowed) {
    throw new ForbiddenError(`Entries of "${resource}" cannot be ${action}`)
  }
}

export const CreateEntry = command('entries.create', {
  description: 'Creates an entry in a resource',
  input: { resource: string(), data: unknownSchema() },
  // The id is whatever the model's primary key is, which the persistence seam does not
  // narrow; the entry is the row projected to the resource's declared fields.
  output: { id: unknownSchema(), entry: json<Record<string, unknown>>() },
  handle: async ({ resource, data }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.create, 'created')

    const values = target.validate(data, 'create')

    // Between validation and the write: what an agent sent has to be legal for an
    // agent to send, and it must not reach the row before that is settled.
    refuseUnwritableFields(resource, target.writableFields, values, context.actor)

    /**
     * A new entry is written in the language of the operation, and translates nothing
     * (SPEC.md §131).
     *
     * Added after validation rather than declared as fields, because they are not the
     * resource's to declare: an editor does not fill in which language they are typing
     * in, and `translationOf` is how the rows of one entry are tied together. Without
     * this the row would arrive with no language at all, which no read can answer for.
     */
    const written = target[PERSISTENCE].translatable
      ? {
          ...values,
          locale: currentContext()?.locale ?? UNSPECIFIED_LOCALE,
          translationOf: null,
        }
      : values

    const { id, after } = await target[PERSISTENCE].create(written)

    context.revise({
      entityType: resource,
      entityId: String(id),
      before: null,
      after,
    })
    context.emit('entry.created', { resource, id })

    return { id, entry: after }
  },
})

export const UpdateEntry = command('entries.update', {
  description: 'Updates an entry of a resource',
  input: { resource: string(), id: uuid(), data: unknownSchema() },
  output: { id: uuid(), entry: json<Record<string, unknown>>() },
  handle: async ({ resource, id, data }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.update, 'updated')

    const values = target.validate(data, 'update')

    refuseUnwritableFields(resource, target.writableFields, values, context.actor)

    // The record itself decides, and it has to be read before it is written
    // (SPEC.md §51).
    await context.authorize(resource, 'update', await target[PERSISTENCE].load(id))

    const { before, after } = await target[PERSISTENCE].update(id, values)

    context.revise({ entityType: resource, entityId: id, before, after })
    context.emit('entry.updated', { resource, id })

    return { id, entry: after }
  },
})

export const DeleteEntry = command('entries.delete', {
  description: 'Deletes an entry of a resource',
  input: { resource: string(), id: uuid() },
  output: { id: uuid() },
  handle: async ({ resource, id }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.delete, 'deleted')

    await context.authorize(resource, 'delete', await target[PERSISTENCE].load(id))

    const { before } = await target[PERSISTENCE].remove(id)

    context.revise({ entityType: resource, entityId: id, before, after: null })
    context.emit('entry.deleted', { resource, id })

    return { id }
  },
})

export const TranslateEntry = command('entries.translate', {
  description: 'Writes an entry of a resource in another language',
  input: { resource: string(), id: uuid(), locale: string(), data: unknownSchema().optional() },
  output: { id: unknownSchema(), entry: json<Record<string, unknown>>() },
  handle: async ({ resource, id, locale, data }, context) => {
    const target = resourceByName(resource)

    if (!target[PERSISTENCE].translatable) {
      throw new AssemoraError(
        'NOT_TRANSLATABLE',
        `"${resource}" is not translatable. Declare its model with .translatable() first.`,
        { status: 400 },
      )
    }

    // Creating a translation is creating an entry, and a resource that publishes no
    // create publishes no translate either (SPEC.md §43).
    refuseWhenDisabled(resource, target.descriptor.api.create, 'created')

    const served = currentContext()?.locales

    if (!isLocale(served, locale)) {
      throw new AssemoraError(
        'UNKNOWN_LOCALE',
        `"${locale}" is not a language this deployment serves${served === undefined ? '' : ` (${served.locales.join(', ')})`}.`,
        { status: 400 },
      )
    }

    const source = await target[PERSISTENCE].load(id)

    // The record itself decides whether this actor may write it — a translation is a
    // change to the entry, and the entry is what a policy is about (SPEC.md §51).
    await context.authorize(resource, 'update', source)

    /**
     * A translation of a translation is one translation.
     *
     * Without this, translating the Russian row into German would produce a row hanging
     * off the Russian one, and the fallback — which groups by `translationOf` — would
     * see two groups where the site has one entry.
     */
    const original = source.translationOf ?? id

    if (source.locale === locale) {
      throw new AssemoraError(
        'ALREADY_IN_LOCALE',
        `This entry is already written in "${locale}".`,
        { status: 409 },
      )
    }

    const existing = await target[PERSISTENCE].translation(original, locale)

    if (existing !== null) {
      throw new AssemoraError(
        'TRANSLATION_EXISTS',
        `"${resource}" ${String(original)} is already translated into "${locale}". Edit that translation with entries.update on ${String(existing.id)}.`,
        { status: 409 },
      )
    }

    /**
     * The translation starts as a copy and is overlaid with what the caller sent.
     *
     * A translator fills a form that already holds the original, which is the only way
     * a long text is translated at all — and it means a caller who sends one field gets
     * a complete row rather than a row with one field in it.
     */
    const from: Record<string, unknown> = {}

    // The original narrowed to what this resource declares. The stored row also holds
    // `id`, `locale`, `translationOf` and every column the resource does not publish,
    // and handing those to `validate` is asking it to accept fields it exists to refuse.
    for (const field of target.writableFields.keys()) {
      if (Object.hasOwn(source, field)) from[field] = source[field]
    }

    const copied = target.validate({ ...from, ...((data ?? {}) as object) }, 'create')

    refuseUnwritableFields(resource, target.writableFields, copied, context.actor)

    const { id: made, after } = await target[PERSISTENCE].create({
      ...copied,
      locale,
      translationOf: original,
    })

    // Its own history, because a translation is a row and revisions are per row
    // (SPEC.md §131, §64).
    context.revise({ entityType: resource, entityId: String(made), before: null, after })
    context.emit('entry.translated', { resource, id: made, translationOf: original, locale })

    return { id: made, entry: after }
  },
})

/** Every command a resource needs. Registered together with the resources. */
export const entryCommands = [CreateEntry, UpdateEntry, DeleteEntry, TranslateEntry] as const

export { NotFoundError }
