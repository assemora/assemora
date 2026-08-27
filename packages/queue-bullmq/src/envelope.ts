/**
 * The wire format: what goes into Redis, and what is trusted coming back out.
 *
 * A `QueuedJob` is written by one process and read by another that shares nothing
 * with it — not a heap, not a deploy, sometimes not a version. So both directions
 * are checked here. Going in, the payload has to be something JSON can carry, and
 * the refusal belongs at the call that dispatched it, where the stack still says
 * who. Coming out, the envelope is untrusted input like any other: anything holding
 * the connection string can write to that list (SPEC.md §85).
 */

import type { QueuedJob } from '@assemora/core'
import { AssemoraError } from '@assemora/core'
import { enumOf, integer, object, string, unknown } from '@assemora/schema'

/**
 * The envelope, described with the same primitives everything else in Assemora is
 * described with — so a queue holding a shape nobody declares is refused by the
 * mechanism that refuses a bad request body.
 *
 * `payload` stays `unknown()` on purpose: the job's own input schema is what checks
 * it, inside `runJob`, against the declaration the worker actually has.
 */
const ENVELOPE = object({
  name: string().min(1),
  payload: unknown(),
  retries: integer().min(0),
  requestId: string().min(1),
  actor: object({ type: enumOf('user', 'agent', 'api'), id: string().min(1) }).optional(),
  dispatchedFrom: enumOf('studio', 'rest', 'sdk', 'mcp', 'cli', 'job', 'internal'),
})

/**
 * Reads a job back off the queue.
 *
 * A malformed envelope is not the job's fault and no handler will ever see it, so it
 * fails here with the fields named rather than as an unreadable crash inside a
 * handler that was given nonsense.
 */
export const decodeJob = (data: unknown): QueuedJob => {
  const parsed = ENVELOPE.parse(data)

  if (!parsed.ok) {
    throw new AssemoraError('MALFORMED_JOB', 'The queue handed back something that is not a job', {
      status: 422,
      details: { fields: parsed.issues.map((issue) => issue.path.join('.') || '_') },
    })
  }

  return parsed.value
}

/** `[3]` and `.title`, so a fault reads as the path a developer would type. */
const step = (path: string, key: string | number): string =>
  typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`

const nameOf = (value: object): string => {
  const built = (value as { constructor?: { name?: unknown } }).constructor

  return typeof built?.name === 'string' ? `a ${built.name}` : 'an exotic object'
}

const unqueueable = (job: string, fault: string): AssemoraError =>
  new AssemoraError(
    'UNQUEUEABLE_PAYLOAD',
    `"${job}" cannot be queued: it carries ${fault}. A payload crosses a queue as JSON, so it may hold only strings, finite numbers, booleans, null, arrays, plain objects and dates.`,
    { status: 422, details: { job } },
  )

/**
 * The payload as JSON will hand it back, or a refusal naming the first thing that
 * would not survive.
 *
 * Depth-first, and first fault wins: one clear sentence about one field beats a list
 * nobody reads.
 */
const toJson = (value: unknown, path: string, seen: WeakSet<object>, job: string): unknown => {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    // NaN and both infinities serialize as `null`, which is a different value with
    // the same shape — the worst kind of loss, because nothing throws.
    case 'number':
      if (!Number.isFinite(value)) throw unqueueable(job, `${String(value)} at ${path}`)
      return value
    case 'object':
      break
    default:
      throw unqueueable(
        job,
        `${value === undefined ? 'undefined' : `a ${typeof value}`} at ${path}`,
      )
  }

  const branch = value as object

  if (seen.has(branch)) throw unqueueable(job, `a circular reference at ${path}`)

  // A Date is the one value here the framework already has a wire form for:
  // `timestamp().toJsonSchema()` says `string` / `date-time`, and `timestamp().parse`
  // reads one back. So it travels as an ISO string, and because `runJob` re-parses
  // the payload against the job's own input schema on arrival, a handler that
  // declared `timestamp()` is handed the Date it declared. Refusing it instead would
  // make one schema primitive unusable in a job for no reason anybody could name.
  if (branch instanceof Date) {
    if (Number.isNaN(branch.getTime())) throw unqueueable(job, `an invalid Date at ${path}`)

    return branch.toISOString()
  }

  seen.add(branch)

  try {
    if (Array.isArray(branch)) {
      return branch.map((item, index) => toJson(item, step(path, index), seen, job))
    }

    // A Map, a Set, a model instance: everything else with a prototype of its own
    // comes back as something else, or as `{}`. `Object.create(null)` is a plain bag
    // of keys and survives, so it is allowed too.
    const prototype = Object.getPrototypeOf(branch) as object | null

    if (prototype !== Object.prototype && prototype !== null) {
      throw unqueueable(job, `${nameOf(branch)} at ${path}`)
    }

    const copy: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(branch)) {
      copy[key] = toJson(item, step(path, key), seen, job)
    }

    return copy
  } finally {
    // Only a cycle is a fault. The same object twice in one payload is ordinary.
    seen.delete(branch)
  }
}

/**
 * Prepares a job for the queue, and refuses one that would arrive as something else
 * (SPEC.md §82).
 *
 * A `Date` is the case everybody meets: it survives `JSON.stringify`, comes back a
 * string, and the job's own input schema then rejects it — three hours later, in a
 * process nobody was watching. Here it is converted once, deliberately, and anything
 * that has no honest wire form is refused before a byte is written.
 */
export const encodeJob = (job: QueuedJob): QueuedJob => ({
  ...job,
  payload: toJson(job.payload, 'payload', new WeakSet(), job.name),
})
