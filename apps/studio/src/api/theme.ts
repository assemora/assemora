/**
 * The theme, as Studio reads and writes it (SPEC.md §62, ADR-0024).
 *
 * Two calls and no third: `theme.get` for the document, `theme.update` for every
 * change to it. Studio decides nothing about what a token means — it edits tokens,
 * and the application renders the stylesheet.
 *
 * The generated stylesheet is read as well, and it is not a third way to the document
 * but a different question. Editing the theme needs the theme; knowing which colours
 * a block may name needs only the names, which every visitor of the site is already
 * given — see `colorTokensOf` below.
 *
 * The shapes are restated here rather than imported. `@assemora/theme` is a server
 * package: it reaches for `node:crypto` to version the stylesheet, so no browser
 * bundle can import it, and Studio may not depend on a feature package anyway
 * (SPEC.md §8). `src/api/pages.ts` restates `pages.get` for the same reason.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query'

import { api } from './client.ts'

/** A stack of family names, most preferred first. */
export type FontStack = readonly string[]

/** Everything a token can hold: a colour or length, a weight or ratio, a stack. */
export type TokenValue = string | number | FontStack

export type ThemeTypography = {
  readonly fonts: Readonly<Record<string, FontStack>>
  readonly sizes: Readonly<Record<string, string>>
  readonly weights: Readonly<Record<string, number>>
  readonly lineHeights: Readonly<Record<string, number>>
}

/**
 * The resolved document: the framework's defaults with this site's overrides on top.
 *
 * The three fixed groups are typed as open maps on purpose. Their keys *are* fixed —
 * the command requires every step of every scale — but this value arrived over the
 * wire, and a type promising each key would be a promise Studio cannot keep. The
 * screen reads them through the scales `@assemora/schema` exports instead.
 */
export type ThemeDocument = {
  readonly colors: Readonly<Record<string, string>>
  readonly typography: ThemeTypography
  readonly spacing: Readonly<Record<string, string>>
  readonly radius: Readonly<Record<string, string>>
  readonly container: Readonly<Record<string, string>>
}

/** What somebody actually set. Every token absent from it is a framework default. */
export type ThemeOverrides = {
  readonly colors?: Readonly<Record<string, string>>
  readonly typography?: {
    readonly fonts?: Readonly<Record<string, FontStack>>
    readonly sizes?: Readonly<Record<string, string>>
    readonly weights?: Readonly<Record<string, number>>
    readonly lineHeights?: Readonly<Record<string, number>>
  }
  readonly spacing?: Readonly<Record<string, string>>
  readonly radius?: Readonly<Record<string, string>>
  readonly container?: Readonly<Record<string, string>>
}

/**
 * What a theme command answers with.
 *
 * Both halves, because the screen needs both: the overrides say which tokens this
 * site decided, and the resolved document is what the stylesheet is rendered from.
 * `cssVersion` changes when and only when the rendered CSS does, which is what keeps
 * the stylesheet's URL from going stale.
 */
export type ThemeState = {
  readonly version: number
  readonly overrides: ThemeOverrides
  readonly tokens: ThemeDocument
  readonly cssVersion: string
}

export type ThemeRead = ThemeState & {
  /** Null until somebody edits the theme: the row is created by the first change. */
  readonly updatedAt: string | null
}

export const useTheme = (): UseQueryResult<ThemeRead> =>
  useQuery({
    queryKey: ['theme'],
    queryFn: ({ signal }) => api.query<ThemeRead>('theme.get', {}, signal),
    // The Design screen holds the document while it is being edited. A refetch under
    // it would throw away what somebody is in the middle of typing; the screen
    // invalidates this query itself once a save has answered.
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Everything a colour token can render to.
 *
 * The exact image of `colorCss` in `@assemora/theme`: hex in the four lengths CSS
 * accepts, `transparent`, and `currentColor`. Nothing else can appear as a colour in
 * a generated stylesheet, because nothing else survives the renderer — so matching
 * this is the same question as "was this declaration written from the colours group",
 * asked of the one artefact Studio can actually read.
 */
const COLOR_VALUE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|currentcolor)$/i

/** `:root { … }`. The generated stylesheet has one; a future one may have several. */
const ROOT_BLOCK = /:root\s*\{([^{}]*)\}/g

const CUSTOM_PROPERTY = /^--([a-z0-9-]+)\s*:\s*(.+)$/

/**
 * The colour tokens a block may name as its background (SPEC.md §61, §62).
 *
 * Read out of the *stylesheet* rather than out of the theme document, and the reason
 * is permission. `theme.get` opens the document — the overrides somebody set, the
 * edit counter, when it was last touched — and asking for it to fill a dropdown means
 * a role that exists to edit pages cannot see one of §61's seven controls unless it
 * is also allowed to read the theme. The colours are not the secret half: the
 * stylesheet is served to every anonymous visitor of the site, so reading it tells an
 * editor nothing their own browser is not already told.
 *
 * It is also the only source that exists in an application configured with
 * `theme: false`. There the query is not registered at all — nobody can call it,
 * administrator included — while the route still answers with the framework defaults,
 * so the colours a block may name are exactly the ones in this sheet.
 *
 * Which properties are colours is decided by their **values**, never by their names.
 * A site that calls a colour `text-muted` is a site rather than an edge case, and
 * `--text-muted` and `--text-md` sit in the same `:root` — what tells them apart is
 * that one holds a colour and the other a length.
 */
export const colorTokensOf = (css: string): readonly string[] => {
  const found: string[] = []

  for (const block of css.matchAll(ROOT_BLOCK)) {
    // A declaration value can never hold a `;` — `@assemora/theme` checks every one
    // against a pattern that excludes it on the way out — so splitting on it cannot
    // cut a value in half.
    for (const declaration of (block[1] ?? '').split(';')) {
      const match = CUSTOM_PROPERTY.exec(declaration.trim())
      const name = match?.[1]

      if (name !== undefined && COLOR_VALUE.test((match?.[2] ?? '').trim())) found.push(name)
    }
  }

  return found.sort()
}

/**
 * The stylesheet this application serves, as the list of colours in it.
 *
 * Keyed under `theme` so that the Design screen's invalidation after a save reaches
 * this too: a colour added there is a background here, without the builder being told
 * about the Design screen.
 */
export const useThemeColors = (): UseQueryResult<readonly string[]> =>
  useQuery({
    queryKey: ['theme', 'stylesheet'],
    queryFn: ({ signal }) => api.text('/theme.css', signal),
    select: colorTokensOf,
    // A theme changes when a person or an applied proposal changes it, which is rare
    // and never in this tab without the invalidation above.
    staleTime: 5 * 60 * 1000,
  })
