/**
 * Query Bus (SPEC.md §11, §15).
 *
 * Reads never travel the Command Bus and never cause side effects. They still pass
 * validation and authorization, because SPEC.md §51 gives a policy a `read` rule and
 * an agent must not be able to read what a person could not.
 */
import { type InferShape, object, type Schema, type Shape } from '@assemora/schema'

import { type AssemoraContext, contextOrInternal } from './context.js'
import { UnknownQueryError, ValidationError } from './errors.js'
import type { Logger } from './logger.js'
import type { AuthorizationPort } from './ports.js'
import type { SchemaRegistry } from './registry.js'

export type QueryContext = AssemoraContext & {
  readonly logger: Logger
  /**
   * Asks whether the actor may read this particular subject (SPEC.md §51).
   *
   * A query whose input names what it reads — the history of *that* page, the entries
   * of *that* resource — has to ask a second time, because the first check only knew
   * the query's own name. Without it, one permission would open every entity the
   * query can be pointed at.
   */
  authorize(subject: string, action: string, record?: unknown): Promise<void>
}

export type QueryDefinition<S extends Shape, R> = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<InferShape<S>>
  handle(input: InferShape<S>, context: QueryContext): Promise<R>
}

export type AnyQuery = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  handle(input: never, context: QueryContext): Promise<unknown>
}

/** How a query describes itself in the Schema Registry. */
export type QueryDescriptor = {
  readonly name: string
  readonly description?: string
  readonly input: ReturnType<Schema<unknown>['toJsonSchema']>
  readonly module?: string
}

declare module './registry.js' {
  interface RegistrySections {
    queries: QueryDescriptor
  }
}

/**
 * ```ts
 * export const ListEntries = query('entries.list', {
 *   input: { resource: string() },
 *   handle: async ({ resource }) => resourceByName(resource).list(),
 * })
 * ```
 */
export const query = <S extends Shape, R>(
  name: string,
  definition: {
    readonly input: S
    readonly description?: string
    handle(input: InferShape<S>, context: QueryContext): Promise<R>
  },
): QueryDefinition<S, R> => ({
  name,
  description: definition.description,
  input: object(definition.input),
  handle: definition.handle,
})

export type QueryBus = {
  register(definition: AnyQuery, module?: string): void
  execute<S extends Shape, R>(definition: QueryDefinition<S, R>, input: unknown): Promise<R>
  execute(name: string, input: unknown): Promise<unknown>
  has(name: string): boolean
  names(): readonly string[]
}

export type QueryBusOptions = {
  readonly authorization: AuthorizationPort
  readonly registry: SchemaRegistry
  readonly logger: Logger
}

export const createQueryBus = (options: QueryBusOptions): QueryBus => {
  const registered = new Map<string, AnyQuery>()

  const run = async (definition: AnyQuery, rawInput: unknown): Promise<unknown> => {
    const context = contextOrInternal()
    const parsed = definition.input.parse(rawInput)

    if (!parsed.ok) throw new ValidationError(parsed.issues)

    await options.authorization.authorize({
      command: definition.name,
      input: parsed.value,
      context,
    })

    return (definition.handle as (input: unknown, context: QueryContext) => Promise<unknown>)(
      parsed.value,
      {
        ...context,
        logger: options.logger.child({ query: definition.name }),
        authorize: async (subject, action, record) => {
          await options.authorization.authorizeRecord?.({ subject, action, record, context })
        },
      },
    )
  }

  const bus: QueryBus = {
    register(definition, module) {
      registered.set(definition.name, definition)

      options.registry.register('queries', {
        name: definition.name,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        input: definition.input.toJsonSchema(),
        ...(module === undefined ? {} : { module }),
      })
    },

    execute(target: AnyQuery | string, input: unknown): Promise<never> {
      if (typeof target !== 'string') return run(target, input) as Promise<never>

      const definition = registered.get(target)
      if (definition === undefined) throw new UnknownQueryError(target)

      return run(definition, input) as Promise<never>
    },

    has: (name) => registered.has(name),
    names: () => [...registered.keys()],
  }

  return bus
}
