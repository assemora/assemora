/**
 * How a person edits an `Article` (SPEC.md §35).
 *
 * The model says what is stored; the resource says what editing it is like. Studio
 * draws this form, `GET /api/articles` searches, filters, sorts and paginates by it,
 * and an agent asking `assemora.describe` is told the same thing. A field left out
 * here is simply not editable — which is how a column stays out of a form without a
 * second schema being written to say so.
 */
import { datetime, resource, richText, slug, text, toggle } from '@assemora/resources'

import { Article } from '../models/article.ts'

export const Articles = resource(
  Article,
  {
    title: text().required().searchable().sortable().label('Title'),
    /** Studio fills this in from the title, and still lets it be edited. */
    slug: slug('title').label('Slug'),
    body: richText().required().label('Body'),
    published: toggle().filterable().label('Published'),
    // Shown and sorted on, never edited: the column is filled by `timestamp().created()`.
    // A resource sorts by the fields it declares, so `defaultSort` needs this line.
    createdAt: datetime().readOnly().sortable().label('Created'),
  },
  { label: 'Articles', defaultSort: '-createdAt', perPage: 20 },
)
