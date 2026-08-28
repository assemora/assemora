/**
 * The one database failure a caller above is allowed to survive (SPEC.md §31, §83).
 *
 * A unique violation, a bad value, a deadlock: those are things a caller did, and an
 * adapter reports each of them under a code of its own so the layer above can say
 * whose mistake it was. This file is for the failure nobody made — the table is not
 * there yet, because the migrations have not been run.
 *
 * It has to be told apart from every other way a database can refuse, because an
 * application must be able to boot against a schema that is not applied yet: that is
 * exactly what `assemora db:generate` does when it imports the project's application
 * to read its registry (ADR-0021), and a boot hook that reads a table would otherwise
 * need the table its own migration is about to create. "The table does not exist",
 * "the database refused the connection" and "permission denied" arriving as one code
 * would make that boot indistinguishable from a broken deployment.
 *
 * The distinction lives here rather than in an adapter because it is part of the
 * adapter *contract*: the caller that survives it is `@assemora/resources`, which may
 * not learn PostgreSQL to ask the question (SPEC.md §8), and an adapter that reported
 * a missing table the way it reports a refused connection would make the invariant
 * unimplementable for everybody above.
 */
import { AssemoraError } from '@assemora/core'

/**
 * The code every adapter must report a missing table under.
 *
 * Exported as a constant because an `AssemoraError` code is a public contract — it
 * travels to a REST client through `toPayload()` — and a caller too far up the
 * dependency graph to import this file compares the string instead.
 */
export const SCHEMA_NOT_APPLIED = 'SCHEMA_NOT_APPLIED'

/**
 * "This table has not been created yet", with the remedy in the sentence.
 *
 * 503 rather than 500: nothing went wrong handling the request, the deployment is
 * unfinished. It is still an incident — SPEC.md §88 reports everything at 500 and
 * above — because an application serving in this state answers nothing correctly.
 */
export const schemaNotApplied = (table: string | undefined, cause?: unknown): AssemoraError =>
  new AssemoraError(
    SCHEMA_NOT_APPLIED,
    table === undefined
      ? 'A table this application needs does not exist. Run "assemora db:migrate" to apply the migrations for this project.'
      : `The table "${table}" does not exist. Run "assemora db:migrate" to apply the migrations for this project.`,
    {
      status: 503,
      ...(table === undefined ? {} : { details: { table } }),
      cause,
    },
  )

/**
 * Whether a failure was a missing table and nothing else.
 *
 * The one question a boot hook is allowed to ask before carrying on. Everything else
 * — a refused connection, a database that does not exist, a privilege the user was
 * never granted — answers `false` here and stops the boot, which is the point.
 */
export const isSchemaNotApplied = (error: unknown): error is AssemoraError =>
  error instanceof AssemoraError && error.code === SCHEMA_NOT_APPLIED
