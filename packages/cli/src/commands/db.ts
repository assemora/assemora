/**
 * `db:generate`, `db:migrate`, `db:rollback`, `db:status` (SPEC.md §34).
 *
 * The CLI orchestrates and owns neither the SQL nor the runner. `diffSchema` says
 * what changed between two schemas, `migrationSql` turns that into statements and
 * `applyMigrations` applies them (ADR-0021). What lives here is the part in between:
 * the file a migration is, the number it gets, the snapshot a diff is taken against,
 * and the refusals that stand between a destructive statement and a live database.
 *
 * A migration is a plain `.sql` file, because the whole point of generating one is
 * that a person reads it in a pull request before it ever reaches a database.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ConfigurationError } from '@assemora/core'
import { currentAdapter, registeredModels } from '@assemora/data'
import { diffSchema, type TableDescriptor } from '@assemora/database'
import type { Migration, PostgresAdapter } from '@assemora/database-postgres'

import { bool } from '../args.js'
import { type LoadedConfig, loadConfig } from '../config.js'
import { detail, fail, json, line, ok, table, warn } from '../output.js'
import { loadApplication } from '../project.js'
import { defineCommand, register } from '../registry.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const count = (amount: number, noun: string): string =>
  `${amount} ${noun}${amount === 1 ? '' : 's'}`

/**
 * Everything a migration is, in either direction.
 *
 * The generator produces one and the file writer consumes one; the parser turns a
 * file back into one. Having a single type for all three is what makes the round trip
 * something a test can state in one line.
 */
export type MigrationContent = {
  readonly up: readonly string[]
  readonly down: readonly string[]
  /** One sentence per `up` statement that changes or destroys stored data. */
  readonly destructive: readonly string[]
}

/**
 * Where a migration's SQL comes from — the one function in this file that knows.
 *
 * The work splits along the dialect line (ADR-0021): `diffSchema` in
 * `@assemora/database` says what changed and knows no dialect, and `migrationSql` in
 * `@assemora/database-postgres` turns that into PostgreSQL. The CLI orchestrates and
 * writes neither half.
 *
 * The list of changes is carried straight from one to the other and never read here,
 * so what a schema change looks like can move without the CLI moving with it.
 */
const generateMigration = async (
  before: readonly TableDescriptor[],
  after: readonly TableDescriptor[],
): Promise<MigrationContent> => {
  // Loaded here rather than at the top of the module: `assemora --help` must not pay
  // for a database driver it is never going to use.
  const { migrationSql } = await import('@assemora/database-postgres')

  return migrationSql(diffSchema(before, after).changes)
}

/**
 * The schema the models describe right now, in a stable order.
 *
 * Sorted by name so that reordering a module's imports does not rewrite the snapshot
 * and produce a diff nobody made.
 */
const declaredTables = (): readonly TableDescriptor[] =>
  Object.values(registeredModels()).sort((left, right) => left.name.localeCompare(right.name))

/*
 * The file format.
 *
 * ```sql
 * -- 0002_add-sku
 * -- Written by `assemora db:generate`. A comment beginning `-- +` is read back by
 * -- `assemora db:migrate`; every other comment in this file is for you.
 * -- +destructive drops column products.legacy_sku
 *
 * -- +migration up
 * alter table "products" add column "sku" varchar(255);
 *
 * -- +migration down
 * alter table "products" drop column "sku";
 * ```
 *
 * One rule makes it parseable and reviewable at the same time: a comment beginning
 * `-- +` is a directive the parser reads, and every other comment is prose it drops.
 * A directive it does not recognise is refused rather than ignored — a typo in
 * `-- +migration down` would otherwise put a `drop` in the section that runs forwards.
 *
 * Statements are separated by `;`, exactly as in SQL anybody would write, so the file
 * is also runnable with `psql -f`. The scanner below is what makes that safe: a
 * semicolon inside a string, a quoted identifier or a dollar-quoted body is part of
 * the statement, not the end of it.
 */

type Section = 'up' | 'down'

/** A tag is empty or starts with a letter, so `$1$2` in a statement is not one. */
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y

const dollarTag = (text: string, index: number): string | undefined => {
  DOLLAR_TAG.lastIndex = index

  return DOLLAR_TAG.exec(text)?.[0]
}

/** The index just past the closing quote. A doubled quote is the character itself. */
const endOfQuoted = (text: string, start: number, quote: string, file: string): number => {
  let index = start + 1

  while (index < text.length) {
    if (text.charAt(index) !== quote) {
      index += 1
      continue
    }

    if (text.charAt(index + 1) === quote) {
      index += 2
      continue
    }

    return index + 1
  }

  throw new ConfigurationError(
    `${file}: a ${quote === "'" ? 'string' : 'quoted name'} is opened and never closed.`,
  )
}

const endOfDollarQuoted = (text: string, from: number, tag: string, file: string): number => {
  const end = text.indexOf(tag, from)

  if (end === -1) throw new ConfigurationError(`${file}: a ${tag} quoted block is never closed.`)

  return end + tag.length
}

/** PostgreSQL nests block comments, so counting depth is the only correct way out. */
const endOfBlockComment = (text: string, start: number, file: string): number => {
  let depth = 0
  let index = start

  while (index < text.length) {
    if (text.startsWith('/*', index)) {
      depth += 1
      index += 2
      continue
    }

    if (text.startsWith('*/', index)) {
      depth -= 1
      index += 2
      if (depth === 0) return index
      continue
    }

    index += 1
  }

  throw new ConfigurationError(`${file}: a /* block comment is opened and never closed.`)
}

/**
 * Reads a migration file back into the statements it holds.
 *
 * A file with no `-- +migration` marker at all is read as an `up` migration, which is
 * what somebody who dropped a plain `.sql` file into the directory meant. `file` is
 * only ever used to name the file in a complaint.
 */
export const parseMigration = (text: string, file: string): MigrationContent => {
  const statements: Record<Section, string[]> = { up: [], down: [] }
  const destructive: string[] = []

  let section: Section = 'up'
  let buffer = ''
  let index = 0

  const flush = (): void => {
    const statement = buffer.trim()
    buffer = ''

    if (statement !== '') statements[section].push(statement)
  }

  const directive = (body: string): void => {
    const parts = body.split(/\s+/)
    const name = parts[0] ?? ''
    const argument = parts.slice(1).join(' ')

    if (name === '+migration') {
      if (argument !== 'up' && argument !== 'down') {
        throw new ConfigurationError(
          `${file}: "-- ${body}" names no section — it is either "up" or "down".`,
        )
      }

      flush()
      section = argument
      return
    }

    if (name === '+destructive') {
      destructive.push(argument)
      return
    }

    throw new ConfigurationError(
      `${file}: "-- ${body}" is not a directive. A comment meant for a reader must not begin ` +
        'with `+`.',
    )
  }

  while (index < text.length) {
    if (text.startsWith('--', index)) {
      const newline = text.indexOf('\n', index)
      const stop = newline === -1 ? text.length : newline
      const body = text.slice(index + 2, stop).trim()

      if (body.startsWith('+')) directive(body)

      index = stop
      continue
    }

    if (text.startsWith('/*', index)) {
      index = endOfBlockComment(text, index, file)
      continue
    }

    const char = text.charAt(index)

    if (char === "'" || char === '"') {
      const end = endOfQuoted(text, index, char, file)
      buffer += text.slice(index, end)
      index = end
      continue
    }

    if (char === '$') {
      const tag = dollarTag(text, index)

      if (tag !== undefined) {
        const end = endOfDollarQuoted(text, index + tag.length, tag, file)
        buffer += text.slice(index, end)
        index = end
        continue
      }
    }

    if (char === ';') {
      flush()
      index += 1
      continue
    }

    buffer += char
    index += 1
  }

  flush()

  return { up: statements.up, down: statements.down, destructive }
}

const statementsText = (statements: readonly string[]): string =>
  statements.map((statement) => `${statement};\n`).join('\n')

/** The text of a migration file, from what the generator produced. */
export const migrationFileText = (name: string, generated: MigrationContent): string =>
  [
    [
      `-- ${name}`,
      '-- Written by `assemora db:generate`. A comment beginning `-- +` is read back by',
      '-- `assemora db:migrate`; every other comment in this file is for you.',
      ...generated.destructive.map((sentence) => `-- +destructive ${sentence}`),
    ].join('\n'),
    '-- +migration up',
    statementsText(generated.up),
    '-- +migration down',
    statementsText(generated.down),
  ].join('\n\n')

/**
 * `0002_add-sku.sql`.
 *
 * The number is what decides the order migrations run in, so a file that does not
 * carry one is refused rather than sorted somewhere arbitrary.
 */
const MIGRATION_FILE = /^(\d+)_([A-Za-z0-9][A-Za-z0-9._-]*)\.sql$/

export type MigrationFile = {
  /** `0002_add-sku` — what the runner records as applied, and what sorts. */
  readonly name: string
  readonly path: string
  readonly number: number
  readonly up: readonly string[]
  readonly down: readonly string[]
  readonly destructive: readonly string[]
}

/**
 * A migration's name, as a filename gives it up.
 *
 * `name` is only what a reader calls it; the number is what orders the run, so it is
 * parsed rather than left to the lexicographic accident of `0010` sorting before `02`.
 */
const numbered = (filename: string, directory: string): { name: string; number: number } => {
  const match = MIGRATION_FILE.exec(filename)

  if (match === null) {
    throw new ConfigurationError(
      `${join(directory, filename)} is not named like a migration. It must be <number>_<name>.sql, ` +
        'for example 0001_add-products.sql.',
    )
  }

  return { name: filename.slice(0, -'.sql'.length), number: Number(match[1] ?? '') }
}

const listing = async (directory: string): Promise<readonly string[]> => {
  try {
    return await readdir(directory)
  } catch (error) {
    // A project that has never generated a migration has no directory yet, and that
    // is a state rather than a failure — it is the one `db:generate` exists to change.
    if (isRecord(error) && error.code === 'ENOENT') return []

    throw error
  }
}

/** Every migration in the directory, in the order they must run. */
export const readMigrations = async (directory: string): Promise<readonly MigrationFile[]> => {
  const filenames = (await listing(directory)).filter((filename) => filename.endsWith('.sql'))
  const found = filenames.map((filename) => ({ filename, ...numbered(filename, directory) }))

  found.sort((left, right) => left.number - right.number || left.name.localeCompare(right.name))

  for (let index = 1; index < found.length; index += 1) {
    const previous = found[index - 1]
    const current = found[index]

    // Two branches that each generated 0004 and were then merged. Applying them in
    // whatever order the filesystem offers leaves two machines with two databases, so
    // the answer is to say so rather than to pick one.
    if (previous !== undefined && current !== undefined && previous.number === current.number) {
      throw new ConfigurationError(
        `${previous.filename} and ${current.filename} share a number, so nothing decides which ` +
          'runs first. Renumber the later one.',
      )
    }
  }

  return Promise.all(
    found.map(async (entry) => {
      const path = join(directory, entry.filename)
      const parsed = parseMigration(await readFile(path, 'utf8'), path)

      return { name: entry.name, path, number: entry.number, ...parsed }
    }),
  )
}

/**
 * What the runner needs, from what the file holds.
 *
 * A migration with no `down` section leaves `down` off entirely rather than carrying
 * an empty list, so `rollbackLastMigration` can refuse it by name instead of quietly
 * running nothing and marking it undone.
 */
const toMigration = (file: MigrationFile): Migration => ({
  name: file.name,
  up: file.up,
  ...(file.down.length === 0 ? {} : { down: file.down }),
})

/** One past the highest number already there, always four digits. */
export const nextMigrationNumber = (filenames: readonly string[]): string => {
  const highest = filenames.reduce((max, filename) => {
    const match = MIGRATION_FILE.exec(filename)

    return match === null ? max : Math.max(max, Number(match[1] ?? ''))
  }, 0)

  return String(highest + 1).padStart(4, '0')
}

/**
 * `Add products!` becomes `add-products`, which is how SPEC.md §34 writes one.
 *
 * Empty is a valid answer, and the caller is what refuses it: a name made entirely of
 * punctuation is a mistake worth naming, not one to paper over with a default.
 */
export const migrationSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** What `db:generate` calls a migration nobody named. */
const DEFAULT_SLUG = 'migration'

/*
 * The snapshot.
 *
 * A diff is taken against this file rather than against a live database, so
 * generation is deterministic, works offline and produces the same migration for two
 * developers whose databases have drifted (ADR-0021).
 */

const SNAPSHOT_FILE = 'schema.json'
const SNAPSHOT_VERSION = 1

const snapshotPath = (loaded: LoadedConfig): string => join(loaded.paths.generated, SNAPSHOT_FILE)

const looksLikeTable = (value: unknown): value is TableDescriptor =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.primaryKey === 'string' &&
  Array.isArray(value.columns) &&
  Array.isArray(value.relations)

/**
 * The schema the last `db:generate` left behind, or `undefined` when there is no
 * snapshot file at all.
 *
 * The two answers are not the same thing and the caller has to tell them apart: an
 * empty snapshot means "the last migration left no tables", where a missing one means
 * "nothing here knows what the last migration did".
 */
const readSnapshot = async (
  loaded: LoadedConfig,
): Promise<readonly TableDescriptor[] | undefined> => {
  const path = snapshotPath(loaded)
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined

    throw error
  }

  const broken = (reason: string): ConfigurationError =>
    new ConfigurationError(
      `${path} ${reason}. It is written by \`assemora db:generate\` and never edited by hand; ` +
        'delete it to regenerate the whole schema as one migration.',
    )

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw broken('is not JSON')
  }

  if (!isRecord(parsed) || parsed.version !== SNAPSHOT_VERSION) {
    throw broken(`was not written by version ${SNAPSHOT_VERSION} of this snapshot format`)
  }

  if (!Array.isArray(parsed.tables) || !parsed.tables.every(looksLikeTable)) {
    throw broken('does not describe a set of tables')
  }

  return parsed.tables
}

const writeSnapshot = async (
  loaded: LoadedConfig,
  migration: string,
  tables: readonly TableDescriptor[],
): Promise<void> => {
  await mkdir(loaded.paths.generated, { recursive: true })
  await writeFile(
    snapshotPath(loaded),
    // The migration is named so that a merge conflict in this file says which two
    // migrations disagree, rather than only that a hundred lines of JSON do.
    `${JSON.stringify({ version: SNAPSHOT_VERSION, migration, tables }, null, 2)}\n`,
  )
}

/*
 * Applying, and what stands in front of it.
 */

type Adapter = ReturnType<typeof currentAdapter>

const isPostgres = (adapter: Adapter): adapter is PostgresAdapter =>
  typeof (adapter as { raw?: unknown }).raw === 'function'

/**
 * The adapter the application registered, if migrations can be run against it.
 *
 * Asking for `raw` and finding nothing is how this fails on the in-memory adapter,
 * and the sentence it fails with is the whole reason to ask at all.
 */
const postgresAdapter = (): PostgresAdapter => {
  const adapter = currentAdapter()

  if (!isPostgres(adapter)) {
    throw new ConfigurationError(
      'Migrations run against PostgreSQL, and the application registered a different database ' +
        'adapter — give it `database: postgres()` to run them.',
    )
  }

  return adapter
}

/**
 * Whether this is a place a destructive statement may run unasked (SPEC.md §34).
 *
 * The CLI has `NODE_ENV` and nothing else to go on, so the question is answered the
 * safe way round: development is the value saying so, and everything else — staging,
 * a typo, an unset variable — is treated as production. A developer who has never set
 * `NODE_ENV` meets `--force` once and reads a sentence naming both the variable and
 * the flag; the alternative failure is a dropped column in production, and only one
 * of those two can be undone.
 */
const DEVELOPMENT = new Set(['development', 'test'])

const inDevelopment = (): boolean => DEVELOPMENT.has(process.env.NODE_ENV ?? '')

/** The `NODE_ENV is not …` half of both refusals, written once. */
const NOT_DEVELOPMENT = 'NODE_ENV is not "development" or "test"'

/*
 * The commands.
 */

/**
 * Why a missing snapshot is refused rather than warned about.
 *
 * Missing, the diff calls every table new. That is the truth for the very first
 * migration and a lie the moment `database/migrations` already holds one: the file
 * this would write re-creates every table, and `assemora db:migrate` fails on the
 * first one that already exists — a failure that arrives later, on a different
 * machine, naming neither the migration nor the statement.
 *
 * The snapshot cannot be reconstructed from the directory either: reading it back
 * would mean executing the SQL those files hold, and this command exists precisely so
 * that generation is deterministic and offline (ADR-0021). So the honest answer is to
 * stop and say which two files disagree. A warning would be read after the migration
 * was written, which is after the damage — and `--force` is there for the project
 * whose migrations were written by hand and never had a snapshot at all.
 */
const refuseWithoutSnapshot = (loaded: LoadedConfig, existing: number): number => {
  fail(
    `${loaded.paths.migrations} already holds ${count(existing, 'migration')}, and there is no ` +
      `schema snapshot at ${snapshotPath(loaded)} to compare the models against. Generating now ` +
      'would write a migration that creates every table again, and `assemora db:migrate` would ' +
      'fail on the first one that already exists.',
  )
  detail(
    'The snapshot is written by `assemora db:generate` and belongs in version control: restore ' +
      'it from there. Pass --force to diff against an empty schema anyway.',
  )

  return 1
}

export const dbGenerate = defineCommand({
  name: 'db:generate',
  group: 'database',
  summary: 'write a migration for everything the models changed',
  usage: 'assemora db:generate [name] [--check] [--force]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)

    // Booting is what imports the project's models, and the registry they declare
    // themselves into is the `after` side of the diff.
    await loadApplication(loaded)

    const after = declaredTables()

    if (after.length === 0) {
      throw new ConfigurationError(
        `${loaded.file}: the application booted but declared no models, so there is no schema to ` +
          'generate from. If it does declare models, the CLI and the project are resolving two ' +
          'different copies of @assemora/data.',
      )
    }

    const snapshot = await readSnapshot(loaded)
    const existing = (await listing(loaded.paths.migrations)).filter((filename) =>
      MIGRATION_FILE.test(filename),
    )

    if (snapshot === undefined && existing.length > 0 && !bool(args, 'force')) {
      return refuseWithoutSnapshot(loaded, existing.length)
    }

    const generated = await generateMigration(snapshot ?? [], after)

    if (generated.up.length === 0) {
      line('The models and the last migration agree. Nothing to generate.')
      return 0
    }

    for (const sentence of generated.destructive) warn(sentence)

    if (bool(args, 'check')) {
      fail(
        `A migration is missing: ${count(generated.up.length, 'statement')} would be written by ` +
          '`assemora db:generate`.',
      )
      for (const statement of generated.up) detail(statement)

      return 1
    }

    const given = args.positionals[0]
    const slug = given === undefined ? DEFAULT_SLUG : migrationSlug(given)

    if (slug === '') {
      fail(`"${given ?? ''}" leaves nothing to name a file with. Use letters and digits.`)
      return 2
    }

    const name = `${nextMigrationNumber(await listing(loaded.paths.migrations))}_${slug}`
    const path = join(loaded.paths.migrations, `${name}.sql`)

    await mkdir(loaded.paths.migrations, { recursive: true })
    await writeFile(path, migrationFileText(name, generated))

    // Only now: a snapshot moved forward past a migration that was never written
    // would silently swallow the change on the next run.
    await writeSnapshot(loaded, name, after)

    ok(`Wrote ${path}`)

    return 0
  },
})

/**
 * Runs the migrations, and says where the run stopped if it did.
 *
 * A statement that PostgreSQL rejects arrives as one redacted sentence naming neither
 * the migration nor the statement (SPEC.md §83) — true of every database error, and
 * useless here, where the file is the unit a person acts on. Each migration commits on
 * its own, so asking again afterwards is what places the failure: what is still pending
 * begins with the one that did not apply.
 *
 * The second question is best effort. A run that failed because the connection went is
 * a run whose status cannot be read either, and the failure that matters is still the
 * first one.
 */
const apply = async (
  run: () => Promise<string[]>,
  status: () => Promise<readonly { readonly name: string; readonly applied: boolean }[]>,
): Promise<string[]> => {
  try {
    return await run()
  } catch (error) {
    const pending = (await status().catch(() => [])).find((entry) => !entry.applied)

    if (pending !== undefined) detail(`The run stopped at ${pending.name}: nothing after it ran.`)

    throw error
  }
}

export const dbMigrate = defineCommand({
  name: 'db:migrate',
  group: 'database',
  summary: 'apply every migration that has not run yet',
  usage: 'assemora db:migrate [--force]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)
    await loadApplication(loaded)

    const adapter = postgresAdapter()
    const files = await readMigrations(loaded.paths.migrations)

    if (files.length === 0) {
      line(`No migrations in ${loaded.paths.migrations}.`)
      return 0
    }

    const migrations = files.map(toMigration)
    const { applyMigrations, migrationStatus } = await import('@assemora/database-postgres')

    // Asked before applying, so that the guard below weighs what is about to run
    // rather than what ran months ago.
    const status = await migrationStatus(adapter, migrations)
    const applied = new Set(status.filter((entry) => entry.applied).map((entry) => entry.name))
    const risky = files.filter((file) => !applied.has(file.name) && file.destructive.length > 0)

    for (const file of risky) {
      for (const sentence of file.destructive) warn(`${file.name}: ${sentence}`)
    }

    if (risky.length > 0 && !inDevelopment() && !bool(args, 'force')) {
      fail(
        `${count(risky.length, 'pending migration')} change or destroy stored data, and ` +
          `${NOT_DEVELOPMENT}. Pass --force to apply them anyway.`,
      )

      return 1
    }

    const ran = await apply(
      () => applyMigrations(adapter, migrations),
      () => migrationStatus(adapter, migrations),
    )

    if (ran.length === 0) {
      line('Every migration is already applied.')
      return 0
    }

    for (const name of ran) line(name)
    ok(`Applied ${count(ran.length, 'migration')}.`)

    return 0
  },
})

export const dbRollback = defineCommand({
  name: 'db:rollback',
  group: 'database',
  summary: 'undo the most recently applied migration',
  usage: 'assemora db:rollback [--force]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)
    await loadApplication(loaded)

    const adapter = postgresAdapter()
    const files = await readMigrations(loaded.paths.migrations)
    const migrations = files.map(toMigration)
    const { migrationStatus, rollbackLastMigration } = await import('@assemora/database-postgres')

    const status = await migrationStatus(adapter, migrations)
    const last = [...status].reverse().find((entry) => entry.applied)

    if (last === undefined) {
      line('Nothing has been applied, so there is nothing to roll back.')
      return 0
    }

    // Every rollback is destructive: it discards whatever the migration wrote, which
    // is the same reason SPEC.md §34 puts `--force` in front of one.
    if (!inDevelopment() && !bool(args, 'force')) {
      fail(
        `Rolling ${last.name} back discards everything it wrote, and ${NOT_DEVELOPMENT}. ` +
          'Pass --force to roll it back anyway.',
      )

      return 1
    }

    const rolled = await rollbackLastMigration(adapter, migrations)

    if (rolled === null) {
      line('Nothing has been applied, so there is nothing to roll back.')
      return 0
    }

    ok(`Rolled ${rolled} back.`)

    return 0
  },
})

export const dbStatus = defineCommand({
  name: 'db:status',
  group: 'database',
  summary: 'list every migration and whether it is applied',
  usage: 'assemora db:status [--json]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)
    await loadApplication(loaded)

    const adapter = postgresAdapter()
    const files = await readMigrations(loaded.paths.migrations)
    const { migrationStatus } = await import('@assemora/database-postgres')
    const status = await migrationStatus(adapter, files.map(toMigration))

    if (bool(args, 'json')) {
      json(status)
      return 0
    }

    if (status.length === 0) {
      line(`No migrations in ${loaded.paths.migrations}.`)
      return 0
    }

    table(status, [
      { header: 'migration', value: (entry) => entry.name },
      { header: 'applied', value: (entry) => (entry.applied ? 'yes' : 'pending') },
      {
        header: 'applied at',
        value: (entry) => (entry.appliedAt === undefined ? '' : entry.appliedAt.toISOString()),
      },
    ])

    const pending = status.filter((entry) => !entry.applied).length

    line()
    line(pending === 0 ? 'Every migration is applied.' : `${count(pending, 'migration')} pending.`)

    return 0
  },
})

register(dbGenerate, dbMigrate, dbRollback, dbStatus)
