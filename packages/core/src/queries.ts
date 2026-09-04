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
import { type InferOutput, type Output, outputSchema } from './output.js'
import {
  type AuditPort,
  type AuthorizationPort,
  captureError,
  type ErrorReporting,
  type ErrorTrackingPort,
  logErrors,
} from './ports.js'
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
  /** What it answers with, when it said. See `output.ts`. */
  readonly output: Schema<R> | undefined
  handle(input: InferShape<S>, context: QueryContext): Promise<R>
}

export type AnyQuery = {
  readonly name: string
  readonly description: string | undefined
  readonly input: Schema<unknown>
  readonly output: Schema<unknown> | undefined
  handle(input: never, context: QueryContext): Promise<unknown>
}

/** How a query describes itself in the Schema Registry. */
export type QueryDescriptor = {
  readonly name: string
  readonly description?: string
  readonly input: ReturnType<Schema<unknown>['toJsonSchema']>
  /** Absent when the query did not say what it answers with. */
  readonly output?: ReturnType<Schema<unknown>['toJsonSchema']>
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
 *   output: array(json()),
 *   handle: async ({ resource }) => resourceByName(resource).list(),
 * })
 * ```
 *
 * `output` types the handler and documents the endpoint, exactly as it does for a
 * command; see `output.ts`.
 */
/*
 * The overload without an output is listed first, and it is not the order the
 * documentation reads in: the compiler reports the *last* overload's error, and the
 * error that matters is "the handler does not answer what the output promises", not
 * "the output is not undefined".
 */
export function query<S extends Shape, R>(
  name: string,
  definition: {
    readonly input: S
    readonly output?: undefined
    readonly description?: string
    handle(input: InferShape<S>, context: QueryContext): Promise<R>
  },
): QueryDefinition<S, R>
export function query<S extends Shape, O extends Output>(
  name: string,
  definition: {
    readonly input: S
    readonly output: O
    readonly description?: string
    handle(input: InferShape<S>, context: QueryContext): Promise<InferOutput<O>>
  },
): QueryDefinition<S, InferOutput<O>>
export function query<S extends Shape, R>(
  name: string,
  definition: {
    readonly input: S
    readonly output?: Output | undefined
    readonly description?: string
    handle(input: InferShape<S>, context: QueryContext): Promise<R>
  },
): QueryDefinition<S, R> {
  return {
    name,
    description: definition.description,
    input: object(definition.input),
    // The overloads above are what tie the output to `R`; here it is either.
    output: outputSchema(definition.output) as Schema<R> | undefined,
    handle: definition.handle,
  }
}

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
  /**
   * Reads are audited too (SPEC.md §67, §76).
   *
   * §76 lists audit among the checks every MCP tool call must pass, and half the
   * tools of §69 are reads. A log that only recorded writes could not answer which
   * agent read the user list.
   */
  readonly audit: AuditPort
  /**
   * Reads are tracked too (SPEC.md §88).
   *
   * A read that threw is as much an incident as a write that did — a listing nobody
   * can load is an outage, and it is the half of the application a tracker wired only
   * to the Command Bus would never hear about.
   */
  readonly errors?: ErrorTrackingPort
}

export const createQueryBus = (options: QueryBusOptions): QueryBus => {
  const registered = new Map<string, AnyQuery>()

  const reporting: ErrorReporting = {
    errors: options.errors ?? logErrors(options.logger),
    logger: options.logger,
  }

  const run = async (definition: AnyQuery, rawInput: unknown): Promise<unknown> => {
    const context = contextOrInternal()
    const startedAt = performance.now()

    /** Never fails the read: a log that cannot be written is not a reason to refuse. */
    const audit = async (outcome: 'succeeded' | 'failed', metadata?: Record<string, unknown>) => {
      try {
        await options.audit.record({
          action: definition.name,
          kind: 'query',
          source: context.source,
          requestId: context.requestId,
          ...(context.actor === undefined ? {} : { actor: context.actor }),
          outcome,
          durationMs: performance.now() - startedAt,
          ...(metadata === undefined ? {} : { metadata }),
        })
      } catch (error) {
        options.logger.error('The audit log could not be written', {
          query: definition.name,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    /**
     * Only what could not be attributed to the caller (SPEC.md §88).
     *
     * A read is refused far more often than a write — a wrong filter, a denial, a
     * page that is not there — and every one of those is the bus working. What is
     * left is the read that broke.
     */
    const capture = (error: unknown) =>
      captureError(reporting, error, {
        kind: 'query',
        name: definition.name,
        durationMs: performance.now() - startedAt,
      })

    const parsed = definition.input.parse(rawInput)

    if (!parsed.ok) {
      await audit('failed', { reason: 'VALIDATION_ERROR' })
      throw new ValidationError(parsed.issues)
    }

    try {
      await options.authorization.authorize({
        command: definition.name,
        input: parsed.value,
        context,
      })
    } catch (error) {
      await audit('failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
      // A `ForbiddenError` is filtered out; an authorization provider that could not
      // reach its own tables is not.
      await capture(error)
      throw error
    }

    try {
      const answer = await (
        definition.handle as (input: unknown, context: QueryContext) => Promise<unknown>
      )(parsed.value, {
        ...context,
        logger: options.logger.child({ query: definition.name }),
        authorize: async (subject, action, record) => {
          await options.authorization.authorizeRecord?.({ subject, action, record, context })
        },
      })

      await audit('succeeded')

      return answer
    } catch (error) {
      await audit('failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
      await capture(error)
      throw error
    }
  }

  const bus: QueryBus = {
    register(definition, module) {
      registered.set(definition.name, definition)

      options.registry.register('queries', {
        name: definition.name,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        input: definition.input.toJsonSchema(),
        ...(definition.output === undefined ? {} : { output: definition.output.toJsonSchema() }),
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
