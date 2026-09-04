/**
 * The one read and the one write a singleton has (SPEC.md §14, §135).
 *
 * Generic and addressed by name, the way `entries.*` are (ADR-0012): `singletons.get`
 * and `singletons.update` serve every singleton, so an application with three of them
 * has two tools an agent can call rather than six, and Studio's settings screen has
 * one command to send whichever group changed.
 */
import {
  type CommandContext,
  ConflictError,
  command,
  query,
  registerRestorer,
} from '@assemora/core'
import { json, number, string, unknown as unknownSchema } from '@assemora/schema'

import { readableByActor, refuseUnwritableFields } from './agent-fields.js'
import { type Singleton, singletonByName } from './singleton.js'
import { SingletonModel } from './system-models.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'singleton.updated': { readonly name: string; readonly version: number }
  }
}

type Row = {
  readonly values: Record<string, unknown>
  readonly version: number
  readonly updatedAt: Date | string | null
}

/** The stored row, or what an unwritten singleton is: nothing, at version 0. */
const rowOf = async (name: string) => SingletonModel.where('name', name).first()

/** The values an actor may read, and only the declared fields (SPEC.md §76). */
const project = (
  target: Singleton,
  values: Readonly<Record<string, unknown>>,
  actor: CommandContext['actor'],
): Record<string, unknown> => {
  const projected: Record<string, unknown> = {}

  for (const [fieldName, field] of target.fields) {
    if (field.isHidden || !readableByActor(field, actor)) continue
    if (Object.hasOwn(values, fieldName)) projected[fieldName] = values[fieldName]
  }

  return projected
}

const stamp = (row: Row | null): string | null =>
  row === null || row.updatedAt === null
    ? null
    : row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : String(row.updatedAt)

export const GetSingleton = query('singletons.get', {
  description: 'Reads a singleton: its values, and the version a write must state',
  input: { name: string() },
  output: {
    name: string(),
    values: json<Record<string, unknown>>(),
    version: number().integer(),
    updatedAt: string().nullable(),
  },
  handle: async ({ name }, context) => {
    const target = singletonByName(name)
    const row = await rowOf(name)

    // The second question a read asks (ADR-0015): the permission was `singletons.get`,
    // and this is whether *this* singleton may be read by this actor.
    await context.authorize(name, 'read', row?.toJSON() ?? { name })

    return {
      name,
      values: project(target, row?.values ?? {}, context.actor),
      version: row?.version ?? 0,
      updatedAt: stamp(row),
    }
  },
})

export const UpdateSingleton = command('singletons.update', {
  description: 'Writes some or all of a singleton’s values; the version it read guards the write',
  input: {
    name: string(),
    values: unknownSchema(),
    expectedVersion: number().integer().optional(),
  },
  output: {
    name: string(),
    values: json<Record<string, unknown>>(),
    version: number().integer(),
  },
  handle: async ({ name, values, expectedVersion }, context) => {
    const target = singletonByName(name)
    const checked = target.validate(values)

    refuseUnwritableFields(name, target.fields, checked, context.actor)

    const existing = await rowOf(name)
    const current = existing?.version ?? 0

    // The record decides, and it has to be read before it is written (SPEC.md §51).
    await context.authorize(name, 'update', existing?.toJSON() ?? { name })

    // A caller who said which version they were editing is told when it has moved
    // (SPEC.md §66); one who said nothing writes over whatever is there.
    if (expectedVersion !== undefined && expectedVersion !== current) {
      throw new ConflictError(`"${name}" has changed since it was read`, {
        expectedVersion,
        currentVersion: current,
      })
    }

    const before = existing?.toJSON() ?? null
    const merged = { ...(existing?.values ?? {}), ...checked }
    const version = current + 1

    const row =
      existing === null
        ? await SingletonModel.create({
            name,
            values: merged,
            version,
            updatedBy: context.actor?.id ?? null,
          })
        : await (async () => {
            await existing.update({ values: merged, version, updatedBy: context.actor?.id ?? null })

            return existing
          })()

    context.revise({ entityType: name, entityId: name, before, after: row.toJSON() })
    context.emit('singleton.updated', { name, version })

    return { name, values: project(target, merged, context.actor), version }
  },
})

/**
 * The row, for an application's own read.
 *
 * A storefront needs a public answer shaped for a visitor — the telephone, the hours —
 * and `singletons.get` is a query with a permission a stranger does not hold. So an
 * application declares a query of its own and reads the row here, the way `menu.list`
 * reads the dishes. Hidden fields are left out, as in every read; there is no write
 * beside this on purpose — `singletons.update` is the one, and it is what keeps the
 * row validated, authorized, revised and versioned (ADR-0032).
 */
export const readSingleton = async (
  name: string,
): Promise<{
  readonly name: string
  readonly values: Readonly<Record<string, unknown>>
  readonly version: number
  readonly updatedAt: string | null
}> => {
  const target = singletonByName(name)
  const row = await rowOf(name)

  return {
    name,
    values: project(target, row?.values ?? {}, undefined),
    version: row?.version ?? 0,
    updatedAt: stamp(row),
  }
}

export const singletonCommands = [UpdateSingleton] as const
export const singletonQueries = [GetSingleton] as const

/**
 * How a singleton goes back to an earlier state (SPEC.md §65).
 *
 * `null` is the state before the first write — no row — and undoing the first write
 * has to be able to reach it. The row is put back under the name it always had, so a
 * restore never leaves a revision pointing at nothing.
 */
export const registerSingletonRestorer = (name: string): void => {
  registerRestorer(name, async (_entityId, state) => {
    const existing = await rowOf(name)
    const replaced = existing === null ? null : existing.toJSON()

    if (state === null || state === undefined) {
      if (existing !== null) await existing.delete()

      return { replaced, version: 0 }
    }

    const snapshot = state as { readonly values?: unknown }
    const values = (snapshot.values ?? {}) as Record<string, unknown>

    if (existing === null) {
      const recreated = await SingletonModel.create({ name, values, version: 1, updatedBy: null })

      return { replaced, version: recreated.version }
    }

    const version = existing.version + 1

    await existing.update({ values, version })

    return { replaced, version }
  })
}
