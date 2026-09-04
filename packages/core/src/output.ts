/**
 * What a command or a query says it answers with (SPEC.md §14, §42).
 *
 * `input` is a shape, and so is `output` in the ordinary case — `{ id: uuid() }` —
 * because an answer is usually an object. It is not always one: a listing is an
 * array, a count is a number, and a schema says those where a shape cannot. Both are
 * accepted, the way `route()` accepts either for `response`.
 *
 * The declaration types the handler: a handler that answers something its output
 * does not describe does not compile, which is what keeps the document honest — the
 * output is what OpenAPI publishes, what the SDK returns and what an agent is told
 * to expect, and it can only ever be read from the registry, so nothing downstream
 * can check it against the handler. The compiler is the one place that can.
 *
 * It is described and not judged at runtime. The bus does not parse an answer
 * against it: the handler is the application's own code, its answer is the truth,
 * and refusing to hand it over because a description was wrong would turn a wrong
 * document into an outage.
 */
import { type Infer, type InferShape, object, type Schema, type Shape } from '@assemora/schema'

export type Output = Shape | Schema<unknown>

/**
 * A described value as something that is read and never written.
 *
 * `array(string())` infers `string[]`, and a handler that answers a row's own
 * `readonly string[]` cannot promise that — TypeScript refuses to hand a readonly array
 * to a caller who could push to it. An answer is a caller's to read, so every array
 * and object in it is read-only, and the handler may answer with either. A `Date` and
 * a function are left alone: neither is a container, and mapping over them would
 * turn a `Date` into a bag of its methods.
 */
export type Answer<T> = T extends Date | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer E)[]
    ? readonly Answer<E>[]
    : T extends object
      ? { readonly [K in keyof T]: Answer<T[K]> }
      : T

/** The type an output describes: the schema's own, or the object a shape builds. */
export type InferOutput<O extends Output> = Answer<
  O extends Schema<unknown> ? Infer<O> : O extends Shape ? InferShape<O> : never
>

const isSchema = (value: Output): value is Schema<unknown> =>
  typeof (value as Schema<unknown>).parse === 'function'

/** The one schema an output is, whichever way it was written. */
export const outputSchema = (output: Output | undefined): Schema<unknown> | undefined =>
  output === undefined ? undefined : isSchema(output) ? output : object(output)
