/**
 * What the blocks of `src/blocks.ts` look like (SPEC.md §57).
 *
 * One renderer draws a page, and it is this one: Studio's canvas loads this very
 * bundle in its iframe, so a preview cannot drift from what a visitor sees.
 */
import { AssemoraPage, type BlockViewProps, createBlockRegistry } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { useEffect, useState } from 'react'

const HeroView = ({
  props,
}: BlockViewProps<{ readonly title?: string; readonly subtitle?: string }>) => (
  <header className="hero">
    <h1>{props.title}</h1>
    {props.subtitle !== undefined && <p>{props.subtitle}</p>}
  </header>
)

const ProseView = ({ props }: BlockViewProps<{ readonly body?: string }>) => (
  <div className="prose">{props.body}</div>
)

/** Exactly the shape `GET /api/blog/articles` promises in `src/routes.ts`. */
type ArticleCard = {
  readonly slug: string
  readonly title: string
  readonly excerpt: string | null
  readonly publishedAt: string | null
  readonly author: { readonly name: string } | null
  readonly category: { readonly name: string } | null
}

/**
 * The block whose content is not in its props.
 *
 * It reads the public route rather than `entries.list`, and therefore without a
 * session: `/api/articles` is the signed-in library and would refuse a visitor, while
 * `/api/blog/articles` is the published feed and is meant to be read by anybody.
 */
const ArticleListView = ({
  props,
}: BlockViewProps<{
  readonly heading?: string
  readonly category?: string
  readonly limit?: number
}>) => {
  const [articles, setArticles] = useState<readonly ArticleCard[]>([])
  const { category } = props

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      const filter =
        category === undefined || category === '' ? '' : `?category=${encodeURIComponent(category)}`

      const response = await fetch(`/api/blog/articles${filter}`, { signal: controller.signal })

      if (response.ok) {
        setArticles(((await response.json()) as { articles: readonly ArticleCard[] }).articles)
      }
    }

    load().catch(() => undefined)

    return () => controller.abort()
  }, [category])

  return (
    <section className="feed">
      {props.heading !== undefined && <h2>{props.heading}</h2>}
      {articles.slice(0, props.limit ?? 5).map((article) => (
        <article key={article.slug}>
          <h3>
            <a href={`/blog/${article.slug}`}>{article.title}</a>
          </h3>
          {article.excerpt !== null && <p>{article.excerpt}</p>}
          <p className="byline">
            {article.author?.name ?? 'Anonymous'}
            {article.category === null ? '' : ` · ${article.category.name}`}
          </p>
        </article>
      ))}
    </section>
  )
}

/**
 * Drawn where a block type has no view here.
 *
 * A stored page outlives the code that renders it: a block dropped from this project
 * is still in every tree that used it.
 */
const MissingView = ({ block }: BlockViewProps) => (
  <p className="missing">No view is registered for a “{block.type}” block.</p>
)

export const blocks = createBlockRegistry(
  { hero: HeroView, prose: ProseView, articleList: ArticleListView },
  { fallback: MissingView },
)

/**
 * Reads one page through the Query Bus, with the session cookie, because reading is
 * denied by default like everything else (SPEC.md §50).
 *
 * A blog whose *pages* are public serves a published tree from a route it writes
 * itself — `examples/company` does exactly that, and explains why it cannot be a
 * policy over `pages.get`.
 */
export const readTree = async (parameters: Record<string, string>): Promise<BlockTree> => {
  const query = new URLSearchParams(parameters)
  const response = await fetch(`/api/queries/pages.get?${query.toString()}`, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      `The page could not be loaded (${response.status}). Pages here are read through the ` +
        'authorized query, so sign in first — examples/company serves its pages publicly.',
    )
  }

  return ((await response.json()) as { tree: BlockTree }).tree
}

export type SiteProps = {
  readonly tree: BlockTree
  /** Marks each block in the DOM so the builder can find it. Off for a visitor. */
  readonly editing?: boolean
}

export const Site = ({ tree, editing = false }: SiteProps) => (
  <AssemoraPage page={{ tree }} blocks={blocks} editing={editing} />
)
