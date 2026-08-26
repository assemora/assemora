/**
 * The guide, read at build time.
 *
 * `docs/guide/` is the guide. This module turns those files into pages and never into
 * a second copy of them: nothing here holds a title, an order or a summary that the
 * Markdown does not already carry, so adding `13-something.md` puts it in the
 * navigation with no edit here.
 */
import { Marked, type Token } from 'marked'

/** Every page of the guide, as raw Markdown, inlined into the bundle. */
const sources = import.meta.glob('../../../docs/guide/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Readonly<Record<string, string>>

export type Page = {
  /** The file name without its extension: `03-models`, or `README` for the contents. */
  readonly slug: string
  /** The first `# ` heading. A page has one, and it is the page's name. */
  readonly title: string
  /** `03` for `03-models.md`, and `undefined` for `README.md`. */
  readonly number: string | undefined
  readonly html: string
}

const fileNameOf = (path: string): string => path.split('/').at(-1) ?? path

const slugOf = (path: string): string => fileNameOf(path).replace(/\.md$/, '')

/** Known before anything is rendered, because rendering rewrites links between them. */
const slugs = new Set(Object.keys(sources).map(slugOf))

const REPOSITORY = 'https://github.com/assemora/assemora'

/** Where the guide sits in the repository. Links out of it are resolved from here. */
const GUIDE = 'docs/guide/'

/**
 * What a link in the Markdown becomes in the site.
 *
 * The Markdown is written to be read in a checkout as well as here, so its links are
 * repository paths. A link to another page of the guide becomes a route; anything else
 * relative — `../adr/`, `../../SPEC.md` — is a real file that this site does not hold,
 * so it goes to the repository rather than to a 404.
 */
const hrefFor = (href: string): string => {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-z]+:/i.test(href)) {
    return href
  }

  const [path = '', fragment] = href.split('#')
  const suffix = fragment === undefined ? '' : `#${fragment}`

  if (slugs.has(path.replace(/\.md$/, '')) && !path.includes('/')) {
    return `#/${path.replace(/\.md$/, '')}${suffix}`
  }

  // Resolved against the guide's own directory, so `../../SPEC.md` lands at the root.
  const resolved = new URL(path, `https://assemora.invalid/${GUIDE}`).pathname.slice(1)

  return `${REPOSITORY}/${resolved.endsWith('/') ? 'tree' : 'blob'}/main/${resolved}${suffix}`
}

/**
 * One renderer, configured once.
 *
 * `walkTokens` rewrites the href on the token rather than in the emitted HTML, so the
 * default renderer still does the escaping — a regular expression over finished HTML
 * would be the version of this that eventually mangles a code sample.
 */
const markdown = new Marked({
  walkTokens: (token: Token): void => {
    if (token.type === 'link') token.href = hrefFor(token.href)
  },
})

/** The heading, less its number: `# 3. Models` and `# Models` both read as "Models". */
const titleOf = (source: string, slug: string): string => {
  const heading = /^#\s+(.+)$/m.exec(source)?.[1]

  return (heading ?? slug).replace(/^\d+\.\s*/, '').trim()
}

const numberOf = (slug: string): string | undefined => /^(\d+)-/.exec(slug)?.[1]

const toPage = (path: string, source: string): Page => {
  const slug = slugOf(path)

  return {
    slug,
    title: titleOf(source, slug),
    number: numberOf(slug),
    // `async: false` is stated rather than assumed: `parse` answers with a promise when
    // an extension asks it to, and a page is rendered during a render.
    html: markdown.parse(source, { async: false }),
  }
}

const pages: readonly Page[] = Object.entries(sources)
  .map(([path, source]) => toPage(path, source))
  // The file names carry the order, which is why they are numbered.
  .sort((left, right) => left.slug.localeCompare(right.slug))

/** The table of contents. `docs/guide/README.md` is it. */
export const contents: Page | undefined = pages.find((page) => page.slug === 'README')

/** The numbered pages, in order: what the navigation lists and what next/previous walk. */
export const chapters: readonly Page[] = pages.filter((page) => page.number !== undefined)

export const pageBySlug = (slug: string): Page | undefined =>
  pages.find((page) => page.slug === slug)

/** Where a page sits in the walk, so a reader is never handed a dead end. */
export const neighbours = (
  page: Page,
): { readonly previous: Page | undefined; readonly next: Page | undefined } => {
  const index = chapters.findIndex((chapter) => chapter.slug === page.slug)

  if (index < 0) return { previous: undefined, next: chapters[0] }

  return { previous: chapters[index - 1], next: chapters[index + 1] }
}
