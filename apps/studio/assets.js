/**
 * Where Studio's built assets are, for an application that serves them.
 *
 * A generated project mounts Studio beside its API — `server.mountAssets({ path:
 * '/studio', root: studioAssets() })` — so both are on one origin and the session
 * cookie is first-party. This file is plain JavaScript on purpose: it is the only
 * part of Studio that Node loads, and it should need no build step of its own.
 */
import { fileURLToPath } from 'node:url'

/** The directory `vite build` wrote, as an absolute path. */
export const studioAssets = () => fileURLToPath(new URL('./dist/', import.meta.url))

/** Where the published bundle expects to be mounted. */
export const STUDIO_BASE = '/studio'
