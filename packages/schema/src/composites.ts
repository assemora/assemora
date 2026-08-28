import {
  fail,
  failWith,
  type Infer,
  type InferShape,
  type Issue,
  type JsonSchema,
  nest,
  type OptionalSchema,
  ok,
  type ParseResult,
  type Schema,
  type Shape,
} from './types.js'

const optionalOf = <T>(inner: Schema<T>): OptionalSchema<T> => ({
  ...inner,
  isOptional: true,
  parse: (value: unknown): ParseResult<T | undefined> =>
    value === undefined ? ok(undefined) : inner.parse(value),
})

const nullableOf = <T>(inner: Schema<T>): Schema<T | null> => ({
  ...inner,
  isNullable: true,
  parse: (value: unknown): ParseResult<T | null> =>
    value === null ? ok(null) : inner.parse(value),
  toJsonSchema: () => ({ ...inner.toJsonSchema(), nullable: true }),
})

// --- object ------------------------------------------------------------------

export type ObjectSchema<S extends Shape> = Schema<InferShape<S>> & {
  readonly shape: S
  describe(text: string): ObjectSchema<S>
  optional(): OptionalSchema<InferShape<S>>
  nullable(): Schema<InferShape<S> | null>
}

const buildObject = <S extends Shape>(
  shape: S,
  description: string | undefined,
): ObjectSchema<S> => {
  const self: ObjectSchema<S> = {
    kind: 'object',
    isOptional: false,
    isNullable: false,
    description,
    shape,

    parse: (value: unknown): ParseResult<InferShape<S>> => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail('type', 'Expected an object')
      }

      const source = value as Record<string, unknown>
      const issues: Issue[] = []
      const parsed: Record<string, unknown> = {}

      for (const [key, field] of Object.entries(shape)) {
        // `hasOwn` rather than plain indexing, and rather than `in`: a shape's keys are
        // caller-chosen — a dynamic collection names its fields in stored JSON
        // (SPEC.md §37, §86) — and `constructor`, `toString`, `valueOf` and
        // `hasOwnProperty` are all legal field names that `Object.prototype` answers on
        // a value that has never been given them. Read without this, a group field
        // called `constructor` parsed a function for a key nobody sent, and the entry
        // could never be saved.
        const present = Object.hasOwn(source, key)
        const result = field.parse(present ? source[key] : undefined)

        if (!result.ok) {
          issues.push(...nest(key, result.issues))
          continue
        }

        // An absent optional key stays absent rather than becoming `undefined`,
        // which `exactOptionalPropertyTypes` treats as two different things.
        if (result.value === undefined && !present) continue

        parsed[key] = result.value
      }

      // Keys that are not part of the shape are dropped, never carried through.
      // Passing them on is how mass assignment happens (SPEC.md §85).
      return issues.length > 0 ? failWith(issues) : ok(parsed as InferShape<S>)
    },

    toJsonSchema: (): JsonSchema => {
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []

      for (const [key, field] of Object.entries(shape)) {
        properties[key] = field.toJsonSchema()
        if (!field.isOptional) required.push(key)
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
        ...(description === undefined ? {} : { description }),
      }
    },

    describe: (text) => buildObject(shape, text),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

/** `object({ email: string(), age: number().optional() })` */
export const object = <S extends Shape>(shape: S): ObjectSchema<S> => buildObject(shape, undefined)

// --- array -------------------------------------------------------------------

export type ArraySchema<E extends Schema> = Schema<Infer<E>[]> & {
  readonly element: E
  min(length: number): ArraySchema<E>
  max(length: number): ArraySchema<E>
  describe(text: string): ArraySchema<E>
  optional(): OptionalSchema<Infer<E>[]>
  nullable(): Schema<Infer<E>[] | null>
}

type ArrayState = {
  readonly minLength: number | undefined
  readonly maxLength: number | undefined
  readonly description: string | undefined
}

const buildArray = <E extends Schema>(element: E, state: ArrayState): ArraySchema<E> => {
  const self: ArraySchema<E> = {
    kind: 'array',
    isOptional: false,
    isNullable: false,
    description: state.description,
    element,

    parse: (value: unknown): ParseResult<Infer<E>[]> => {
      if (!Array.isArray(value)) return fail('type', 'Expected an array')

      if (state.minLength !== undefined && value.length < state.minLength) {
        return fail('min', `Must contain at least ${state.minLength} items`)
      }
      if (state.maxLength !== undefined && value.length > state.maxLength) {
        return fail('max', `Must contain at most ${state.maxLength} items`)
      }

      const issues: Issue[] = []
      const parsed: Infer<E>[] = []

      for (const [index, item] of value.entries()) {
        const result = element.parse(item)
        if (result.ok) {
          parsed.push(result.value as Infer<E>)
        } else {
          issues.push(...nest(index, result.issues))
        }
      }

      return issues.length > 0 ? failWith(issues) : ok(parsed)
    },

    toJsonSchema: () => ({
      type: 'array',
      items: element.toJsonSchema(),
      ...(state.minLength === undefined ? {} : { minItems: state.minLength }),
      ...(state.maxLength === undefined ? {} : { maxItems: state.maxLength }),
      ...(state.description === undefined ? {} : { description: state.description }),
    }),

    min: (length) => buildArray(element, { ...state, minLength: length }),
    max: (length) => buildArray(element, { ...state, maxLength: length }),
    describe: (text) => buildArray(element, { ...state, description: text }),
    optional: () => optionalOf(self),
    nullable: () => nullableOf(self),
  }

  return self
}

export const array = <E extends Schema>(element: E): ArraySchema<E> =>
  buildArray(element, { minLength: undefined, maxLength: undefined, description: undefined })
