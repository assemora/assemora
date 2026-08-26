/**
 * `assemora.config.ts` — how the CLI finds the project (SPEC.md §79, ADR-0021).
 *
 * The config is the whole of the CLI's knowledge of an application. It hands back an
 * application the CLI boots itself, and every path it declares is relative to the
 * config file rather than to whatever directory the command was typed in, so
 * `assemora db:migrate` means the same thing from `src/` as it does from the root.
 *
 * Node 24 strips TypeScript types natively, so a `.ts` config is imported directly:
 * no transpiler, no dependency, and the file the developer edits is the file that
 * runs.
 */
import { stat } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

import { type Application, AssemoraError, ConfigurationError } from '@assemora/core'
import type { OpenApiInfo } from '@assemora/openapi'
import type { GenerateOptions } from '@assemora/sdk'

export type AssemoraPaths = {
  /** Where `make:*` writes. Defaults to `src`. */
  readonly source?: string
  /** Where `db:generate` writes and `db:migrate` reads. Defaults to `database/migrations`. */
  readonly migrations?: string
  /** Machine-owned output, never edited by hand. Defaults to `.assemora/generated`. */
  readonly generated?: string
}

export type AssemoraConfig = {
  /**
   * How the CLI gets the application.
   *
   * What comes back has *not* been booted: the CLI boots it once, so two commands in
   * one process — and `console`, which is many — share a single application and a
   * single database pool.
   */
  readonly app: () => Application | Promise<Application>
  /** What `dev` and `start` run, relative to the config. */
  readonly server?: string
  readonly paths?: AssemoraPaths
  readonly openapi?: {
    /** Where `api:openapi` writes when `--out` is not given. */
    readonly out?: string
    readonly info?: OpenApiInfo
  }
  readonly sdk?: GenerateOptions & {
    /** Where `sdk:generate` writes when `--out` is not given. */
    readonly out?: string
  }
}

/**
 * Identity, plus types.
 *
 * It exists so that the object is checked where it is written, which is the only
 * place a mistake in it is cheap to fix.
 */
export const defineConfig = (config: AssemoraConfig): AssemoraConfig => config

/** In the order they are looked for, in each directory, on the way up. */
export const CONFIG_FILENAMES = ['assemora.config.ts', 'assemora.config.js'] as const

export const DEFAULT_PATHS = {
  source: 'src',
  migrations: 'database/migrations',
  generated: '.assemora/generated',
} as const satisfies Required<AssemoraPaths>

/** `paths`, defaulted and made absolute. */
export type ResolvedPaths = {
  readonly source: string
  readonly migrations: string
  readonly generated: string
}

export type LoadedConfig = {
  /** The default export, exactly as it was written. */
  readonly config: AssemoraConfig
  /** Absolute path of the config file that was found. */
  readonly file: string
  /** The directory holding it. Every relative path in the config is relative to this. */
  readonly root: string
  readonly paths: ResolvedPaths
  /** `server`, made absolute, or undefined when the config declares none. */
  readonly server: string | undefined
  /** Makes any other path the config carries absolute. An absolute one is left alone. */
  resolve(path: string): string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const findConfig = async (from: string): Promise<string | undefined> => {
  let directory = from

  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(directory, name)
      if (await isFile(candidate)) return candidate
    }

    const parent = dirname(directory)
    if (parent === directory) return undefined

    directory = parent
  }
}

/** Every complaint names the file and the field, because that is where the fix goes. */
const invalid = (file: string, field: string, expected: string): ConfigurationError =>
  new ConfigurationError(`${file}: "${field}" ${expected}`)

const optionalString = (value: unknown, file: string, field: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(file, field, 'must be a non-empty path')
  }

  return value
}

const optionalRecord = (
  value: unknown,
  file: string,
  field: string,
): Record<string, unknown> | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw invalid(file, field, 'must be an object')

  return value
}

const requiredString = (value: unknown, file: string, field: string): void => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(file, field, 'must be a non-empty string')
  }
}

/**
 * Checks the shape of the default export.
 *
 * A config is ordinary TypeScript that ran a moment ago, so nothing here can be
 * trusted to be what it claims. What survives this is cast once, deliberately, and
 * that cast is the only place the declared type meets the imported value.
 */
const validate = (imported: unknown, file: string): AssemoraConfig => {
  if (!isRecord(imported) || imported.default === undefined) {
    throw new ConfigurationError(
      `${file} has no default export. It must \`export default defineConfig({ app: … })\`.`,
    )
  }

  const declared = imported.default

  if (!isRecord(declared)) {
    throw new ConfigurationError(
      `${file}: the default export must be the object defineConfig() returns`,
    )
  }

  if (typeof declared.app !== 'function') {
    throw invalid(
      file,
      'app',
      "must be a function returning the application, for example: app: () => import('./src/app.ts').then((module) => module.createApp())",
    )
  }

  optionalString(declared.server, file, 'server')

  const paths = optionalRecord(declared.paths, file, 'paths')
  if (paths !== undefined) {
    optionalString(paths.source, file, 'paths.source')
    optionalString(paths.migrations, file, 'paths.migrations')
    optionalString(paths.generated, file, 'paths.generated')
  }

  const openapi = optionalRecord(declared.openapi, file, 'openapi')
  if (openapi !== undefined) {
    optionalString(openapi.out, file, 'openapi.out')

    const info = optionalRecord(openapi.info, file, 'openapi.info')
    if (info !== undefined) {
      requiredString(info.title, file, 'openapi.info.title')
      requiredString(info.version, file, 'openapi.info.version')
    }
  }

  const sdk = optionalRecord(declared.sdk, file, 'sdk')
  if (sdk !== undefined) {
    optionalString(sdk.out, file, 'sdk.out')
    optionalString(sdk.clientModule, file, 'sdk.clientModule')
  }

  return declared as AssemoraConfig
}

/**
 * Finds the project's config, walking up from `cwd`, and validates it.
 *
 * Walking up is what lets a command be typed from anywhere inside the project, which
 * is how every other tool a developer already has behaves.
 */
export const loadConfig = async (cwd: string): Promise<LoadedConfig> => {
  const from = resolvePath(cwd)
  const file = await findConfig(from)

  if (file === undefined) {
    throw new ConfigurationError(
      `No ${CONFIG_FILENAMES.join(' or ')} in ${from} or any directory above it. ` +
        'Run the command inside an Assemora project, or create one with `assemora new`.',
    )
  }

  let imported: unknown

  try {
    imported = await import(pathToFileURL(file).href)
  } catch (error) {
    // The cause carries the real stack — a syntax error points at their line, not
    // ours — and `run --debug` walks it.
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `${file} could not be imported: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const config = validate(imported, file)
  const root = dirname(file)
  const resolve = (path: string): string => resolvePath(root, path)
  const declared = config.paths ?? {}

  return {
    config,
    file,
    root,
    paths: {
      source: resolve(declared.source ?? DEFAULT_PATHS.source),
      migrations: resolve(declared.migrations ?? DEFAULT_PATHS.migrations),
      generated: resolve(declared.generated ?? DEFAULT_PATHS.generated),
    },
    server: config.server === undefined ? undefined : resolve(config.server),
    resolve,
  }
}
