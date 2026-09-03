/**
 * Serving this application's own frontend (SPEC.md §59).
 *
 * Studio's builder canvas is an iframe, and what it loads is *this* — the real
 * renderer, with this application's block views and this application's theme. That is
 * the whole reason the canvas is an iframe: what an editor sees is not a second
 * implementation of the page.
 *
 * It is served at the origin root rather than under the API prefix, because a bundle
 * is not an endpoint: a stylesheet has nothing to say in OpenAPI, and the canvas asks
 * for `/preview` relative to the origin it is already on. Everything static serving
 * gets wrong — a path climbing out of the root, a type guessed from bytes, a cached
 * entry document pointing at the previous deploy's assets — is `mountAssets`'s
 * problem, and it is solved once there rather than again here.
 */
import { stat } from 'node:fs/promises'

import type { Logger, RegistryEntry, SchemaRegistry } from '@assemora/core'
import type { HttpServer } from '@assemora/http'

import type { ResolvedFrontend } from './options.js'

/**
 * Where this application's own frontend is served.
 *
 * In the registry because Studio has to know it and cannot be told any other way: it is
 * a pre-built artifact shipped in a package, so a build-time constant would be one value
 * for every deployment, and its builder canvas frames *this* frontend at whatever path
 * this deployment put it. `/preview` was that constant, and it stopped being true the
 * moment an application served its site at the origin root.
 *
 * One entry, whose name is the path — the same shape the languages take, and for the
 * same reason: a deployment fact several subsystems read, described once.
 */
export type FrontendDescriptor = RegistryEntry

declare module '@assemora/core' {
  interface RegistrySections {
    frontend: FrontendDescriptor
  }
}

/** A directory that is not there yet, or a `dist` nobody built. */
const isBuilt = async (root: string): Promise<boolean> =>
  stat(root)
    .then((found) => found.isDirectory())
    .catch(() => false)

/**
 * A missing bundle is a warning rather than a refusal: `assemora dev` may well be
 * started before `vite build` has ever run, and the canvas is the only thing that
 * suffers. Silence would be worse — an empty iframe with a 404 in a console nobody
 * has open is the least diagnosable failure in the builder.
 */
export const mountPreview = async (
  server: HttpServer,
  frontend: ResolvedFrontend,
  logger: Logger,
  registry?: SchemaRegistry,
): Promise<void> => {
  registry?.register('frontend', { name: frontend.path })

  if (!(await isBuilt(frontend.root))) {
    logger.warn('The frontend bundle is missing, so the builder canvas has nothing to frame', {
      root: frontend.root,
      path: frontend.path,
    })
  }

  server.mountAssets({
    path: frontend.path,
    root: frontend.root,
    immutable: frontend.immutableAssets,
  })
}
