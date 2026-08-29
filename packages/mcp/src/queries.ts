/**
 * What an agent can ask about the project itself (SPEC.md §69, §71).
 *
 * These are queries, not a private API. That is the whole point: they pass the Query
 * Bus, so they are authorized like any other read and audited like any other read
 * (SPEC.md §76). An agent asking what exists is an action, and actions are recorded.
 *
 * They read the Schema Registry as plain data. `@assemora/mcp` depends on `schema`
 * and `core` and nothing else, so it cannot see a `ResourceDescriptor` as a type —
 * which is right for something that passes descriptions through without
 * interpreting them (ADR-0020).
 */
import { NotFoundError, query, type SchemaRegistry } from '@assemora/core'
import { string } from '@assemora/schema'

/** A registry entry, as this package is able to see one. */
type Entry = Readonly<Record<string, unknown>>

const named = (entry: unknown): string => String((entry as Entry).name ?? '')

/**
 * What this application can actually do, from what it registered.
 *
 * An agent should not have to guess whether pages exist by calling something and
 * seeing it fail.
 */
const capabilitiesOf = (sections: Readonly<Record<string, readonly Entry[]>>): string[] => {
  const names = new Set([
    ...(sections.commands ?? []).map(named),
    ...(sections.queries ?? []).map(named),
  ])

  const has = (prefix: string) => [...names].some((name) => name.startsWith(prefix))

  return [
    ...(has('entries.') ? ['content'] : []),
    ...(has('pages.') ? ['pages'] : []),
    ...(has('blocks.') ? ['blocks'] : []),
    ...(has('media.') ? ['media'] : []),
    ...(has('revisions.') ? ['revisions'] : []),
    ...(has('changesets.') ? ['change-sets'] : []),
    ...(has('audit.') ? ['audit'] : []),
    ...(has('auth.') ? ['users'] : []),
  ]
}

export type McpQueryOptions = {
  /**
   * The registry, resolved when a query runs rather than when it is declared.
   *
   * A module is built before the application it belongs to exists, so asking for
   * the registry up front would mean building the application twice.
   */
  readonly registry: () => SchemaRegistry
  /** Shown to an agent so it knows which project it is looking at. */
  readonly project?: { readonly name?: string; readonly description?: string }
}

export const mcpQueries = (options: McpQueryOptions) => {
  const sections = (): Readonly<Record<string, readonly Entry[]>> =>
    options.registry().describe() as Readonly<Record<string, readonly Entry[]>>

  /**
   * SPEC.md §71 — the key AI endpoint.
   *
   * Everything the project declares, in one answer, so an agent understands the
   * structure without reading the codebase.
   */
  const Describe = query('assemora.describe', {
    description: 'Everything this project declares: models, resources, blocks, commands, queries',
    input: {},
    handle: async () => {
      const all = sections()

      return {
        project: {
          name: options.project?.name ?? 'Assemora application',
          description: options.project?.description ?? null,
        },
        capabilities: capabilitiesOf(all),
        models: all.models ?? [],
        resources: all.resources ?? [],
        // The page model as the registry holds it. An agent works with pages through
        // the `pages.*` and `blocks.*` tools, which are in `commands`.
        pages: (all.models ?? []).filter((model) => named(model) === 'assemora_pages'),
        blocks: all.blocks ?? [],
        commands: all.commands ?? [],
        queries: all.queries ?? [],
        // A command name is a permission name (ADR-0015), so the set of things an
        // actor can be granted is the set of things it can be asked to do.
        permissions: [
          ...new Set([...(all.commands ?? []), ...(all.queries ?? [])].map(named).filter(Boolean)),
        ].sort(),
        // The languages this deployment serves, read from the registry like everything
        // else here (SPEC.md §131). Empty for an application in one language, which is
        // what it always answered.
        locales: all.locales ?? [],
      }
    },
  })

  const ListResources = query('assemora.resources.list', {
    description: 'The resources this project declares, by name',
    input: {},
    handle: async () =>
      (sections().resources ?? []).map((resource) => ({
        name: named(resource),
        label: resource.label ?? named(resource),
        kind: resource.kind ?? 'static',
      })),
  })

  const DescribeResource = query('assemora.resources.describe', {
    description: 'One resource in full: every field, and what may be done with it',
    input: { name: string().min(1) },
    handle: async ({ name }) => {
      const found = (sections().resources ?? []).find((resource) => named(resource) === name)

      if (found === undefined) throw new NotFoundError('resource', name)

      return found
    },
  })

  const BlockTypes = query('assemora.blocks.types', {
    description: 'The block types a page can be assembled from (SPEC.md §55, §56)',
    input: {},
    handle: async () => sections().blocks ?? [],
  })

  return [Describe, ListResources, DescribeResource, BlockTypes] as const
}
