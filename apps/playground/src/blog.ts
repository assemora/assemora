/**
 * A blog module, written the way SPEC.md §99 says it should be possible.
 *
 * Nothing here is framework plumbing: a model, a resource, two blocks and a route.
 * Everything else — the database schema, CRUD, REST, OpenAPI, the SDK, Studio forms
 * and what an agent can see — follows from these declarations.
 */
import { module } from '@assemora/core'
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
import { block } from '@assemora/pages'
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
import { string as stringSchema } from '@assemora/schema'

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
  { label: 'Articles', defaultSort: '-views', perPage: 10 },
)

export const Hero = block(
  'hero',
  {
    title: text().required().label('Headline'),
    subtitle: text().label('Subtitle'),
    image: media().label('Background'),
    variant: select('centered', 'split').required().label('Layout'),
  },
  { label: 'Hero', description: 'The first thing a visitor sees' },
)

export const Section = block(
  'section',
  { title: text().label('Heading'), width: select('narrow', 'wide').label('Width') },
  {
    label: 'Section',
    description: 'Holds other blocks',
    acceptsChildren: true,
    maxChildren: 8,
  },
)

export const Faq = block(
  'faq',
  { question: text().required().label('Question'), answer: richText().required().label('Answer') },
  { label: 'FAQ entry' },
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

export const blog = () => module('blog').models(Article).resources(Articles).routes(readBySlug)
