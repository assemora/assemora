/**
 * The one write a layout has, and how a stored one reaches the registry (ADR-0033).
 *
 * `resources.arrange` is generic and addressed by resource name, like `entries.*`
 * (ADR-0012): one command for every resource, one MCP tool, one thing Studio's form
 * screen sends. It validates the layout against the resource's fields with the same
 * check a declaration passes, asks the record before writing, states `expectedVersion`
 * the way the theme and a singleton do (SPEC.md §66), and is a revision with a
 * restorer — so a rearrangement an agent proposed is previewed, applied and undone
 * like any other change.
 *
 * What the registry holds is the *resolved* layout: the stored one when there is one,
 * the declared one otherwise. The command and the boot loader both write it there, and
 * Studio reads the `layouts` section beside `resources` — a section of its own, so
 * arranging a form never touches the resource's entry and nothing derived from that
 * entry (the generated REST paths, for one) is reconciled for a change that is not
 * about it.
 */
import {
  AssemoraError,
  ConflictError,
  command,
  type Logger,
  registerRestorer,
  type SchemaRegistry,
  ValidationError,
} from '@assemora/core'
import { json, number, string, unknown as unknownSchema } from '@assemora/schema'

import { type Layout, type LayoutDescriptor, layoutIssues } from './layout.js'
import { resourceByName } from './registry.js'
import { ResourceLayoutModel } from './system-models.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'resource.arranged': { readonly resource: string; readonly version: number }
  }
}

/** The revision entity type: one restorer for every resource's layout. */
export const LAYOUT_ENTITY = 'resource-layout'

const rowOf = async (resource: string) => ResourceLayoutModel.where('resource', resource).first()

/**
 * Puts the layout in front of the registry: the stored one when given, the declared
 * one otherwise, and nothing when there is neither — in which case Studio derives.
 */
export const rememberLayout = (
  registry: SchemaRegistry,
  resource: string,
  stored: { readonly layout: Layout; readonly version: number } | null,
): void => {
  registry.withdraw('layouts', resource)

  if (stored !== null) {
    registry.register('layouts', {
      name: resource,
      source: 'stored',
      layout: stored.layout,
      version: stored.version,
    })
    return
  }

  const declared = resourceByName(resource).declaredLayout

  if (declared !== undefined) {
    registry.register('layouts', { name: resource, source: 'declared', layout: declared })
  }
}

/**
 * Built with a way to the registry rather than importing one: a command is declared
 * before the application it belongs to exists, and the registry it has to write is
 * that application's. `collectionCommands` takes the same shape for the same reason.
 */
export const arrangeResource = (registry: () => SchemaRegistry) =>
  command('resources.arrange', {
    description:
      'Arranges a resource’s form: tabs, sections and the column beside them. Null puts the declaration back',
    input: {
      resource: string(),
      // `null` is a value here — "back to the declaration" — and `unknown` admits it.
      layout: unknownSchema(),
      expectedVersion: number().integer().optional(),
    },
    output: {
      resource: string(),
      layout: json<Layout>().nullable(),
      version: number().integer(),
    },
    handle: async ({ resource, layout, expectedVersion }, context) => {
      const target = resourceByName(resource)

      if (layout !== null) {
        const issues = layoutIssues(target.descriptor.fields, layout)

        if (issues.length > 0) {
          throw new ValidationError(
            issues.map((issue) => ({ ...issue, path: ['layout', ...issue.path] })),
          )
        }
      }

      const existing = await rowOf(resource)
      const current = existing?.version ?? 0

      // The record decides, and it has to be read before it is written (SPEC.md §51).
      await context.authorize(resource, 'arrange', existing?.toJSON() ?? { resource })

      if (expectedVersion !== undefined && expectedVersion !== current) {
        throw new ConflictError(`The form of "${resource}" has changed since it was read`, {
          expectedVersion,
          currentVersion: current,
        })
      }

      const before = existing?.toJSON() ?? null
      const version = current + 1

      if (layout === null) {
        // Back to the declaration: the row goes, and the version with it, because a
        // form nobody arranged has nothing to state.
        if (existing !== null) await existing.delete()

        rememberLayout(registry(), resource, null)
        context.revise({ entityType: LAYOUT_ENTITY, entityId: resource, before, after: null })
        context.emit('resource.arranged', { resource, version: 0 })

        return { resource, layout: null, version: 0 }
      }

      const arranged = layout as Layout
      const row =
        existing === null
          ? await ResourceLayoutModel.create({
              resource,
              layout: arranged,
              version,
              updatedBy: context.actor?.id ?? null,
            })
          : await (async () => {
              await existing.update({
                layout: arranged,
                version,
                updatedBy: context.actor?.id ?? null,
              })

              return existing
            })()

      rememberLayout(registry(), resource, { layout: arranged, version })
      context.revise({ entityType: LAYOUT_ENTITY, entityId: resource, before, after: row.toJSON() })
      context.emit('resource.arranged', { resource, version })

      return { resource, layout: arranged, version }
    },
  })

export const layoutCommands = (registry: () => SchemaRegistry) =>
  [arrangeResource(registry)] as const

/**
 * The stored layouts, put in front of the registry at boot.
 *
 * Tolerates its own table not existing — `assemora db:generate` boots to read the
 * registry before the migration that creates the table has been written — and nothing
 * wider (the reasoning is `loadCollections`'s). A layout that names a resource the
 * application no longer declares is skipped with a warning: the row is somebody's
 * work, and the resource may come back.
 */
export const loadLayouts = async (
  registry: SchemaRegistry,
  logger: Logger,
): Promise<{ readonly loaded: readonly string[]; readonly pending: boolean }> => {
  let rows: readonly { resource: string; layout: Layout; version: number }[]

  try {
    rows = await ResourceLayoutModel.all()
  } catch (error) {
    if (error instanceof AssemoraError && error.code === 'SCHEMA_NOT_APPLIED') {
      return { loaded: [], pending: true }
    }
    throw error
  }

  const loaded: string[] = []

  for (const row of rows) {
    try {
      resourceByName(row.resource)
    } catch {
      logger.warn('A stored form layout names a resource this application does not declare', {
        resource: row.resource,
      })
      continue
    }

    const issues = layoutIssues(resourceByName(row.resource).descriptor.fields, row.layout)

    if (issues.length > 0) {
      // The fields moved under it — a column renamed, a field hidden. The declaration
      // is drawn instead, and the row stays for whoever arranges the form next.
      logger.warn('A stored form layout no longer fits its resource and was not applied', {
        resource: row.resource,
        issues: issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      })
      continue
    }

    rememberLayout(registry, row.resource, { layout: row.layout, version: row.version })
    loaded.push(row.resource)
  }

  return { loaded, pending: false }
}

/** How a layout goes back to an earlier state, or to the declaration (SPEC.md §65). */
export const registerLayoutRestorer = (registry: () => SchemaRegistry): void => {
  registerRestorer(LAYOUT_ENTITY, async (resource, state) => {
    const existing = await rowOf(resource)
    const replaced = existing === null ? null : existing.toJSON()

    if (state === null || state === undefined) {
      if (existing !== null) await existing.delete()
      rememberLayout(registry(), resource, null)

      return { replaced, version: 0 }
    }

    const snapshot = state as { readonly layout?: unknown }
    const layout = (snapshot.layout ?? { sections: [] }) as Layout

    if (existing === null) {
      const recreated = await ResourceLayoutModel.create({
        resource,
        layout,
        version: 1,
        updatedBy: null,
      })

      rememberLayout(registry(), resource, { layout, version: 1 })

      return { replaced, version: recreated.version }
    }

    const version = existing.version + 1

    await existing.update({ layout, version })
    rememberLayout(registry(), resource, { layout, version })

    return { replaced, version }
  })
}

export type { LayoutDescriptor }
