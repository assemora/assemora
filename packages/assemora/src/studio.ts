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

/** Where the installed Studio put its build. */
const installedRoot = async (): Promise<string> => {
  const loaded: unknown = await import(STUDIO_ASSETS).catch(() => {
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
