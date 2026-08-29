/**
 * The vocabulary every other layer speaks.
 *
 * A schema carries three things at once: a runtime parser, a compile-time type and
 * a neutral JSON description. One declaration therefore feeds validation, the
 * database, Studio forms, OpenAPI, the SDK and MCP (SPEC.md §3.4, §42).
 */

/**
 * What a refinement knows about the failure beyond its code.
 *
 * `string().min(9)` fails with `code: 'min'` and `params: { length: 9 }`, and the nine
 * is the whole reason a translated message can exist: a sentence with the number
 * already baked into it can only ever be rewritten, never translated.
 */
export type IssueParams = Readonly<Record<string, string | number | readonly (string | number)[]>>

/**
 * A single validation failure, addressed by its path inside the value.
 *
 * `message` is English and always will be. It is what a developer reads in a log and
 * what a client with no message catalogue of its own can fall back on; `code` plus
 * `params` is what a site with more than one language renders instead. Both travel to
 * the caller — `ValidationError.toPayload` carries the issues beside the field grouping
 * SPEC.md §84 fixes — because dropping the code was what made a form in Ukrainian print
 * `Must be at least 9 characters`.
 */
export type Issue = {
  readonly path: readonly (string | number)[]
  readonly code: string
  readonly message: string
  readonly params?: IssueParams
}

/**
 * Parsing never throws: a caller decides what a failure means. `@assemora/core`
 * turns issues into a `VALIDATION_ERROR` response (SPEC.md §84).
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] }

/** A JSON Schema fragment, kept structural so no subsystem owns the format. */
export type JsonSchema = Readonly<Record<string, unknown>>

export type SchemaKind =
  | 'string'
  | 'number'
  | 'bigint'
  | 'binary'
  | 'boolean'
  | 'enum'
  | 'timestamp'
  | 'json'
  | 'unknown'
  | 'array'
  | 'object'

/**
 * The inferred type travels through `parse`, so no phantom property and no cast is
 * needed to carry it.
 */
export type Schema<T = unknown> = {
  readonly kind: SchemaKind
  readonly isOptional: boolean
  readonly isNullable: boolean
  readonly description: string | undefined
  parse(value: unknown): ParseResult<T>
  toJsonSchema(): JsonSchema
}

/** A schema whose key may be absent from an object. */
export type OptionalSchema<T> = Schema<T | undefined> & { readonly isOptional: true }

/** The type a schema produces. */
export type Infer<S> = S extends { parse(value: unknown): ParseResult<infer T> } ? T : never

/** A record of named schemas — the shape of an object, a command input, a route body. */
export type Shape = Readonly<Record<string, Schema>>

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends { readonly isOptional: true } ? K : never
}[keyof S]

/** The type an object shape produces, with optional keys kept optional. */
export type InferShape<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>
  }
>

export const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value })

export const fail = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
  params?: IssueParams,
) =>
  ({
    ok: false,
    issues: [{ path, code, message, ...(params === undefined ? {} : { params }) }],
  }) as const

export const failWith = (issues: readonly Issue[]): ParseResult<never> => ({ ok: false, issues })

/** Re-addresses issues from a nested value into the parent's coordinate space. */
export const nest = (key: string | number, issues: readonly Issue[]): Issue[] =>
  issues.map((issue) => ({ ...issue, path: [key, ...issue.path] }))
