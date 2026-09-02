/**
 * A blog module, written the way SPEC.md §99 says it should be possible.
 *
 * Nothing here is framework plumbing: a model, a resource, three blocks, a route, one
 * command and the durable work that command implies. Everything else — the database
 * schema, CRUD, REST, OpenAPI, the SDK, Studio forms and what an agent can see —
 * follows from these declarations.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { command, dispatch, job, module } from '@assemora/core'
import {
  boolean,
  enumOf,
  model,
  number,
  string,
  text as textColumn,
  timestamp,
  uuid,
} from '@assemora/data'
import { route } from '@assemora/http'
import { block, Page } from '@assemora/pages'
import {
  media,
  number as numberField,
  resource,
  richText,
  select,
  slug,
  text,
  toggle,
} from '@assemora/resources'
import { string as stringSchema, uuid as uuidSchema } from '@assemora/schema'

export const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  slug: string().unique(),
  excerpt: textColumn().nullable(),
  content: textColumn(),
  cover: uuid().nullable(),
  status: enumOf('draft', 'published').default('draft'),
  views: number().default(0),
  featured: boolean().default(false),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const Articles = resource(
  Article,
  {
    title: text().required().searchable().sortable().label('Title'),
    slug: slug('title').label('Slug'),
    excerpt: text().searchable().label('Excerpt').help('Shown in listings'),
    content: richText().required().label('Content'),
    cover: media().label('Cover image'),
    status: select('draft', 'published').required().filterable().sortable().label('Status'),
    views: numberField().sortable().filterable().label('Views'),
    featured: toggle().filterable().label('Featured'),
  },
  { label: 'Articles', icon: 'newspaper', defaultSort: '-views', perPage: 10 },
)

export const Hero = block(
  'hero',
  {
    title: text().required().label('Headline'),
    subtitle: text().label('Subtitle'),
    image: media().label('Background'),
    variant: select('centered', 'split').required().label('Layout'),
  },
  {
    label: 'Hero',
    description: 'The first thing a visitor sees',
    icon: 'panel-top',
    group: 'Layout',
  },
)

export const Section = block(
  'section',
  { title: text().label('Heading'), width: select('narrow', 'wide').label('Width') },
  {
    label: 'Section',
    description: 'Holds other blocks',
    icon: 'rows-3',
    group: 'Layout',
    acceptsChildren: true,
    maxChildren: 8,
  },
)

export const Faq = block(
  'faq',
  { question: text().required().label('Question'), answer: richText().required().label('Answer') },
  { label: 'FAQ entry', icon: 'circle-question-mark', group: 'Content' },
)

/** A hand-written route, to show one living beside the generated CRUD (SPEC.md §121). */
export const readBySlug = route.get('/articles/by-slug/:slug', {
  description: 'Reads a published article by its slug',
  tags: ['articles'],
  params: { slug: stringSchema().min(1) },
  response: { id: stringSchema(), title: stringSchema(), content: stringSchema() },
  handler: async ({ params }) => {
    const article = await Article.where('slug', params.slug)
      .where('status', 'published')
      .firstOrFail()

    return { id: article.id, title: article.title, content: article.content }
  },
})

/** Where the built sitemap lands, for a static host or a CDN to serve. */
export const SITEMAP_FILE = join(import.meta.dirname, '../storage/sitemap.xml')

/** The origin the URLs are absolute against; a sitemap holds no relative ones. */
const SITE = process.env.SITE_URL ?? 'http://localhost:4000'

/** A slug is user input, and this is a document somebody else parses. */
const escaped = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const url = (path: string, changed: Date | null): string =>
  [
    '  <url>',
    `    <loc>${escaped(`${SITE}${path}`)}</loc>`,
    ...(changed === null ? [] : [`    <lastmod>${changed.toISOString()}</lastmod>`]),
    '  </url>',
  ].join('\n')

/**
 * What publishing implies (SPEC.md §82).
 *
 * The moment a page or an article becomes public, the file listing every public URL is
 * out of date. Rebuilding it is the shape of work a job is for: it has to happen, it
 * has to survive a restart, and it must not happen inside the request — it reads every
 * published page and every published article, and nobody clicking Publish should wait
 * for that.
 *
 * It is deliberately not an event. SPEC.md §81 keeps events for side effects nobody is
 * worse off for missing; a sitemap that quietly stopped being written is a site that
 * quietly stopped being indexed.
 */
export const GenerateSitemap = job('sitemap.generate', {
  description: 'Rebuilds sitemap.xml from every published page and article',
  /**
   * Why it is being rebuilt, and nothing else.
   *
   * This job reads the world rather than a row, so there is no id to carry, and a
   * payload naming one would be a promise the handler does not keep. What the payload
   * buys instead is a log line saying which publish caused which rebuild.
   */
  input: { reason: stringSchema().min(1) },
  retries: 3,
  handle: async ({ reason }, context) => {
    const published = await Page.where('status', 'published').get()
    const articles = await Article.where('status', 'published').get()

    const urls = [
      ...published
        .filter((page) => page.meta.noIndex !== true)
        .map((page) => url(`/preview?slug=${page.slug}`, page.publishedAt)),
      ...articles.map((article) => url(`/articles/${article.slug}`, article.updatedAt)),
    ]

    const document = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      '</urlset>',
      '',
    ].join('\n')

    await mkdir(dirname(SITEMAP_FILE), { recursive: true })
    await writeFile(SITEMAP_FILE, document, 'utf8')

    // The logger already carries the job's name and the request id of whatever
    // scheduled it, so this line joins the click that caused it (SPEC.md §87).
    context.logger.info('Sitemap rebuilt', { urls: urls.length, reason })
  },
})

/**
 * Publishing one article, and scheduling what that implies.
 *
 * The `dispatch` is the part worth reading twice. It is written *inside* the handler,
 * so the job is held until this transaction commits: an article whose publish rolls
 * back leaves nothing on the queue, and a worker never rebuilds a sitemap around a row
 * that does not exist (ADR-0023).
 */
export const PublishArticle = command('articles.publish', {
  description: 'Publishes an article',
  input: { id: uuidSchema() },
  handle: async ({ id }, context) => {
    const article = await Article.findOrFail(id)
    const before = article.toJSON()

    await context.authorize('articles', 'publish', before)

    await article.update({ status: 'published' })

    context.revise({ entityType: 'articles', entityId: id, before, after: article.toJSON() })
    await dispatch(GenerateSitemap({ reason: `articles.publish ${article.slug}` }))

    return { id, slug: article.slug }
  },
})

export const blog = () =>
  module('blog')
    .models(Article)
    .resources(Articles)
    .routes(readBySlug)
    .commands(PublishArticle)
    .jobs(GenerateSitemap)
    // A page publish changes the same file, and `pages.publish` belongs to
    // `@assemora/pages` — this module cannot dispatch from inside it. A listener is
    // the right seam: it runs after the commit, so the job is handed over immediately
    // rather than held, which is exactly what `dispatch()` outside a command does.
    .on('page.published', ({ slug }) =>
      dispatch(GenerateSitemap({ reason: `pages.publish ${slug}` })),
    )
