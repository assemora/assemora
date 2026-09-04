/**
 * A schema per file, so two integration suites cannot see each other's tables.
 *
 * Every suite here connects to the one database `ASSEMORA_TEST_DATABASE_URL` names,
 * and several drop and re-create their tables in `beforeAll`. Vitest runs files in
 * parallel, so one file was reading `information_schema` while another was dropping,
 * and an OID that resolved a moment earlier no longer named a relation: `could not
 * open relation with OID 1134274`, once in a while, in a test that passes alone (#28).
 * A suite that passes usually is a suite nobody trusts when it fails.
 *
 * The adapter already pins `search_path` per connection, so a schema is the unit of
 * isolation it offers for free: every unqualified name in the DDL, the migration
 * table included, lands in it. The name is derived from the file's own, which is
 * unique by construction and needs no coordination — nothing has to hand out names.
 */
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PostgresAdapter } from '@assemora/database-postgres'

/** `tests/integration/after-commit-postgres.test.ts` → `test_after_commit_postgres`. */
export const schemaNamed = (fileUrl: string): string => {
  const file = basename(fileURLToPath(fileUrl)).replace(/\.test\.ts$/, '')

  return `test_${file.replace(/[^a-z0-9]+/g, '_')}`
}

/**
 * Starts the file's schema from nothing.
 *
 * Dropped and re-created rather than emptied, so a run that was killed half-way
 * leaves nothing for the next one to trip over. The adapter is already connected
 * with this schema on its `search_path`, and a schema that does not exist yet is not
 * an error there — only the first `create table` would be.
 */
export const isolate = async (adapter: PostgresAdapter, schema: string): Promise<void> => {
  await adapter.raw(`drop schema if exists "${schema}" cascade`)
  await adapter.raw(`create schema "${schema}"`)
}
