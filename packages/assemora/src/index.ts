/**
 * `assemora` — the umbrella (SPEC.md §9, ADR-0022).
 *
 * ```ts
 * export default assemora({
 *   database: postgres(),
 *   modules: [auth(), pages({ blocks }), media(), blog()],
 *   studio: true,
 *   api: true,
 *   mcp: true,
 * })
 * ```
 *
 * It is the only package allowed to depend on everything, because it is the only one
 * nothing depends on: a cycle through it is impossible, which is what makes the
 * exception to SPEC.md §8 safe rather than a hole in it. `pnpm boundaries` fails on
 * any edge pointing here.
 *
 * What it owns is the wiring, and nothing else. It registers the database adapter and
 * the storage driver, adds the three modules a developer should not have to list,
 * constructs the application with the secure ports, and declares the routes no
 * package below may declare — the login endpoints over `@assemora/auth`, the media
 * URLs over `@assemora/media`, the MCP endpoint over `@assemora/mcp` — because each
 * of those is forbidden to depend on `@assemora/http`.
 *
 * Module factories are imported from the packages that own them. Re-exporting `auth`,
 * `pages` or `media` here would give every one of them two import specifiers, which
 * is exactly the drift a single Schema Registry exists to prevent.
 */

export { type AssemoraApplication, assemora } from './assemora.js'
export { CSRF_COOKIE } from './auth-routes.js'
export type {
  ApiOptions,
  AssemoraOptions,
  FrontendOptions,
  JobsOptions,
  JobWorker,
  McpOptions,
  MediaOptions,
  ProjectOptions,
  RateWindow,
  SessionOptions,
  StudioOptions,
} from './options.js'
