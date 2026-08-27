/**
 * Migrations, as files (SPEC.md §34).
 *
 * Two things are under test here and nothing else. A migration file is written by one
 * command and read back by another, so the format has to survive the round trip
 * exactly — a semicolon inside a string is not the end of a statement, and a comment a
 * person wrote is not part of one. And a destructive statement has to meet a refusal
 * before it meets a production database.
 *
 * The runner itself is not: `applyMigrations` opens a connection pool, and what this
 * package owns is what it is handed, not what it does with it.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { clearAdapter, clearModelRegistry, model, string, useAdapter, uuid } from '@assemora/data'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseArgs } from '../args.js'
import { captureOutput } from '../output.js'
import { shutdown } from '../project.js'
import type { CliCommand } from '../registry.js'
import {
  dbGenerate,
  dbMigrate,
  dbRollback,
  dbStatus,
  migrationFileText,
  migrationSlug,
  nextMigrationNumber,
  parseMigration,
  readMigrations,
} from './db.js'

/**
 * The two packages a migration is made of, stubbed.
 *
 * They are separate on purpose, and the stubs keep them separate: the diff knows no
 * dialect and lives in `@assemora/database`, the SQL and the runner live in
 * `@assemora/database-postgres` (ADR-0021). `db:*` reaches the second through a
 * dynamic import, so replacing the module is the seam that covers it.
 */
const neutral = vi.hoisted(() => ({ diffSchema: vi.fn() }))

const postgres = vi.hoisted(() => ({
  migrationSql: vi.fn(),
  applyMigrations: vi.fn(),
  migrationStatus: vi.fn(),
  rollbackLastMigration: vi.fn(),
}))

vi.mock('@assemora/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...neutral,
}))
vi.mock('@assemora/database-postgres', () => postgres)

type Adapter = Parameters<typeof useAdapter>[0]

/**
 * An adapter the commands can look at.
 *
 * None of them queries one — `db:*` asks whether `raw` is there and then hands the
 * adapter to the runner, which is stubbed above — so the shape is cast once here
 * rather than satisfied by four methods nothing calls.
 */
const asAdapter = (value: Record<string, unknown>): Adapter => value as unknown as Adapter

const postgresAdapter = (): Adapter =>
  asAdapter({ raw: () => Promise.resolve({ rows: [], rowCount: 0 }) })

/** What the in-memory adapter looks like from here: everything except `raw`. */
const otherAdapter = (): Adapter => asAdapter({})

/** The smallest application `loadApplication` accepts, written where Node can run it. */
const CONFIG = `const app = {
  boot: () => app,
  shutdown: () => undefined,
  registry: {},
  commands: {},
  queries: {},
}

export default { app: () => app }
`

const roots: string[] = []

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-cli-db-'))
  roots.push(root)
  await writeFile(join(root, 'assemora.config.ts'), CONFIG)

  return root
}

const migrationsIn = (root: string): string => join(root, 'database', 'migrations')

const snapshotIn = (root: string): string => join(root, '.assemora', 'generated', 'schema.json')

const writeMigration = async (root: string, filename: string, text: string): Promise<void> => {
  await mkdir(migrationsIn(root), { recursive: true })
  await writeFile(join(migrationsIn(root), filename), text)
}

/** A table shape the snapshot reader accepts, which is all these tests need it to be. */
const snapshotTable = (name: string): Record<string, unknown> => ({
  name,
  primaryKey: 'id',
  columns: [],
  relations: [],
})

const writeSnapshot = async (root: string, tables: readonly unknown[]): Promise<void> => {
  await mkdir(join(root, '.assemora', 'generated'), { recursive: true })
  await writeFile(
    snapshotIn(root),
    `${JSON.stringify({ version: 1, migration: '0001_initial', tables }, null, 2)}\n`,
  )
}

const declareModels = (): void => {
  model('products', { id: uuid().primary(), title: string() })
}

/** `run()` is the kernel's; a group is drivable on its own, and these tests keep it so. */
const invoke = (command: CliCommand, argv: readonly string[], cwd: string): Promise<number> =>
  command.handler({ args: parseArgs(argv), cwd })

beforeEach(() => {
  clearModelRegistry()
  neutral.diffSchema.mockReturnValue({ changes: [] })
  postgres.migrationSql.mockReturnValue({ up: [], down: [], destructive: [] })
  postgres.migrationStatus.mockResolvedValue([])
  postgres.applyMigrations.mockResolvedValue([])
  postgres.rollbackLastMigration.mockResolvedValue(null)
})

afterEach(async () => {
  await shutdown()
  clearAdapter()
  clearModelRegistry()
  vi.unstubAllEnvs()
  vi.clearAllMocks()

  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('the migration file', () => {
  it('gives back exactly the statements it was written from', () => {
    const generated = {
      up: ['create table if not exists "products" (\n  "id" uuid primary key\n)'],
      down: ['drop table if exists "products" cascade'],
      destructive: [],
    }

    expect(parseMigration(migrationFileText('0001_add-products', generated), 'x.sql')).toEqual({
      up: generated.up,
      down: generated.down,
      destructive: [],
    })
  })

  it('does not end a statement at a semicolon inside a string literal', () => {
    const generated = {
      up: [`alter table "products" add constraint "c" check ("kind" in ('a;b', 'c''d'))`],
      down: [],
      destructive: [],
    }

    expect(parseMigration(migrationFileText('0002_kinds', generated), 'x.sql').up).toEqual(
      generated.up,
    )
  })

  it('does not end a statement at a semicolon inside a quoted name', () => {
    const parsed = parseMigration('alter table "od;d" drop column "x";', 'x.sql')

    expect(parsed.up).toEqual(['alter table "od;d" drop column "x"'])
  })

  it('does not end a statement inside a dollar-quoted body', () => {
    const statement =
      'create function f() returns void as $body$ begin end; $body$ language plpgsql'
    const parsed = parseMigration(`${statement};\n`, 'x.sql')

    expect(parsed.up).toEqual([statement])
  })

  it('carries the destructive sentences the generator wrote, so db:migrate can read them back', () => {
    const generated = {
      up: ['alter table "products" drop column "sku"'],
      down: ['alter table "products" add column "sku" varchar(255)'],
      destructive: ['drops column products.sku'],
    }

    const parsed = parseMigration(migrationFileText('0003_drop-sku', generated), 'x.sql')

    expect(parsed.destructive).toEqual(['drops column products.sku'])
  })

  it('drops the prose a person wrote and keeps only the statements', () => {
    const parsed = parseMigration(
      [
        '-- why: the old column was never filled in',
        '/* nor was /* this one */ */',
        'drop table "old";',
      ].join('\n'),
      'x.sql',
    )

    expect(parsed.up).toEqual(['drop table "old"'])
  })

  it('reads a file with no markers at all as an up migration', () => {
    const parsed = parseMigration('create table "a" ();\ncreate table "b" ();\n', 'x.sql')

    expect(parsed).toEqual({
      up: ['create table "a" ()', 'create table "b" ()'],
      down: [],
      destructive: [],
    })
  })

  it('leaves down empty when the file declares no statements for it', () => {
    const parsed = parseMigration(
      '-- +migration up\ncreate table "a" ();\n-- +migration down\n',
      'x.sql',
    )

    expect(parsed.down).toEqual([])
  })

  it('refuses a directive it does not recognise, rather than silently dropping it', () => {
    expect(() => parseMigration('-- +migrate up\nselect 1;\n', 'x.sql')).toThrow(/not a directive/)
  })

  it('refuses a section that is neither up nor down, because a typo would reverse a drop', () => {
    expect(() => parseMigration('-- +migration dwon\ndrop table "a";\n', 'x.sql')).toThrow(
      /either "up" or "down"/,
    )
  })

  it('refuses a string that is opened and never closed', () => {
    expect(() => parseMigration(`insert into "a" values ('unterminated);\n`, 'x.sql')).toThrow(
      /never closed/,
    )
  })
})

describe('numbering', () => {
  it('starts at 0001 when nothing has been generated', () => {
    expect(nextMigrationNumber([])).toBe('0001')
  })

  it('is one past the highest number there, not one past how many files there are', () => {
    expect(nextMigrationNumber(['0001_a.sql', '0007_b.sql'])).toBe('0008')
  })

  it('ignores anything that is not a numbered migration', () => {
    expect(nextMigrationNumber(['README.md', '.gitkeep'])).toBe('0001')
  })
})

describe('naming', () => {
  it('turns what was typed into something a filename can hold', () => {
    expect(migrationSlug('Add Products!')).toBe('add-products')
  })

  it('leaves nothing behind for a name made entirely of punctuation', () => {
    expect(migrationSlug('!!!')).toBe('')
  })
})

describe('reading the migrations directory', () => {
  it('is empty when the directory does not exist yet', async () => {
    const root = await project()

    expect(await readMigrations(migrationsIn(root))).toEqual([])
  })

  it('orders by number rather than by the order the filesystem lists them', async () => {
    const root = await project()
    await writeMigration(root, '0010_last.sql', 'select 10;')
    await writeMigration(root, '0002_middle.sql', 'select 2;')
    await writeMigration(root, '0001_first.sql', 'select 1;')

    const files = await readMigrations(migrationsIn(root))

    expect(files.map((file) => file.name)).toEqual(['0001_first', '0002_middle', '0010_last'])
  })

  it('refuses two migrations sharing a number, because a merge decides nothing about order', async () => {
    const root = await project()
    await writeMigration(root, '0004_theirs.sql', 'select 1;')
    await writeMigration(root, '0004_mine.sql', 'select 2;')

    await expect(readMigrations(migrationsIn(root))).rejects.toThrow(/share a number/)
  })

  it('refuses a .sql file that carries no number at all', async () => {
    const root = await project()
    await writeMigration(root, 'initial.sql', 'select 1;')

    await expect(readMigrations(migrationsIn(root))).rejects.toThrow(/<number>_<name>\.sql/)
  })

  it('ignores everything that is not a .sql file', async () => {
    const root = await project()
    await writeMigration(root, '0001_first.sql', 'select 1;')
    await writeFile(join(migrationsIn(root), 'README.md'), 'notes\n')

    expect((await readMigrations(migrationsIn(root))).map((file) => file.name)).toEqual([
      '0001_first',
    ])
  })
})

describe('db:generate', () => {
  it('says so and writes nothing when the models and the snapshot agree', async () => {
    const root = await project()
    declareModels()

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('Nothing to generate')
    expect(await readMigrations(migrationsIn(root))).toEqual([])
  })

  it('diffs against the snapshot on disk rather than against a database', async () => {
    const root = await project()
    declareModels()
    await writeSnapshot(root, [snapshotTable('products')])

    const output = captureOutput()
    await invoke(dbGenerate, ['db:generate'], root)
    output.restore()

    expect(neutral.diffSchema).toHaveBeenCalledWith(
      [snapshotTable('products')],
      expect.arrayContaining([expect.objectContaining({ name: 'products' })]),
    )
  })

  it('writes the migration and moves the snapshot on to it', async () => {
    const root = await project()
    declareModels()
    neutral.diffSchema.mockReturnValue({ changes: ['whatever a change is'] })
    postgres.migrationSql.mockReturnValue({
      up: ['create table "products" ()'],
      down: ['drop table "products"'],
      destructive: [],
    })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', 'Add products'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('0001_add-products.sql')

    const files = await readMigrations(migrationsIn(root))
    expect(files.map((file) => file.name)).toEqual(['0001_add-products'])
    expect(files[0]?.up).toEqual(['create table "products" ()'])
    expect(files[0]?.down).toEqual(['drop table "products"'])

    const snapshot: unknown = JSON.parse(await readFile(snapshotIn(root), 'utf8'))
    expect(snapshot).toMatchObject({ version: 1, migration: '0001_add-products' })
  })

  it('numbers the new migration one past the highest already there', async () => {
    const root = await project()
    declareModels()
    await writeMigration(root, '0009_earlier.sql', 'select 1;')
    // The snapshot is what `0009` left behind. Without one the command refuses rather
    // than numbering a migration that would create every table a second time.
    await writeSnapshot(root, [snapshotTable('products')])
    postgres.migrationSql.mockReturnValue({ up: ['select 1'], down: [], destructive: [] })

    const output = captureOutput()
    await invoke(dbGenerate, ['db:generate', 'later'], root)
    output.restore()

    expect(output.stdout).toContain('0010_later.sql')
  })

  it('warns about every destructive change, naming the table and the column', async () => {
    const root = await project()
    declareModels()
    postgres.migrationSql.mockReturnValue({
      up: ['alter table "products" drop column "sku"'],
      down: [],
      destructive: ['drops column products.sku'],
    })

    const output = captureOutput()
    await invoke(dbGenerate, ['db:generate', 'drop-sku'], root)
    output.restore()

    expect(output.stderr).toContain('warning: drops column products.sku')
  })

  it('--check refuses and writes nothing when a migration is missing', async () => {
    const root = await project()
    declareModels()
    postgres.migrationSql.mockReturnValue({
      up: ['create table "products" ()'],
      down: [],
      destructive: [],
    })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', '--check'], root)
    output.restore()

    expect(code).toBe(1)
    expect(output.stderr).toContain('A migration is missing')
    expect(await readMigrations(migrationsIn(root))).toEqual([])
  })

  it('--check succeeds when there is nothing to generate', async () => {
    const root = await project()
    declareModels()

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', '--check'], root)
    output.restore()

    expect(code).toBe(0)
  })

  it('leaves the snapshot where it was when the migration file cannot be written', async () => {
    const root = await project()
    declareModels()
    await writeSnapshot(root, [snapshotTable('products')])
    // The directory the migration wants is already a file, so writing it fails.
    await mkdir(join(root, 'database'), { recursive: true })
    await writeFile(migrationsIn(root), 'not a directory\n')

    postgres.migrationSql.mockReturnValue({ up: ['select 1'], down: [], destructive: [] })

    const output = captureOutput()
    await expect(invoke(dbGenerate, ['db:generate', 'doomed'], root)).rejects.toThrow()
    output.restore()

    const snapshot: unknown = JSON.parse(await readFile(snapshotIn(root), 'utf8'))
    expect(snapshot).toMatchObject({ migration: '0001_initial' })
  })

  it('refuses an empty model registry rather than generating a migration that drops everything', async () => {
    const root = await project()

    await expect(invoke(dbGenerate, ['db:generate'], root)).rejects.toThrow(/declared no models/)
  })

  it('refuses a name that leaves nothing to call a file, and says the invocation was wrong', async () => {
    const root = await project()
    declareModels()
    postgres.migrationSql.mockReturnValue({ up: ['select 1'], down: [], destructive: [] })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', '???'], root)
    output.restore()

    expect(code).toBe(2)
  })

  /*
   * The snapshot is what says which tables already exist. Missing, the diff calls
   * every table new — true for the first migration, and a lie the moment
   * `database/migrations` already holds one, which is the checkout of a teammate who
   * received the migrations without `.assemora/`.
   */
  it('refuses to diff against nothing when the migrations directory says otherwise', async () => {
    const root = await project()
    declareModels()
    await writeMigration(root, '0001_initial.sql', 'create table "products" ();')
    postgres.migrationSql.mockReturnValue({
      up: ['create table "products" ()'],
      down: [],
      destructive: [],
    })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', 'add-sku'], root)
    output.restore()

    expect(code).toBe(1)
    expect(output.stderr).toContain('no schema snapshot')
    expect(output.stderr).toContain('--force')

    // The whole point of the refusal: nothing was written, so nothing has to be
    // noticed and deleted before `db:migrate` is run.
    expect((await readMigrations(migrationsIn(root))).map((file) => file.name)).toEqual([
      '0001_initial',
    ])
  })

  it('refuses the same for --check, which would otherwise fail CI over a whole schema', async () => {
    const root = await project()
    declareModels()
    await writeMigration(root, '0001_initial.sql', 'create table "products" ();')
    postgres.migrationSql.mockReturnValue({
      up: ['create table "products" ()'],
      down: [],
      destructive: [],
    })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', '--check'], root)
    output.restore()

    expect(code).toBe(1)
    expect(output.stderr).toContain('no schema snapshot')
    expect(output.stderr).not.toContain('A migration is missing')
  })

  it('generates against an empty schema when --force says that is what was meant', async () => {
    const root = await project()
    declareModels()
    await writeMigration(root, '0001_by-hand.sql', 'select 1;')
    postgres.migrationSql.mockReturnValue({
      up: ['create table "products" ()'],
      down: [],
      destructive: [],
    })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', 'everything', '--force'], root)
    output.restore()

    expect(code).toBe(0)
    expect((await readMigrations(migrationsIn(root))).map((file) => file.name)).toEqual([
      '0001_by-hand',
      '0002_everything',
    ])
  })

  it('is not refused by a migrations directory holding no migration', async () => {
    const root = await project()
    declareModels()
    await mkdir(migrationsIn(root), { recursive: true })
    await writeFile(join(migrationsIn(root), 'README.md'), 'how we migrate\n')
    postgres.migrationSql.mockReturnValue({ up: ['select 1'], down: [], destructive: [] })

    const output = captureOutput()
    const code = await invoke(dbGenerate, ['db:generate', 'initial'], root)
    output.restore()

    expect(code).toBe(0)
    expect((await readMigrations(migrationsIn(root))).map((file) => file.name)).toEqual([
      '0001_initial',
    ])
  })

  it('refuses a snapshot it could not have written', async () => {
    const root = await project()
    declareModels()
    await mkdir(join(root, '.assemora', 'generated'), { recursive: true })
    await writeFile(snapshotIn(root), '{ not json\n')

    await expect(invoke(dbGenerate, ['db:generate'], root)).rejects.toThrow(/is not JSON/)
  })
})

describe('the adapter the migrations run against', () => {
  it('says what is wrong in one sentence when it is not PostgreSQL', async () => {
    const root = await project()
    useAdapter(otherAdapter())

    await expect(invoke(dbMigrate, ['db:migrate'], root)).rejects.toThrow(
      /Migrations run against PostgreSQL/,
    )
  })
})

describe('db:migrate', () => {
  it('hands the runner the statements the files hold, in number order', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    await writeMigration(
      root,
      '0001_first.sql',
      '-- +migration up\ncreate table "a" ();\n-- +migration down\ndrop table "a";\n',
    )
    await writeMigration(root, '0002_second.sql', '-- +migration up\ncreate table "b" ();\n')

    const output = captureOutput()
    await invoke(dbMigrate, ['db:migrate'], root)
    output.restore()

    // The second declares no down section, so it carries none: `rollbackLastMigration`
    // refuses it by name rather than marking it undone having run nothing.
    expect(postgres.applyMigrations).toHaveBeenCalledWith(expect.anything(), [
      { name: '0001_first', up: ['create table "a" ()'], down: ['drop table "a"'] },
      { name: '0002_second', up: ['create table "b" ()'] },
    ])
  })

  it('says the directory is empty rather than reaching for the database', async () => {
    const root = await project()
    useAdapter(postgresAdapter())

    const output = captureOutput()
    const code = await invoke(dbMigrate, ['db:migrate'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('No migrations in')
    expect(postgres.applyMigrations).not.toHaveBeenCalled()
  })

  it('refuses a pending destructive migration outside development until --force is passed', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'production')
    await writeMigration(
      root,
      '0001_drop-sku.sql',
      '-- +destructive drops column products.sku\n-- +migration up\nalter table "products" drop column "sku";\n',
    )

    const output = captureOutput()
    const code = await invoke(dbMigrate, ['db:migrate'], root)
    output.restore()

    expect(code).toBe(1)
    expect(output.stderr).toContain('--force')
    expect(postgres.applyMigrations).not.toHaveBeenCalled()
  })

  it('applies it once --force says so, and still warns about what it destroys', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'production')
    postgres.applyMigrations.mockResolvedValue(['0001_drop-sku'])
    await writeMigration(
      root,
      '0001_drop-sku.sql',
      '-- +destructive drops column products.sku\n-- +migration up\nalter table "products" drop column "sku";\n',
    )

    const output = captureOutput()
    const code = await invoke(dbMigrate, ['db:migrate', '--force'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stderr).toContain('warning: 0001_drop-sku: drops column products.sku')
    expect(postgres.applyMigrations).toHaveBeenCalled()
  })

  it('applies it without --force in development', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'development')
    postgres.applyMigrations.mockResolvedValue(['0001_drop-sku'])
    await writeMigration(
      root,
      '0001_drop-sku.sql',
      '-- +destructive drops column products.sku\n-- +migration up\nalter table "products" drop column "sku";\n',
    )

    const output = captureOutput()
    const code = await invoke(dbMigrate, ['db:migrate'], root)
    output.restore()

    expect(code).toBe(0)
    expect(postgres.applyMigrations).toHaveBeenCalled()
  })

  it('names the migration the run stopped at, which the database error never does', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    await writeMigration(root, '0001_first.sql', 'create table "a" ();')
    await writeMigration(root, '0002_second.sql', 'create table "b" ();')

    postgres.migrationStatus
      .mockResolvedValueOnce([
        { name: '0001_first', applied: false },
        { name: '0002_second', applied: false },
      ])
      // Asked again once it failed: the runner commits each migration on its own, so
      // what is still pending afterwards begins with the one that did not apply.
      .mockResolvedValueOnce([
        { name: '0001_first', applied: true },
        { name: '0002_second', applied: false },
      ])
    postgres.applyMigrations.mockRejectedValue(new Error('The database rejected the operation'))

    const output = captureOutput()
    await expect(invoke(dbMigrate, ['db:migrate'], root)).rejects.toThrow(/rejected/)
    output.restore()

    expect(output.stderr).toContain('0002_second')
  })

  it('still reports a failure it cannot place, rather than swallowing it', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    await writeMigration(root, '0001_first.sql', 'create table "a" ();')

    postgres.migrationStatus
      .mockResolvedValueOnce([{ name: '0001_first', applied: false }])
      .mockRejectedValueOnce(new Error('the connection is gone'))
    postgres.applyMigrations.mockRejectedValue(new Error('The database rejected the operation'))

    const output = captureOutput()
    await expect(invoke(dbMigrate, ['db:migrate'], root)).rejects.toThrow(/rejected/)
    output.restore()
  })

  it('does not ask for --force over a destructive migration that already ran', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'production')
    postgres.migrationStatus.mockResolvedValue([{ name: '0001_drop-sku', applied: true }])
    await writeMigration(
      root,
      '0001_drop-sku.sql',
      '-- +destructive drops column products.sku\n-- +migration up\nalter table "products" drop column "sku";\n',
    )

    const output = captureOutput()
    const code = await invoke(dbMigrate, ['db:migrate'], root)
    output.restore()

    expect(code).toBe(0)
    expect(postgres.applyMigrations).toHaveBeenCalled()
  })
})

describe('db:rollback', () => {
  it('refuses outside development until --force, because a rollback always discards', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'production')
    postgres.migrationStatus.mockResolvedValue([{ name: '0001_first', applied: true }])
    await writeMigration(root, '0001_first.sql', 'create table "a" ();')

    const output = captureOutput()
    const code = await invoke(dbRollback, ['db:rollback'], root)
    output.restore()

    expect(code).toBe(1)
    expect(output.stderr).toContain('0001_first')
    expect(postgres.rollbackLastMigration).not.toHaveBeenCalled()
  })

  it('says there is nothing to roll back rather than asking for --force', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    vi.stubEnv('NODE_ENV', 'production')
    await writeMigration(root, '0001_first.sql', 'create table "a" ();')

    const output = captureOutput()
    const code = await invoke(dbRollback, ['db:rollback'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('nothing to roll back')
  })

  it('rolls the last applied migration back and names it', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    postgres.migrationStatus.mockResolvedValue([{ name: '0001_first', applied: true }])
    postgres.rollbackLastMigration.mockResolvedValue('0001_first')
    await writeMigration(root, '0001_first.sql', 'create table "a" ();')

    const output = captureOutput()
    const code = await invoke(dbRollback, ['db:rollback'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('Rolled 0001_first back.')
  })
})

describe('db:status', () => {
  it('prints every migration and whether it is applied', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    postgres.migrationStatus.mockResolvedValue([
      { name: '0001_first', applied: true, appliedAt: new Date('2026-08-26T10:00:00.000Z') },
      { name: '0002_second', applied: false },
    ])
    await writeMigration(root, '0001_first.sql', 'select 1;')
    await writeMigration(root, '0002_second.sql', 'select 2;')

    const output = captureOutput()
    const code = await invoke(dbStatus, ['db:status'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('0001_first')
    expect(output.stdout).toContain('2026-08-26T10:00:00.000Z')
    expect(output.stdout).toContain('pending')
    expect(output.stdout).toContain('1 migration pending.')
  })

  it('answers --json with the states themselves, because the next thing is a pipe', async () => {
    const root = await project()
    useAdapter(postgresAdapter())
    postgres.migrationStatus.mockResolvedValue([{ name: '0001_first', applied: false }])
    await writeMigration(root, '0001_first.sql', 'select 1;')

    const output = captureOutput()
    await invoke(dbStatus, ['db:status', '--json'], root)
    output.restore()

    expect(JSON.parse(output.stdout)).toEqual([{ name: '0001_first', applied: false }])
  })

  it('says the directory is empty rather than printing a bare header', async () => {
    const root = await project()
    useAdapter(postgresAdapter())

    const output = captureOutput()
    const code = await invoke(dbStatus, ['db:status'], root)
    output.restore()

    expect(code).toBe(0)
    expect(output.stdout).toContain('No migrations in')
  })
})
