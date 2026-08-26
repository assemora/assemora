/**
 * Serving Studio beside the API (SPEC.md §58, ADR-0022).
 *
 * `@assemora/studio` is loaded at run time and is deliberately not a dependency of
 * this package. A hard edge would install a React single-page application into every
 * project that answered "no" to SPEC.md §78's third question, and Studio lives in
 * `apps/` where `pnpm boundaries` does not reach — an edge it could not police is an
 * edge it should not have.
 *
 * The cost of that is this file: nothing typechecks the module on the other side of
 * the import, so what comes back is `unknown` until it has been looked at.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ConfigurationError, type Logger } from '@assemora/core'
import type { HttpServer } from '@assemora/http'

import type { ResolvedStudio } from './options.js'

/**
 * Held in a constant so that TypeScript does not try to resolve it.
 *
 * A literal specifier would have to be a declared dependency to compile, which is the
 * one thing this import exists to avoid.
 */
const STUDIO_ASSETS = '@assemora/studio/assets'

const MISSING =
  'studio: true needs @assemora/studio, which is not installed. Add it to this project ' +
  '(`pnpm add @assemora/studio`), point `studio: { root }` at a bundle of your own, or ' +
  'set `studio: false`.'

const BROKEN =
  '@assemora/studio is installed but does not export studioAssets(). It is probably a ' +
  'different package, or a version older than this one.'

const STUDIO_PACKAGE = '@assemora/studio'
const ASSETS_SUBPATH = './assets'

/**
 * Finds Studio in the *project*, not beside this file.
 *
 * A bare `import('@assemora/studio/assets')` resolves relative to this module, and
 * this package deliberately does not depend on Studio — so under pnpm, whose
 * `node_modules` is not flat, it never resolves, and `studio: true` fails on every
 * install with the package sitting right there in the application. The dependency is
 * the *application's*, so the walk starts where the application was started.
 *
 * `createRequire().resolve()` cannot do this: it asks the exports map under the
 * `require` condition, and Studio publishes an ESM-only subpath. So the package's own
 * declaration is read instead of guessed at, and a Studio that renames its build
 * directory keeps working.
 */
const resolveFromProject = async (from: string): Promise<string | undefined> => {
  let directory = resolve(from)

  for (;;) {
    const manifest = join(directory, 'node_modules', ...STUDIO_PACKAGE.split('/'), 'package.json')
    const contents = await readFile(manifest, 'utf8').catch(() => undefined)

    if (contents !== undefined) {
      const exported = (JSON.parse(contents) as { exports?: Record<string, unknown> }).exports?.[
        ASSETS_SUBPATH
      ]

      const entry =
        typeof exported === 'string'
          ? exported
          : (exported as { import?: unknown } | undefined)?.import

      if (typeof entry === 'string') return join(dirname(manifest), entry)

      return undefined
    }

    const parent = dirname(directory)

    if (parent === directory) return undefined

    directory = parent
  }
}

/** Where the installed Studio put its build. */
const installedRoot = async (): Promise<string> => {
  const resolved = await resolveFromProject(process.cwd())

  const loaded: unknown = await import(
    resolved === undefined ? STUDIO_ASSETS : pathToFileURL(resolved).href
  ).catch(() => {
    throw new ConfigurationError(MISSING)
  })

  const assets = (loaded as { studioAssets?: unknown }).studioAssets

  if (typeof assets !== 'function') throw new ConfigurationError(BROKEN)

  const root: unknown = assets()

  if (typeof root !== 'string') throw new ConfigurationError(BROKEN)

  return root
}

export const mountStudio = async (
  server: HttpServer,
  studio: ResolvedStudio,
  logger: Logger,
): Promise<void> => {
  const root = studio.root ?? (await installedRoot())

  logger.info('Studio is served beside the API', { path: studio.path })

  server.mountAssets({ path: studio.path, root })
}
