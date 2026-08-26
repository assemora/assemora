/**
 * How the Next.js half talks to the application (SPEC.md §48).
 *
 * It is an ordinary HTTP client, and that is the point: the frontend has no privileged
 * access, no database connection and no import of the application's own code. It calls
 * the same REST endpoints the SDK, Studio and an agent call, and it is refused by the
 * same policies.
 *
 * `@assemora/sdk` is safe here because it depends on `@assemora/schema` and on nothing
 * else. `createClient` is its generic runtime; `pnpm sdk:generate` writes a typed
 * client over it in `app/lib/sdk.ts`, generated from the Schema Registry — see the
 * README for the two-line swap.
 */
// assemora:if pages
import type { BlockTree } from '@assemora/schema'
// assemora:end
import { createClient, SdkError } from '@assemora/sdk'

/** Where `assemora start` is listening. Reached by this server, never by a browser. */
const url = `${process.env.ASSEMORA_URL ?? 'http://127.0.0.1:4000'}/api`

/**
 * The token the seed printed, held by this server alone.
 *
 * Next.js only exposes an environment variable to the browser when its name begins
 * `NEXT_PUBLIC_`, so this one cannot leak into a bundle. It grants two read
 * permissions and nothing else (see `src/server.ts`), which is why a compromised
 * frontend is a disclosure of already-published content rather than a way in.
 */
const token = process.env.ASSEMORA_TOKEN

/** Anonymous reads: published articles, published pages. */
export const api = createClient({ url, ...(token === undefined ? {} : { token }) })

/**
 * Whether a failure means "this project has no ASSEMORA_TOKEN yet".
 *
 * A first run has none, and every read is then a 401 — which is correct, and useless
 * as a first impression. The pages that call these functions turn it into the one
 * sentence that fixes it instead.
 */
export const isUnauthenticated = (error: unknown): boolean =>
  error instanceof SdkError && (error.status === 401 || error.status === 403)

// assemora:if pages
/**
 * One page, as a reader gets it.
 *
 * Written out here because a query declares an input schema and not yet an output
 * one, so nothing generates this type — the one shape in this project that is
 * described twice, and the reason is recorded rather than hidden.
 */
export type PageContent = {
  readonly id: string
  readonly title: string
  readonly tree: BlockTree
}

/**
 * A published page, by slug.
 *
 * `pages.get` answers with the published tree unless it is asked for a draft, so a
 * visitor cannot be shown unpublished work because a parameter was forgotten.
 */
export const readPage = (slug: string): Promise<PageContent> =>
  api.request<PageContent>('get', '/queries/pages.get', { query: { slug } })

/**
 * A draft, read as whoever is looking at it.
 *
 * The builder canvas asks for this, and it deliberately does *not* use the token
 * above: a draft is unpublished work, so the editor's own session decides whether
 * they may see it. The cookie is forwarded from the request Next.js is answering.
 */
export const readDraft = (id: string, cookie: string): Promise<PageContent> =>
  createClient({ url, headers: { cookie } }).request<PageContent>('get', '/queries/pages.get', {
    query: { id, mode: 'draft' },
  })
// assemora:end
