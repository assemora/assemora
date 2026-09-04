/**
 * Commands over HTTP (SPEC.md §14, §43).
 *
 * Every mutation in Assemora is a command, and every caller — Studio, the SDK, the
 * CLI, an agent — sends the same one. These endpoints are that bus reached over
 * HTTP: one `POST /commands/<name>` per registered command, generated from what the
 * command described about itself.
 *
 * Mounting all of them is safe by construction rather than by care. The bus runs
 * validation, authorization, the transaction, revisions and audit before a handler
 * sees anything, and authorization denies by default (SPEC.md §12, §50). An endpoint
 * exists for `auth.users.create`; reaching it without the permission answers 403.
 *
 * The exception is a command that has none of that floor because it is *publicly*
 * authorized — a login is callable by somebody who is nobody yet. Such a command
 * declares `reachableFrom: 'its own route'`, and this generator skips it: the checks
 * that make it safe live in the route written for it, and a generic alias would be a
 * second door past all of them (SPEC.md §85).
 */
import type { CommandBus, CommandReach, SchemaRegistry } from '@assemora/core'
import { fail, type JsonSchema, ok, type Schema } from '@assemora/schema'

import type { Route } from './route.js'

/** The part of a command description these endpoints need. */
export type CommandEndpoint = {
  readonly name: string
  readonly description?: string
  readonly input: JsonSchema
  /** Absent when the command did not say what it answers with. */
  readonly output?: JsonSchema
  readonly module?: string
  readonly reachableFrom?: CommandReach
}

/**
 * A body the route documents but does not judge.
 *
 * The registry keeps a command's input as JSON Schema — a description, not a parser.
 * Validating here would be a second implementation of a check the bus already
 * performs as the first step of the mutation path, and two validators drift. So the
 * route confirms it received an object and hands it on; the command's own schema
 * decides the rest, and its description is what OpenAPI publishes (SPEC.md §14, §42).
 */
const described = (input: JsonSchema): Schema<Record<string, unknown>> => ({
  kind: 'object',
  isOptional: false,
  isNullable: false,
  description: undefined,
  parse: (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? ok(value as Record<string, unknown>)
      : fail('type', 'Expected an object'),
  toJsonSchema: () => input,
})

/**
 * A response the route documents but does not judge.
 *
 * The registry keeps a command's output as JSON Schema, and the handler's answer is
 * the application's own truth: parsing it here would turn a description that fell
 * behind the handler into a 500 for every caller, which is a worse outcome than a
 * document that is wrong (SPEC.md §42).
 */
export const documented = (output: JsonSchema): Schema<unknown> => ({
  kind: 'unknown',
  isOptional: false,
  isNullable: false,
  description: undefined,
  parse: (value) => ok(value),
  toJsonSchema: () => output,
})

const isCommandEndpoint = (entry: unknown): entry is CommandEndpoint => {
  const candidate = entry as CommandEndpoint

  return typeof candidate?.name === 'string' && typeof candidate.input === 'object'
}

/**
 * Reads the command descriptions out of the registry, whoever put them there —
 * except the ones that said a route written for them is the only way in.
 */
export const commandEndpoints = (registry: SchemaRegistry): CommandEndpoint[] =>
  (registry.describe().commands ?? [])
    .filter(isCommandEndpoint)
    .filter((endpoint) => endpoint.reachableFrom !== 'its own route')

/** What a caller may say about the endpoints this generates. */
export type CommandRouteOptions = {
  /**
   * A ceiling of its own for named commands, in bytes, keyed by command name.
   *
   * Every command answers at one generated address, so a command that carries a file
   * — `media.upload`, whose input is base64 — cannot be given room without giving the
   * same room to `auth.users.create`. Naming it here keeps the wide ceiling on the one
   * endpoint that needs it (SPEC.md §85).
   */
  readonly bodyLimit?: Readonly<Record<string, number>>
}

export const commandRoutes = (
  endpoints: readonly CommandEndpoint[],
  commands: CommandBus,
  options: CommandRouteOptions = {},
): Route[] =>
  endpoints.map((endpoint) => ({
    node: 'route',
    method: 'post',
    path: `/commands/${endpoint.name}`,
    params: undefined,
    query: undefined,
    body: described(endpoint.input),
    // Described where the command described it, and not judged: the bus hands
    // back what the handler answered, and the schema is what OpenAPI and the SDK
    // read (SPEC.md §42). A command that said nothing is documented as saying nothing
    // rather than promised a shape somebody invented here.
    response: endpoint.output === undefined ? undefined : documented(endpoint.output),
    auth: false,
    source: undefined,
    // A command belongs to the application rather than to a shape of its REST surface,
    // so its generated endpoint is never published inside a version (SPEC.md §47).
    version: undefined,
    status: 200,
    description: endpoint.description,
    tags: [endpoint.module ?? 'commands'],
    errors: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'The input does not fit' },
      { code: 'FORBIDDEN', status: 403, description: 'The actor may not run this command' },
    ],
    bodyLimit: options.bodyLimit?.[endpoint.name],
    handler: async ({ body }) => await commands.execute(endpoint.name, body),
  }))
