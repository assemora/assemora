/**
 * What editing looks like (SPEC.md §35, §39).
 *
 * A model says what is stored; a resource says how a person works with it. Studio
 * draws these forms, `GET /api/articles` filters, searches, sorts and paginates by
 * them, and an agent asking `assemora.describe` is told the same thing.
 */
import {
  datetime,
  relation,
  resource,
  richText,
  select,
  slug,
  text,
  textarea,
  toggle,
} from '@assemora/resources'

import { Article, Author, Category } from './models.ts'

export const Authors = resource(
  Author,
  {
    name: text().required().searchable().sortable().label('Name'),
    slug: slug('name').label('Slug'),
    bio: textarea().searchable().label('Biography'),
    /**
     * Plain text rather than a picker, because there is no `users` resource to pick
     * from: `@assemora/auth` registers models, commands and queries but declares no
     * resource, so accounts are managed in Studio's own Users section rather than as
     * content. Paste an id here to let that account edit this author's articles.
     */
    userId: text().label('Account').help('The id of the login that writes as this author'),
  },
  { label: 'Authors', defaultSort: 'name', perPage: 20 },
)

export const Categories = resource(
  Category,
  {
    name: text().required().searchable().sortable().label('Name'),
    slug: slug('name').label('Slug'),
  },
  { label: 'Categories', defaultSort: 'name' },
)

export const Articles = resource(
  Article,
  {
    title: text().required().searchable().sortable().label('Title'),
    slug: slug('title').label('Slug'),
    excerpt: textarea().searchable().label('Excerpt').help('Shown in listings and in search'),
    body: richText().required().label('Body'),
    status: select('draft', 'published').required().filterable().sortable().label('Status'),
    featured: toggle().filterable().label('Featured'),
    // `relation()` names the resource on the other side, so Studio offers a picker
    // over it and an agent is told which collection the id belongs to.
    authorId: relation('authors').required().label('Author'),
    categoryId: relation('categories').label('Category'),
    publishedAt: datetime().sortable().label('Published'),
  },
  { label: 'Articles', defaultSort: '-publishedAt', perPage: 20 },
)
