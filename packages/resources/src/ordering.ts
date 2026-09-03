/**
 * What a listing is ordered by (SPEC.md §40, §41).
 *
 * A page of results is a window onto an ordering. Without one the database is free to
 * return rows in any order it likes, and it does — PostgreSQL reads whatever the heap
 * and the plan give it, and the plan for `offset 20 limit 10` is not the plan for
 * `limit 10`. So page two could repeat a row from page one and skip another, and an
 * editor paging through a collection would never learn which.
 *
 * Both halves of this package had the same hole, in the same shape: an `orderBy` that
 * ran only when the caller sent a sort. `resource.ts` says in its own words that a rule
 * cannot exist for a static resource and be missing from a collection, so the rule lives
 * here and both call it.
 */

export type SortDirection = 'asc' | 'desc'

export type OrderTerm = {
  readonly field: string
  readonly direction: SortDirection
}

/** `-createdAt` is `createdAt` descending. The spelling a URL uses. */
export const parseSort = (sort: string): OrderTerm => ({
  field: sort.startsWith('-') ? sort.slice(1) : sort,
  direction: sort.startsWith('-') ? 'desc' : 'asc',
})

/**
 * The ordering a listing runs under, always at least one term and always total.
 *
 * Three things, in order of what they answer.
 *
 * **The primary key is always the last term.** That is what makes the ordering *total*:
 * every other column may hold the same value in two rows, and two rows that tie are two
 * rows the database may return in either order — differently on each query, because a
 * paginated read is two queries. Sorting by `status` is the plain case, since a
 * collection of forty drafts ties forty ways, but `createdAt` ties too: two entries
 * written in the same millisecond by one import are a coin toss forever. A key is
 * unique by definition, so appending it settles every tie and changes nothing else.
 *
 * **What the caller asked for comes first**, unchanged.
 *
 * **What is asked for by nobody is newest first**, where the model records when a row
 * was made. A listing is read by a person looking for what they last worked on, and a
 * resource that wants a different answer says so with `defaultSort`. A model with no
 * `createdAt` falls to the key alone: arbitrary, but stable, which is the property that
 * was missing.
 */
export const listingOrder = (options: {
  /** What the caller asked for, or what the resource declared, already validated. */
  readonly sort?: string | undefined
  readonly primaryKey: string
  /** Whether the model records when a row was made. */
  readonly hasCreatedAt: boolean
}): readonly OrderTerm[] => {
  const asked =
    options.sort === undefined
      ? options.hasCreatedAt
        ? [{ field: 'createdAt', direction: 'desc' as const }]
        : []
      : [parseSort(options.sort)]

  // Not appended twice when the caller already sorted by the key: `id, id` is harmless
  // in SQL and confusing in a log, and the second term can never change the outcome.
  return asked.some((term) => term.field === options.primaryKey)
    ? asked
    : [...asked, { field: options.primaryKey, direction: 'asc' }]
}
