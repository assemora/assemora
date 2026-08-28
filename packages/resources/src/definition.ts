/**
 * The whole of what a stored collection definition may say (SPEC.md §37, §43, §86).
 *
 * `field-registry.ts` owns the grammar of one *field*, because that is the part a
 * plugin extends. This owns the document those fields sit in: the API exposure of
 * SPEC.md §43, the columns a collection's entries can be ordered by, and the one rule
 * that applies to a definition somebody is writing rather than to one being read back.
 *
 * It is all declarative data and all of it goes through the parser. A definition is
 * untrusted — an agent holding `collections.create` writes one — so "which endpoints
 * exist" is four booleans checked like every other value, and never anything a caller
 * could put executable behind.
 */
import { ValidationError } from '@assemora/core'
import { boolean, type Issue, object } from '@assemora/schema'

import type { ApiExposure } from './descriptor.js'
import { definitionSchema, type FieldSpec } from './field-registry.js'

/**
 * Which CRUD operations a collection has (SPEC.md §43).
 *
 * Every flag is optional and every one defaults to `true`, so a definition that says
 * nothing has all four — which is what every collection had before this existed, and
 * what `resource(Article, fields)` gives in TypeScript.
 *
 * They mean here exactly what they mean there, which is the whole point: the generated
 * REST paths are not published, *and* `entries.create` refuses for a collection with
 * `create: false`. So a read-only collection is read-only in Studio, over MCP and in the
 * generated SDK too, rather than only at `/api`. Equal rights is the same declaration
 * meaning the same thing whichever way the resource was made.
 *
 * It is a shape, not a permission. Who may perform an operation that exists is a policy
 * (SPEC.md §51); this says whether it exists at all — and the honest reason to reach for
 * it is a collection an integration fills and everybody else only reads.
 */
const apiExposureSchema = object({
  create: boolean().optional(),
  read: boolean().optional(),
  update: boolean().optional(),
  delete: boolean().optional(),
}).describe(
  'Which CRUD operations this collection has. Every flag defaults to true; read covers the listing and the single read. A flag set to false takes the generated REST endpoint away and makes entries.* refuse it everywhere, Studio and MCP included (SPEC.md §43)',
)

/** What a definition asks for. Absent flags are `true`. */
export type ApiSpec = Partial<ApiExposure>

const EVERYTHING: ApiExposure = { create: true, read: true, update: true, delete: true }

/** A definition's `api`, as the four flags a descriptor has to carry. */
export const apiExposureOf = (spec: ApiSpec | undefined): ApiExposure => ({
  ...EVERYTHING,
  ...spec,
})

/**
 * The whole document, which is the fields plus everything around them.
 *
 * Built from `definitionSchema.shape` rather than beside it, so a key added to the
 * field-level grammar arrives here without anybody remembering to repeat it.
 */
export const collectionDefinitionSchema = object({
  ...definitionSchema.shape,
  api: apiExposureSchema.optional(),
})

/**
 * What a collection's entries can be ordered by (SPEC.md §38).
 *
 * The entry's own columns, and only those. A field's value lives inside one JSONB
 * document and the Query AST has no ordering term that reaches into it, so there is
 * nothing here for a collection to add.
 */
export const ENTRY_SORT_FIELDS: ReadonlySet<string> = new Set([
  'createdAt',
  'updatedAt',
  'publishedAt',
  'status',
])

const ORDERED_BY = [...ENTRY_SORT_FIELDS].join(', ')

const UNSORTABLE = `a collection's entries are ordered by the entry's own columns — ${ORDERED_BY} — and by nothing else, because a field's value lives inside one JSONB document and the Query AST has no ordering term that reaches into it. "sort=<field>" is a 422 from entries.list whatever a field claims, so the flag would be stored and never honoured. Leave it out.`

/**
 * The flags a definition may not claim, because nothing could ever honour one.
 *
 * `sortable` is the only one. It was accepted, stored and then silently ignored: the
 * form offered a checkbox, `collections.create` took it, and `GET /api/reviews?sort=score`
 * answered 422 for ever. A declaration that has no effect is worse than a missing
 * feature — somebody ticks it, ships, and finds out from a caller.
 *
 * A collection's own fields, because a *nested* one is already refused a layer earlier
 * and for a different reason: `object()` and `array()` say that sorting addresses a
 * resource field by name, which is as true of a static resource as of this one. This is
 * the rule that is about a collection — the values are one JSONB document and the Query
 * AST has no ordering term that reaches into it, so no field of one can ever be sorted
 * on (see `ENTRY_SORT_FIELDS`).
 *
 * Deliberately not part of `parseDynamicDefinition`. That parser also reads back rows
 * written before this rule existed, and refusing one there would make the boot loader
 * skip the collection — taking content out of a running application, and out of reach
 * of the very `collections.update` that could remove the flag, over a value that never
 * did anything. So the rule guards the door a definition arrives through, and a stored
 * one keeps loading until somebody saves it again.
 */
export const refuseUnhonourableFlags = (fields: readonly FieldSpec[]): void => {
  const issues: Issue[] = fields.flatMap((spec, index) =>
    spec.sortable === true
      ? [
          {
            path: ['fields', index, 'sortable'],
            code: 'not_sortable',
            message: `"${spec.name}" cannot be sortable: ${UNSORTABLE}`,
          },
        ]
      : [],
  )

  if (issues.length > 0) throw new ValidationError(issues)
}
