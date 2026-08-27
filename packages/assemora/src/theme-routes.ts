/**
 * Where a site's tokens become a stylesheet (SPEC.md §62, ADR-0024).
 *
 * `@assemora/theme` owns the document and renders it, and it may not depend on
 * `@assemora/http` (SPEC.md §8) — so the umbrella mounts the addresses, the same
 * arrangement as the login route over `@assemora/auth` and the media URLs over
 * `@assemora/media`.
 *
 * There are two of them, and the pair is the whole design:
 *
 * ```
 * GET /theme.css              a redirect, and never cached
 * GET /theme/<version>.css    the bytes, cached for a year
 * ```
 *
 * A document cannot know the version. It is a hash of the rendered stylesheet, and
 * `index.html` was built long before anybody chose a colour — so a page that had to
 * name a version would name whichever one was current when it was bundled, and serve
 * last week's brand. Instead it links the address that never changes, and that
 * address answers with the address that never goes stale. What a navigation then
 * revalidates is a redirect with no body; the stylesheet every visitor actually
 * downloads is fetched once and kept by every cache between here and them.
 *
 * Both are mounted under the API prefix rather than at the origin root, unlike the
 * frontend bundle. A generated document is not a file somebody built: it is an
 * address this application answers on, and it belongs in `assemora routes` and in the
 * OpenAPI document beside the media bytes.
 */
import type { Logger } from '@assemora/core'
import { bytes, type Route, respond, route } from '@assemora/http'
import { string } from '@assemora/schema'
import {
  defaultTheme,
  resolveTheme,
  THEME_ID,
  Theme,
  type ThemeTokens,
  themeCss,
  themeVersion,
} from '@assemora/theme'

/** The URL carries the hash of its own contents, so those contents cannot change. */
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * The pointer is the one thing in this pair that must never be remembered.
 *
 * Caching it would hand back exactly the staleness the version exists to prevent, and
 * there is nothing to save by caching it: it has no body.
 */
const NEVER = 'no-store'

const versionedPath = (prefix: string, version: string): string => `${prefix}/theme/${version}.css`

/**
 * The document this application serves, or the defaults when it has none to edit.
 *
 * An application without `theme()` still gets a stylesheet, deliberately (ADR-0024):
 * the custom properties `@assemora/react` renders against and the block rules of §61
 * are the same in every Assemora site, and a project that answered no to an editable
 * theme did not thereby ask for pages with no spacing scale.
 *
 * The row is read here rather than through `theme.get`, and this is the one read in
 * this package that does not go through the Query Bus. A policy is asked about a
 * subject and an action, never about which half of an answer a caller receives — so
 * putting this on the bus would mean granting `theme.read` to anonymous visitors,
 * which opens the *document*: the overrides, the edit counter, when it was last
 * touched. A stylesheet is public by construction and the document it is rendered
 * from is not, and a route can insist on that difference where a policy cannot. This
 * one hands over the rendered CSS and nothing else, for the same reason the public
 * page route in `examples/company` reads the published tree itself instead of opening
 * `pages.get` to everybody.
 *
 * A read that fails answers with the defaults rather than with an error, which is the
 * rule `css.ts` states about tokens applied to the route that serves them: dropping
 * what will not render degrades a page, and a stylesheet that fails takes the site
 * down. It is not a hypothetical failure either — it is the likeliest one there is.
 * `theme: true` is the default, so every application that upgrades gains a table, and
 * between the deploy and `assemora db:migrate` this read is a missing relation. Every
 * site's own stylesheet has stopped carrying `--space-*`, `--ink`, `--surface` and
 * the block rules of §61, because ADR-0024 moved them here — so the difference
 * between degrading and failing is the difference between a site with the framework's
 * colours and a site with no styling at all.
 */
const tokensOf = async (editable: boolean, logger: Logger): Promise<ThemeTokens> => {
  if (!editable) return defaultTheme

  try {
    const stored = await Theme.find(THEME_ID)

    return resolveTheme(stored?.tokens)
  } catch (error) {
    // Loudly, because a site quietly serving the defaults for a week is its own kind
    // of outage: the stylesheet is the one thing here nobody gets an error page for.
    logger.error('The theme could not be read; serving the default tokens', {
      error: error instanceof Error ? error.message : String(error),
    })

    return defaultTheme
  }
}

/**
 * "The stylesheet you asked for is over there."
 *
 * Empty, and still typed as CSS: a redirect's body is discarded, and the one browser
 * that ever renders it should get an empty stylesheet rather than a JSON document it
 * was told not to sniff.
 */
const sendTo = (prefix: string, version: string) =>
  respond(
    bytes(new Uint8Array(), 'text/css; charset=utf-8', {
      location: versionedPath(prefix, version),
      'cache-control': NEVER,
    }),
    { status: 302 },
  )

/**
 * @param prefix where this API is mounted, so the redirect names a path a browser can
 *   follow from any document on this origin.
 * @param editable whether `theme()` is registered. Without it the answer is the
 *   defaults, constant, and no table is read.
 * @param logger where a theme that cannot be read is reported, since nothing else
 *   about that failure reaches anybody.
 */
export const themeRoutes = (prefix: string, editable: boolean, logger: Logger): Route[] => [
  route.get('/theme.css', {
    description: 'Redirects to the current stylesheet, which carries its version in its URL',
    tags: ['theme'],
    status: 302,
    handler: async () => sendTo(prefix, themeVersion(await tokensOf(editable, logger))),
  }),

  route.get('/theme/:version.css', {
    description:
      'The theme as a stylesheet: the tokens of SPEC.md §62 and the rules of §61. A version this application no longer renders is redirected to the one it does',
    tags: ['theme'],
    params: { version: string() },
    handler: async ({ params }) => {
      const tokens = await tokensOf(editable, logger)
      const version = themeVersion(tokens)

      // Somebody is holding a version this application no longer renders — a link
      // that outlived an edit, or a document bundled before one. Sending them on is
      // what keeps `immutable` an honest promise: a versioned URL only ever answers
      // with bytes whose hash is that version, so a browser that cached one may keep
      // it for as long as it was told to. Nothing of what was asked for reaches the
      // answer; the location is built from the version this application rendered.
      if (params.version !== version) return sendTo(prefix, version)

      return bytes(Buffer.from(themeCss(tokens), 'utf8'), 'text/css; charset=utf-8', {
        'cache-control': IMMUTABLE,
      })
    },
  }),
]
