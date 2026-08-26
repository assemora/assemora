import {
  fail,
  type Infer,
  type Issue,
  type JsonSchema,
  type OptionalSchema,
  ok,
  type ParseResult,
  type Schema,
} from './types.js'

type Refinement<T> = (value: T) => Issue | undefined

/** Adds "may be absent" without touching the wrapped schema. */
const optionalOf = <T>(inner: Schema<T>): OptionalSchema<T> => ({
  ...inner,
  isOptional: true,
  parse: (value: unknown): ParseResult<T | undefined> =>
    value === undefined ? ok(undefined) : inner.parse(value),
})

/** Adds "may be null" without touching the wrapped schema. */
const nullableOf = <T>(inner: Schema<T>): Schema<T | null> => ({
  ...inner,
  isNullable: true,
  parse: (value: unknown): ParseResult<T | null> =>
    value === null ? ok(null) : inner.parse(value),
  toJsonSchema: () => ({ ...inner.toJsonSchema(), nullable: true }),
})

const applyRefinements = <T>(value: T, refinements: readonly Refinement<T>[]): Issue[] =>
  refinements.map((refine) => refine(value)).filter((issue): issue is Issue => issue !== undefined)

// --- string ------------------------------------------------------------------

type StringState = {
  readonly refinements: readonly Refinement<string>[]
  readonly json: JsonSchema
  readonly description: string | undefined
}

export type StringSchema = Schema<string> & {
  min(length: number): StringSchema
  max(length: number): StringSchema
  pattern(expression: RegExp, message?: string): StringSchema
  email(): StringSchema
  uuid(): StringSchema
  describe(text: string): StringSchema
  optional(): OptionalSchema<string>
  nullable(): Schema<string | null>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const buildString = (state: StringState): StringSchema => {
  const self: StringSchema = {
    kind: 'string',
    isOptional: false,
    isNullable: false,
    description: state.description,

    parse: (value: unknown): ParseResult<string> => {
      if (typeof value !== 'string') return fail('type', 'Expected a string')
      const issues = applyRefinements(value, state.refinements)
      return issues.length > 0 ? { ok: false, issues } : ok(value)
    },

    toJsonSchema: () => ({
      type: 'string',
      ...state.json,
      ...(state.description === undefined ? {} : { description: state.description }),
    }),

    min: (length) =>
      buildString({
        ...state,
        json: { ...state.json, minLength: length },
        refinements: [
          ...state.refinements,
          (value) =>
            value.length < length
              ? { path: [], code: 'min', message: `Must be at least ${length} characters` }
              : undefined,
        ],
      }),

    max: (length) =>
      buildString({
        ...state,
        json: { ...state.json, maxLength: length },
        refinements: [
          ...state.refinements,
          (value) =>
            value.length > length
              ? { path: [], code: 'max', message: `Must be at most ${length} characters` }
              : undefined,
        ],
      }),

    pattern: (expression, message = 'Invalid format') =>
      buildString({
        ...state,
        json: { ...state.json, pattern: expression.source },
        refinements: [
          ...state.refinements,
          (value) => (expression.test(value) ? undefined : { path: [], code: 'pattern', message }),
        ],
      }),

    email: () =>
      buildString({
        ...state,
        json: { ...state.json, format: 'email' },
        refinements: [
          ...state.refinements,
          (value) =>
            EMAIL.test(value) ? undefined : { path: [], code: 'email', message: 'Invalid email' },
        ],
      }),

    uuid: () =>
      buildString({
        ...state,
        json: { ...state.json, format: 'uuid' },
        refinements: [
          ...state.refinements,
          (value) =>
            UUID.test(value) ? undefined : { path: [], code: 'uuid', message: 'Invalid UUID' },
        ],
      }),

    describe: (text) => buildString({ ...state, description: text }),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const string = (): StringSchema =>
  buildString({ refinements: [], json: {}, description: undefined })

/** A UUID string. Shorthand for `string().uuid()`, which reads better in a model. */
export const uuid = (): StringSchema => string().uuid()

/** An email address. Shorthand for `string().email()`. */
export const email = (): StringSchema => string().email()

// --- number ------------------------------------------------------------------

type NumberState = {
  readonly refinements: readonly Refinement<number>[]
  readonly json: JsonSchema
  readonly description: string | undefined
}

export type NumberSchema = Schema<number> & {
  min(value: number): NumberSchema
  max(value: number): NumberSchema
  integer(): NumberSchema
  describe(text: string): NumberSchema
  optional(): OptionalSchema<number>
  nullable(): Schema<number | null>
}

const buildNumber = (state: NumberState): NumberSchema => {
  const self: NumberSchema = {
    kind: 'number',
    isOptional: false,
    isNullable: false,
    description: state.description,

    parse: (value: unknown): ParseResult<number> => {
      if (typeof value !== 'number' || Number.isNaN(value)) return fail('type', 'Expected a number')
      const issues = applyRefinements(value, state.refinements)
      return issues.length > 0 ? { ok: false, issues } : ok(value)
    },

    toJsonSchema: () => ({
      type: 'number',
      ...state.json,
      ...(state.description === undefined ? {} : { description: state.description }),
    }),

    min: (minimum) =>
      buildNumber({
        ...state,
        json: { ...state.json, minimum },
        refinements: [
          ...state.refinements,
          (value) =>
            value < minimum
              ? { path: [], code: 'min', message: `Must be at least ${minimum}` }
              : undefined,
        ],
      }),

    max: (maximum) =>
      buildNumber({
        ...state,
        json: { ...state.json, maximum },
        refinements: [
          ...state.refinements,
          (value) =>
            value > maximum
              ? { path: [], code: 'max', message: `Must be at most ${maximum}` }
              : undefined,
        ],
      }),

    integer: () =>
      buildNumber({
        ...state,
        json: { ...state.json, type: 'integer' },
        refinements: [
          ...state.refinements,
          (value) =>
            Number.isInteger(value)
              ? undefined
              : { path: [], code: 'integer', message: 'Must be an integer' },
        ],
      }),

    describe: (text) => buildNumber({ ...state, description: text }),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const number = (): NumberSchema =>
  buildNumber({ refinements: [], json: {}, description: undefined })

export const integer = (): NumberSchema => number().integer()

// --- boolean -----------------------------------------------------------------

export type BooleanSchema = Schema<boolean> & {
  describe(text: string): BooleanSchema
  optional(): OptionalSchema<boolean>
  nullable(): Schema<boolean | null>
}

const buildBoolean = (description: string | undefined): BooleanSchema => {
  const self: BooleanSchema = {
    kind: 'boolean',
    isOptional: false,
    isNullable: false,
    description,
    parse: (value: unknown): ParseResult<boolean> =>
      typeof value === 'boolean' ? ok(value) : fail('type', 'Expected a boolean'),
    toJsonSchema: () => ({
      type: 'boolean',
      ...(description === undefined ? {} : { description }),
    }),
    describe: (text) => buildBoolean(text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const boolean = (): BooleanSchema => buildBoolean(undefined)

// --- enum --------------------------------------------------------------------

export type EnumSchema<T extends string> = Schema<T> & {
  readonly values: readonly T[]
  describe(text: string): EnumSchema<T>
  optional(): OptionalSchema<T>
  nullable(): Schema<T | null>
}

const buildEnum = <T extends string>(
  values: readonly T[],
  description: string | undefined,
): EnumSchema<T> => {
  const allowed = new Set<string>(values)

  const self: EnumSchema<T> = {
    kind: 'enum',
    isOptional: false,
    isNullable: false,
    description,
    values,
    parse: (value: unknown): ParseResult<T> =>
      typeof value === 'string' && allowed.has(value)
        ? ok(value as T)
        : fail('enum', `Expected one of: ${values.join(', ')}`),
    toJsonSchema: () => ({
      type: 'string',
      enum: [...values],
      ...(description === undefined ? {} : { description }),
    }),
    describe: (text) => buildEnum(values, text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

/** `enumOf('draft', 'published')` infers the literal union, not `string`. */
export const enumOf = <const V extends readonly [string, ...string[]]>(
  ...values: V
): EnumSchema<V[number]> => buildEnum<V[number]>(values, undefined)

// --- timestamp ---------------------------------------------------------------

export type TimestampSchema = Schema<Date> & {
  describe(text: string): TimestampSchema
  optional(): OptionalSchema<Date>
  nullable(): Schema<Date | null>
}

const buildTimestamp = (description: string | undefined): TimestampSchema => {
  const self: TimestampSchema = {
    kind: 'timestamp',
    isOptional: false,
    isNullable: false,
    description,

    parse: (value: unknown): ParseResult<Date> => {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? fail('type', 'Invalid date') : ok(value)
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? fail('type', 'Invalid date') : ok(parsed)
      }
      return fail('type', 'Expected a date')
    },

    toJsonSchema: () => ({
      type: 'string',
      format: 'date-time',
      ...(description === undefined ? {} : { description }),
    }),

    describe: (text) => buildTimestamp(text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const timestamp = (): TimestampSchema => buildTimestamp(undefined)

// --- json / unknown ----------------------------------------------------------

export type JsonValueSchema<T> = Schema<T> & {
  describe(text: string): JsonValueSchema<T>
  optional(): OptionalSchema<T>
  nullable(): Schema<T | null>
}

const buildJson = <T>(description: string | undefined): JsonValueSchema<T> => {
  const self: JsonValueSchema<T> = {
    kind: 'json',
    isOptional: false,
    isNullable: false,
    description,

    parse: (value: unknown): ParseResult<T> => {
      if (value === undefined || typeof value === 'function') {
        return fail('type', 'Expected a JSON value')
      }
      // The caller states the shape through the type argument; JSON has no runtime
      // description of it. Structural checking belongs in an explicit object().
      return ok(value as T)
    },

    toJsonSchema: () => ({
      ...(description === undefined ? {} : { description }),
    }),

    describe: (text) => buildJson<T>(text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

/** An opaque JSON payload whose shape the caller declares: `json<UserSettings>()`. */
export const json = <T = unknown>(): JsonValueSchema<T> => buildJson<T>(undefined)

export type UnknownSchema = Schema<unknown> & {
  describe(text: string): UnknownSchema
  optional(): OptionalSchema<unknown>
}

const buildUnknown = (description: string | undefined): UnknownSchema => {
  const self: UnknownSchema = {
    kind: 'unknown',
    isOptional: false,
    isNullable: false,
    description,
    parse: (value: unknown): ParseResult<unknown> => ok(value),
    toJsonSchema: () => ({ ...(description === undefined ? {} : { description }) }),
    describe: (text) => buildUnknown(text),
    optional: () => optionalOf(self),
  }

  return self
}

export const unknown = (): UnknownSchema => buildUnknown(undefined)

// --- bigint ------------------------------------------------------------------

export type BigIntSchema = Schema<bigint> & {
  describe(text: string): BigIntSchema
  optional(): OptionalSchema<bigint>
  nullable(): Schema<bigint | null>
}

const buildBigInt = (description: string | undefined): BigIntSchema => {
  const self: BigIntSchema = {
    kind: 'bigint',
    isOptional: false,
    isNullable: false,
    description,

    parse: (value: unknown): ParseResult<bigint> => {
      if (typeof value === 'bigint') return ok(value)

      if (typeof value === 'number' && Number.isInteger(value)) return ok(BigInt(value))

      if (typeof value === 'string' && /^-?\d+$/.test(value)) return ok(BigInt(value))

      return fail('type', 'Expected a big integer')
    },

    toJsonSchema: () => ({
      type: 'string',
      format: 'int64',
      ...(description === undefined ? {} : { description }),
    }),

    describe: (text) => buildBigInt(text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const bigint = (): BigIntSchema => buildBigInt(undefined)

// --- binary ------------------------------------------------------------------

export type BinarySchema = Schema<Uint8Array> & {
  describe(text: string): BinarySchema
  optional(): OptionalSchema<Uint8Array>
  nullable(): Schema<Uint8Array | null>
}

/** Canonical base64. Anything else is not what `contentEncoding` promised. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Decoded here rather than through `atob` or `Buffer`.
 *
 * This package has no dependencies and runs in a browser, in Node and in a worker
 * (SPEC.md §8), and those two names are not all present in all three.
 */
const decodeBase64 = (value: string): Uint8Array | undefined => {
  if (!BASE64.test(value)) return undefined

  const body = value.replace(/=+$/, '')
  const decoded = new Uint8Array((body.length * 3) >> 2)

  let accumulator = 0
  let bits = 0
  let written = 0

  for (const character of body) {
    const index = ALPHABET.indexOf(character)

    accumulator = (accumulator << 6) | index
    bits += 6

    if (bits >= 8) {
      bits -= 8
      decoded[written] = (accumulator >> bits) & 0xff
      written += 1
    }
  }

  return decoded
}

const buildBinary = (description: string | undefined): BinarySchema => {
  const self: BinarySchema = {
    kind: 'binary',
    isOptional: false,
    isNullable: false,
    description,

    /**
     * Bytes in process, base64 over the wire.
     *
     * The JSON description says `contentEncoding: base64`, and a schema that
     * publishes an encoding it will not accept is describing something it is not.
     * JSON has no bytes, so an upload arriving over HTTP has no other form.
     */
    parse: (value: unknown): ParseResult<Uint8Array> => {
      if (value instanceof Uint8Array) return ok(value)

      if (typeof value === 'string') {
        const decoded = decodeBase64(value)

        return decoded === undefined ? fail('encoding', 'Expected base64 data') : ok(decoded)
      }

      return fail('type', 'Expected binary data')
    },

    toJsonSchema: () => ({
      type: 'string',
      contentEncoding: 'base64',
      ...(description === undefined ? {} : { description }),
    }),

    describe: (text) => buildBinary(text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const binary = (): BinarySchema => buildBinary(undefined)

export type { Infer }
