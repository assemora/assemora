/**
 * The blog a visitor sees (SPEC.md §41).
 *
 * Generated CRUD is for people who are signed in: `GET /api/articles` goes through
 * `entries.list`, which the article policy guards, and a policy cannot say "published
 * ones only" because it never sees the filter a caller asked for. A route can, because
 * it writes the filter itself — `Article.published()` is not a suggestion the caller
 * may drop.
 *
 * These two are therefore the whole public surface of this blog, and they are the
 * pattern to copy whenever anonymous readers need content: return exactly what is
 * public, from a query you control.
 */
import { route } from '@assemora/http'
import { array, object, string, timestamp } from '@assemora/schema'

import { Article } from './models.ts'

/**
 * What `.with()` produced.
 *
 * The relation is loaded at run time; it is not added to the record type, because
 * ADR-0010 erased a relation target's type so that two models could reference each
 * other at all. One narrowing lives here and the rest of the file reads normally.
 */
type Related = { readonly name: string; readonly slug: string }

type Loaded = typeof Article.$infer & {
  readonly author?: Related | null
  readonly category?: Related | null
}

const loaded = (rows: readonly unknown[]): readonly Loaded[] => rows as readonly Loaded[]

const brief = (row: Related | null | undefined) =>
  row === null || row === undefined ? null : { name: row.name, slug: row.slug }

const card = (article: Loaded) => ({
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  publishedAt: article.publishedAt,
  author: brief(article.author),
  category: brief(article.category),
})

const related = object({ name: string(), slug: string() }).nullable()

/** Declared once: the listing promises a card, and the article promises a card plus prose. */
const summary = {
  slug: string(),
  title: string(),
  excerpt: string().nullable(),
  publishedAt: timestamp().nullable(),
  author: related,
  category: related,
}

export const listArticles = route.get('/blog/articles', {
  description: 'Published articles, newest first',
  tags: ['blog'],
  // A route validates its query string; it does not convert it. Everything in a URL
  // is text, so a filter is text and anything numeric would have to be read by hand.
  query: { category: string().optional() },
  response: { articles: array(object(summary)) },
  handler: async ({ query }) => {
    let found = Article.published().with('author', 'category').latest('publishedAt')

    if (query.category !== undefined) found = found.where('categoryId', query.category)

    // One statement for the articles and one for each relation — never one per row
    // (SPEC.md §89).
    return { articles: loaded(await found.take(20)).map(card) }
  },
})

export const readArticle = route.get('/blog/articles/:slug', {
  description: 'One published article, by slug',
  tags: ['blog'],
  params: { slug: string().min(1) },
  response: { ...summary, body: string() },
  errors: [{ code: 'NOT_FOUND', status: 404, description: 'No published article has that slug' }],
  handler: async ({ params }) => {
    // A draft shares the slug space with what is published, and `firstOrFail` answers
    // 404 rather than leaking the difference between "not written" and "not yet live".
    const found = await Article.published()
      .where('slug', params.slug)
      .with('author', 'category')
      .firstOrFail()

    const article = found as unknown as Loaded

    return { ...card(article), body: article.body }
  },
})

export const blogRoutes = [listArticles, readArticle] as const
