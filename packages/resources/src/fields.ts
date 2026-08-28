/**
 * Resource fields (SPEC.md §39).
 *
 * A field is how a column is presented, validated and exposed — to Studio, to REST,
 * to the SDK and to an agent. It never replaces the column: the model owns the data,
 * the resource owns its representation (SPEC.md §35).
 */
import { ValidationError } from '@assemora/core'
import {
  array as arraySchema,
  boolean as booleanSchema,
  enumOf,
  fail,
  type Issue,
  json as jsonSchema,
  nullable as nullableSchema,
  number as numberSchema,
  object as objectSchema,
  ok,
  optional as optionalSchema,
  type Schema,
  type Shape,
  string as stringSchema,
  timestamp as timestampSchema,
  uuid as uuidSchema,
} from '@assemora/schema'

/**
 * The kinds SPEC.md §39 names, and the eight this repository added to them.
 *
 * A kind is a *stored shape* plus the control that edits it. Two names for one shape is
 * how a schema starts lying, so `radio` is not here (it is a `select`, drawn as radios
 * when Studio judges it worth it), nor are `image`, `video` and `file` (they are a
 * `media` with an `accept`, and `image()` and `video()` below build exactly that), nor
 * is `users` (it is a `relation` pointed at the users resource).
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'markdown'
  | 'code'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'checkboxes'
  | 'color'
  | 'json'
  | 'slug'
  | 'url'
  | 'link'
  | 'email'
  | 'media'
  | 'relation'
  | 'table'
  | 'object'
  | 'array'

/** What an agent may do with this field (SPEC.md §52). */
export type AgentPermissions = {
  readonly read: boolean
  readonly write: boolean
}

/** How the field is shown. Kept apart from the builder's setters of the same name. */
export type Presentation = {
  readonly label: string | undefined
  readonly help: string | undefined
  readonly placeholder: string | undefined
}

export type SelectOption = {
  readonly value: string
  readonly label: string
}

export type FieldState<T> = {
  readonly kind: FieldKind
  readonly schema: Schema<T>
  readonly isRequired: boolean
  readonly isSearchable: boolean
  readonly isSortable: boolean
  readonly isFilterable: boolean
  readonly isHidden: boolean
  readonly isReadOnly: boolean
  readonly presentation: Presentation
  readonly agent: AgentPermissions
  /** `select` and `checkboxes`: the values. `code`: the languages offered. */
  readonly options: readonly SelectOption[] | undefined
  /** `slug` only: the field it is derived from. */
  readonly source: string | undefined
  /** `relation` and `media` only: the resource on the other side. */
  readonly target: string | undefined
  /**
   * `media` only: the media types the picker offers, as `image/*` or `application/pdf`.
   *
   * An authoring constraint and deliberately not a validation one. The value is a media
   * id, and what that id points at lives in another table — so the field cannot check it
   * without a read, and a check the field cannot perform must not be published as one.
   * The media library decides what a stored file is served as (SPEC.md §63, §85); this
   * decides what a person is offered.
   */
  readonly accept: readonly string[] | undefined
  /** `array` only. */
  readonly element: AnyField | undefined
  /** `object` only. */
  readonly shape: Readonly<Record<string, AnyField>> | undefined
}

export type Field<T = unknown> = FieldState<T> & { readonly node: 'field' }

/** Any field, for places that only read the metadata. */
export type AnyField = {
  readonly node: 'field'
  readonly kind: FieldKind
  readonly schema: Schema<unknown>
  readonly isRequired: boolean
  readonly isSearchable: boolean
  readonly isSortable: boolean
  readonly isFilterable: boolean
  readonly isHidden: boolean
  readonly isReadOnly: boolean
  readonly presentation: Presentation
  readonly agent: AgentPermissions
  readonly options: readonly SelectOption[] | undefined
  readonly source: string | undefined
  readonly target: string | undefined
  readonly accept: readonly string[] | undefined
  readonly element: AnyField | undefined
  readonly shape: Readonly<Record<string, AnyField>> | undefined
}

export type FieldValue<F> = F extends { readonly schema: Schema<infer T> } ? T : never

/**
 * A field that never reaches serialized output (SPEC.md §28).
 *
 * The marker is a literal, not a boolean, so the resource record type can drop the
 * field as well — a guarantee that only holds at runtime is half a guarantee.
 */
export type HiddenFieldBuilder<T> = Field<T> & {
  readonly isHidden: true
  required(): HiddenFieldBuilder<T>
  searchable(): HiddenFieldBuilder<T>
  sortable(): HiddenFieldBuilder<T>
  filterable(): HiddenFieldBuilder<T>
  hidden(): HiddenFieldBuilder<T>
  readOnly(): HiddenFieldBuilder<T>
  label(text: string): HiddenFieldBuilder<T>
  help(text: string): HiddenFieldBuilder<T>
  placeholder(text: string): HiddenFieldBuilder<T>
  agentAccess(permissions: Partial<AgentPermissions>): HiddenFieldBuilder<T>
}

export type FieldBuilder<T> = Field<T> & {
  /** The value must be present. Studio marks it, validation enforces it. */
  required(): FieldBuilder<T>
  /** Free-text search covers this field (SPEC.md §35). */
  searchable(): FieldBuilder<T>
  sortable(): FieldBuilder<T>
  filterable(): FieldBuilder<T>
  /** Never serialized and never shown (SPEC.md §28). */
  hidden(): HiddenFieldBuilder<T>
  readOnly(): FieldBuilder<T>
  label(text: string): FieldBuilder<T>
  help(text: string): FieldBuilder<T>
  placeholder(text: string): FieldBuilder<T>
  /** Narrows what an agent may do with the field (SPEC.md §52). */
  agentAccess(permissions: Partial<AgentPermissions>): FieldBuilder<T>
}

const DEFAULT_AGENT: AgentPermissions = { read: true, write: true }

const buildHidden = <T>(state: FieldState<T>): HiddenFieldBuilder<T> => ({
  ...state,
  node: 'field',
  isHidden: true,
  required: () => buildHidden({ ...state, isRequired: true }),
  searchable: () => buildHidden({ ...state, isSearchable: true }),
  sortable: () => buildHidden({ ...state, isSortable: true }),
  filterable: () => buildHidden({ ...state, isFilterable: true }),
  hidden: () => buildHidden(state),
  readOnly: () => buildHidden({ ...state, isReadOnly: true }),
  label: (text) => buildHidden({ ...state, presentation: { ...state.presentation, label: text } }),
  help: (text) => buildHidden({ ...state, presentation: { ...state.presentation, help: text } }),
  placeholder: (text) =>
    buildHidden({ ...state, presentation: { ...state.presentation, placeholder: text } }),
  agentAccess: (permissions) =>
    buildHidden({ ...state, agent: { ...state.agent, ...permissions } }),
})

const build = <T>(state: FieldState<T>): FieldBuilder<T> => ({
  ...state,
  node: 'field',
  required: () => build({ ...state, isRequired: true }),
  searchable: () => build({ ...state, isSearchable: true }),
  sortable: () => build({ ...state, isSortable: true }),
  filterable: () => build({ ...state, isFilterable: true }),
  hidden: () => buildHidden({ ...state, isHidden: true }),
  readOnly: () => build({ ...state, isReadOnly: true }),
  label: (text) => build({ ...state, presentation: { ...state.presentation, label: text } }),
  help: (text) => build({ ...state, presentation: { ...state.presentation, help: text } }),
  placeholder: (text) =>
    build({ ...state, presentation: { ...state.presentation, placeholder: text } }),
  agentAccess: (permissions) => build({ ...state, agent: { ...state.agent, ...permissions } }),
})

const start = <T>(kind: FieldKind, schema: Schema<T>, extra: Partial<FieldState<T>> = {}) =>
  build<T>({
    kind,
    schema,
    isRequired: false,
    isSearchable: false,
    isSortable: false,
    isFilterable: false,
    isHidden: false,
    isReadOnly: false,
    presentation: { label: undefined, help: undefined, placeholder: undefined },
    agent: DEFAULT_AGENT,
    options: undefined,
    source: undefined,
    target: undefined,
    accept: undefined,
    element: undefined,
    shape: undefined,
    ...extra,
  })

// --- the field vocabulary of SPEC.md §39 -------------------------------------

export const text = (): FieldBuilder<string> => start('text', stringSchema())

export const textarea = (): FieldBuilder<string> => start('textarea', stringSchema())

export const richText = (): FieldBuilder<string> => start('richText', stringSchema())

export const number = (): FieldBuilder<number> => start('number', numberSchema())

export const boolean = (): FieldBuilder<boolean> => start('boolean', booleanSchema())

/** The same field as `boolean`, named the way Studio shows it (SPEC.md §39). */
export const toggle = (): FieldBuilder<boolean> => start('boolean', booleanSchema())

export const date = (): FieldBuilder<Date> => start('date', timestampSchema())

export const datetime = (): FieldBuilder<Date> => start('datetime', timestampSchema())

export const url = (): FieldBuilder<string> =>
  start('url', stringSchema().pattern(/^https?:\/\/\S+$/, 'Invalid URL'))

export const email = (): FieldBuilder<string> => start('email', stringSchema().email())

export const json = <T = unknown>(): FieldBuilder<T> => start('json', jsonSchema<T>())

/** A URL-safe identifier derived from another field. */
export const slug = (source: string): FieldBuilder<string> =>
  start('slug', stringSchema().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug'), { source })

export const select = <const V extends readonly [string, ...string[]]>(
  ...values: V
): FieldBuilder<V[number]> =>
  start('select', enumOf(...values), {
    options: values.map((value) => ({ value, label: value })),
  })

/** A reference to an item in the media library (SPEC.md §63). */
/**
 * A media type the picker offers: `image/*`, `video/mp4`, `application/pdf`.
 *
 * Checked rather than taken as written because it is handed to a file picker and
 * published in the descriptor. A media type is a short, boring grammar, and anything
 * that is not one is a mistake or an attempt to put something else in an attribute.
 */
const MEDIA_TYPE = /^[a-z]+\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/

/**
 * A reference to an item in the media library (SPEC.md §63).
 *
 * `media('image/*')` narrows what the picker offers. It is not a new kind: the stored
 * value is the same media id either way, and a second kind for it would be a second
 * name for one value.
 */
export const media = (...accept: readonly string[]): FieldBuilder<string> => {
  const invalid = accept.filter((pattern) => !MEDIA_TYPE.test(pattern))

  if (invalid.length > 0) {
    throw new ValidationError([
      {
        path: ['accept'],
        code: 'media_type',
        message: `${invalid.map((pattern) => `"${pattern}"`).join(', ')} is not a media type such as image/* or application/pdf`,
      },
    ])
  }

  const described =
    accept.length === 0
      ? uuidSchema().describe('The id of an item in the media library')
      : uuidSchema().describe(
          `The id of an item in the media library, of type ${accept.join(' or ')}`,
        )

  return start('media', described, {
    target: 'media',
    ...(accept.length === 0 ? {} : { accept }),
  })
}

/** A `media` field the picker narrows to images. `file` is `media()` itself. */
export const image = (): FieldBuilder<string> => media('image/*')

export const video = (): FieldBuilder<string> => media('video/*')

/** A reference to another resource. */
export const relation = (target: string): FieldBuilder<string> =>
  start('relation', uuidSchema(), { target })

// --- the eight kinds SPEC.md §39 left out ------------------------------------

/** A whole number. `number()` accepts `3.5`, and a count, a rank and a year are not. */
export const integer = (): FieldBuilder<number> => start('integer', numberSchema().integer())

/**
 * Several of a fixed list, where `select` is one of it.
 *
 * The value is a set, so a repeated choice is refused rather than stored: a reader that
 * counts the array would otherwise disagree with the boxes the author ticked. Order is
 * the author's, not the declaration's — a list of tags reads in the order it was built.
 */
export const checkboxes = <const V extends readonly [string, ...string[]]>(
  ...values: V
): FieldBuilder<V[number][]> => {
  const inner = arraySchema(enumOf(...values))

  const schema: Schema<V[number][]> = {
    ...inner,
    parse: (value: unknown) => {
      const parsed = inner.parse(value)

      if (!parsed.ok) return parsed

      const seen = new Set<string>()

      for (const [index, chosen] of parsed.value.entries()) {
        if (seen.has(chosen)) return fail('duplicate', `"${chosen}" is chosen twice`, [index])

        seen.add(chosen)
      }

      return ok(parsed.value)
    },
    toJsonSchema: () => ({ ...inner.toJsonSchema(), uniqueItems: true }),
  }

  return start('checkboxes', schema, {
    options: values.map((value) => ({ value, label: value })),
  })
}

/**
 * A colour, and only a colour (SPEC.md §62's lesson, one layer down).
 *
 * Hex in the four lengths CSS accepts, and nothing else. No `rgb()`, `hsl()` or
 * `oklch()` — each is a grammar of its own and a parser per function is four more
 * places for a mistake to become a stylesheet — and no keywords, which mean nothing in
 * a piece of content. The value ends up somewhere a stylesheet is written, and the
 * whole defence is that a string matching this cannot carry a `;`, a `}`, a `url(` or
 * a `</style`. Alpha is covered by the four- and eight-digit forms.
 *
 * What people write instead is `text()` with a pattern, one pattern per project, each
 * one slightly wrong.
 */
export const color = (): FieldBuilder<string> =>
  start(
    'color',
    stringSchema()
      .pattern(
        /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
        'Expected a hex colour such as #4a5ed6',
      )
      .describe('A colour: #rgb, #rgba, #rrggbb or #rrggbbaa'),
  )

/**
 * Markdown source.
 *
 * `richText` claims the value is markup a rich-text editor produced, and `textarea`
 * claims it is prose; a Studio control and a renderer both need to know which of the
 * three this is, and the kind is the only place that can say.
 *
 * Stored as written, including any raw HTML in it — nothing in this repository renders
 * it. A renderer that does owns the decision to sanitize, and stripping here would
 * silently damage legitimate content on the way into the database instead.
 */
export const markdown = (): FieldBuilder<string> =>
  start('markdown', stringSchema().describe('Markdown source'))

/** A program and the language it is written in. */
export type CodeValue = {
  readonly language: string
  readonly source: string
}

/**
 * A language name: `ts`, `sql`, `c++`, `objective-c`.
 *
 * Not a closed list, because a highlighter added by a plugin knows more languages than
 * this repository does, and not a free string either: the name is what a renderer turns
 * into `language-<name>`, so its grammar has to be too small to become anything else.
 */
const CODE_LANGUAGE = /^[a-z][a-z0-9+#-]{0,31}$/

/**
 * Source code, held as its text and the language it is in.
 *
 * Two values, which is why `text()` cannot hold it: the language is lost, and every
 * consumer guesses it back from a file extension nobody stored.
 *
 * `code('sql', 'ts')` narrows the language to a list, which is offered as this field's
 * `options` — the same key `select` uses, so Studio's language picker needs nothing new
 * and a widening rule already covers it.
 *
 * Nothing in this repository executes this value, and nothing renders it as HTML: there
 * is no highlighter, no `eval`, no `dangerouslySetInnerHTML` reached from here. It is a
 * string that happens to be a program, and an application that runs one is doing
 * something this field does not.
 */
export const code = (...languages: readonly string[]): FieldBuilder<CodeValue> => {
  const [first, ...rest] = languages
  const invalid = languages.filter((language) => !CODE_LANGUAGE.test(language))

  if (invalid.length > 0) {
    throw new ValidationError([
      {
        path: ['options'],
        code: 'language',
        message: `${invalid.map((language) => `"${language}"`).join(', ')} is not a language name such as ts or objective-c`,
      },
    ])
  }

  const language =
    first === undefined
      ? stringSchema()
          .pattern(CODE_LANGUAGE, 'Expected a language name such as ts or objective-c')
          .describe('The language this source is written in')
      : enumOf(first, ...rest).describe('The language this source is written in')

  return start(
    'code',
    objectSchema({ language, source: stringSchema().describe('The source itself') }).describe(
      'Source code and the language it is written in',
    ) as Schema<CodeValue>,
    languages.length === 0 ? {} : { options: languages.map((value) => ({ value, label: value })) },
  )
}

/**
 * A time of day, as `HH:MM` on a 24-hour clock.
 *
 * A string and not a `Date`, because `date()` and `datetime()` both carry a day nobody
 * chose, and "half past nine" stored as 1970-01-01T09:30 is a value that goes wrong the
 * first time somebody applies a timezone to it.
 *
 * Minutes only, so every stored time is the same width and therefore sorts and compares
 * as text. Accepting an optional `:SS` would give the same time two spellings and take
 * that away, and a CMS field that needs seconds is asking for a duration.
 */
export const time = (): FieldBuilder<string> =>
  start(
    'time',
    stringSchema()
      .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected a time of day such as 09:30')
      .describe('A time of day on a 24-hour clock, as HH:MM'),
  )

/**
 * A link: either a URL, or a reference to an entry.
 *
 * `type` is required, and it is the only thing a reader has to look at. The alternative
 * — two optional keys and no tag — makes every consumer infer the variant from which
 * key happens to be present, and gives a value carrying both no answer at all.
 */
export type LinkValue =
  | {
      readonly type: 'url'
      readonly url: string
      readonly label?: string
      readonly newTab?: boolean
    }
  | {
      readonly type: 'entry'
      readonly entry: { readonly resource: string; readonly id: string }
      readonly label?: string
      readonly newTab?: boolean
    }

/**
 * The schemes a link may use, as an allowlist.
 *
 * An allowlist and not a denylist of `javascript:`, `data:` and `vbscript:`, because a
 * denylist has to anticipate every spelling of the thing it refuses — casing, embedded
 * tabs, the next scheme a browser adds — and an allowlist has to anticipate nothing.
 * `mailto:` and `tel:` are here because a link field without them sends people back to
 * `text()`, and a relative path is not, because that is what the `entry` variant is.
 */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Whitespace and control characters, refused before anything else is decided.
 *
 * A browser strips tabs, newlines and surrounding spaces before it reads the scheme, so
 * ` javascript:…` and a `javascript:` with a tab inside the word are both `javascript:`
 * to it and neither is to a naive reader. Refusing the whole class first means the
 * scheme read below and the scheme an `href` eventually resolves to cannot differ —
 * which is a stronger rule than stripping the same characters the same way, and it is
 * what makes reading the rest by hand sound.
 */
const UNSAFE_IN_URL = /[\s\p{Cc}]/u

/** RFC 3986's scheme, and everything after the colon. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/

/**
 * Whether this text is a URL a link may hold.
 *
 * Refused *here*, at the field, and not at a renderer: a renderer is one reader of
 * many. The SDK, an export, a generated email and an agent reading the entry over MCP
 * all see the stored value, and a `javascript:` URL that only the page component knows
 * to distrust is a `javascript:` URL that reaches the one reader nobody remembered.
 *
 * Read by hand rather than with the platform's `URL`, which this package cannot name:
 * it compiles against `es2023` and no platform types, for the same reason
 * `@assemora/schema` decodes base64 by hand.
 */
const isSafeHref = (value: string): boolean => {
  if (UNSAFE_IN_URL.test(value)) return false

  const match = SCHEME.exec(value)

  if (match === null) return false

  const scheme = (match[1] ?? '').toLowerCase()
  const rest = match[2] ?? ''

  if (!LINK_SCHEMES.has(`${scheme}:`)) return false

  // A scheme with nothing behind it is not an address: `https:` needs an authority, and
  // `mailto:` and `tel:` need whatever they address. How well formed *that* is, is not
  // this field's business — an address can be valid and wrong, and only a delivery
  // attempt knows which.
  return scheme === 'http' || scheme === 'https' ? /^\/\/[^/?#]/.test(rest) : rest.length > 0
}

/** What a URL may be before it is a payload rather than an address. */
const MAX_URL_LENGTH = 2048

/** A link's own text, and a table's column heading. Both are a label, not a document. */
const LABEL_LENGTH = 255

/** A resource is named the way a collection is (SPEC.md §38). */
const RESOURCE_NAME = /^[a-z][a-z0-9_]*$/

const linkShape = objectSchema({
  type: enumOf('url', 'entry').describe('Which of the two things this link is'),
  url: stringSchema().max(MAX_URL_LENGTH).optional(),
  entry: objectSchema({
    resource: stringSchema().pattern(RESOURCE_NAME, 'Invalid resource name'),
    id: uuidSchema(),
  }).optional(),
  label: stringSchema().max(LABEL_LENGTH).optional(),
  newTab: booleanSchema().optional(),
})

const LINK_DESCRIPTION = `A link. type "url" carries "url", one of ${[...LINK_SCHEMES]
  .map((scheme) => scheme.slice(0, -1))
  .join(', ')}; type "entry" carries "entry" with the resource and the id it points at.`

/**
 * The commonest field in a CMS, and neither `url()` nor `relation()` on its own.
 *
 * `url()` cannot point at an entry, so the link breaks when the entry's slug changes.
 * `relation()` cannot point off the site. Declaring both and a boolean to choose
 * between them is what people write instead, and then every consumer reimplements the
 * choice.
 *
 * Nothing here checks that the entry exists. A `relation()` does not either — there is
 * no foreign key behind one — and a link that is checked on write and dangling by
 * teatime would only be a more expensive way to be wrong.
 */
export const link = (): FieldBuilder<LinkValue> => {
  const schema: Schema<LinkValue> = {
    kind: 'object',
    isOptional: false,
    isNullable: false,
    description: LINK_DESCRIPTION,

    parse: (value: unknown) => {
      const parsed = linkShape.parse(value)

      if (!parsed.ok) return parsed

      const { type, url, entry } = parsed.value
      const rest = {
        ...(parsed.value.label === undefined ? {} : { label: parsed.value.label }),
        ...(parsed.value.newTab === undefined ? {} : { newTab: parsed.value.newTab }),
      }

      if (type === 'url') {
        if (entry !== undefined) {
          return fail('conflict', 'A link of type "url" carries a url, not an entry', ['entry'])
        }
        if (url === undefined) return fail('required', 'A link of type "url" needs a url', ['url'])
        if (!isSafeHref(url)) {
          return fail(
            'scheme',
            `A link must be an absolute URL using ${[...LINK_SCHEMES].map((scheme) => scheme.slice(0, -1)).join(', ')}`,
            ['url'],
          )
        }

        return ok({ type, url, ...rest })
      }

      if (url !== undefined) {
        return fail('conflict', 'A link of type "entry" carries an entry, not a url', ['url'])
      }
      if (entry === undefined) {
        return fail('required', 'A link of type "entry" needs an entry', ['entry'])
      }

      return ok({ type, entry, ...rest })
    },

    // The object form rather than a `oneOf` of the two variants. `oneOf` is the honest
    // JSON Schema and it prints as `unknown` in the generated SDK (SPEC.md §124), so it
    // would describe the field to nobody. `type` is required here, which is the part a
    // reader actually needs; the sentence says the rest.
    toJsonSchema: () => ({ ...linkShape.toJsonSchema(), description: LINK_DESCRIPTION }),
  }

  return start('link', schema)
}

/** Rows of named columns, where the columns are part of the value. */
export type TableValue = {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/**
 * What a grid can be edited as, rather than what JSONB can hold.
 *
 * A table with a thousand columns is not a table anybody drew; it is a payload that
 * every list request then carries. Both bounds are stated in the refusal.
 */
const MAX_TABLE_COLUMNS = 32

const MAX_TABLE_ROWS = 1000

const tableShape = objectSchema({
  columns: arraySchema(stringSchema().min(1).max(LABEL_LENGTH))
    .min(1)
    .max(MAX_TABLE_COLUMNS)
    .describe('The column headings, in order'),
  rows: arraySchema(arraySchema(stringSchema()))
    .max(MAX_TABLE_ROWS)
    .describe('The rows, each holding one cell per column'),
})

const TABLE_DESCRIPTION = `A table: its column headings and its rows. Every row holds exactly one cell per column. At most ${MAX_TABLE_COLUMNS} columns and ${MAX_TABLE_ROWS} rows.`

/**
 * A table whose columns the author chooses.
 *
 * That is the whole difference from `array(object(…))`, and it is the reason this is a
 * kind rather than a control: there, the columns are part of the *schema* and a
 * developer decides them; here they are part of the *value*, so an editor can add one
 * to a pricing table without a deployment.
 *
 * Every cell is a string. A cell that could be a number or a boolean makes every
 * renderer branch on the type of something it is about to print, and the one thing a
 * table cell is always safe to be is text.
 *
 * Rows are refused unless they are exactly as wide as the headings — a ragged table has
 * no honest rendering, and letting one through means every reader carries the code to
 * cope with it.
 */
export const table = (): FieldBuilder<TableValue> => {
  const schema: Schema<TableValue> = {
    kind: 'object',
    isOptional: false,
    isNullable: false,
    description: TABLE_DESCRIPTION,

    parse: (value: unknown) => {
      const parsed = tableShape.parse(value)

      if (!parsed.ok) return parsed

      const { columns, rows } = parsed.value
      const seen = new Set<string>()

      for (const [index, heading] of columns.entries()) {
        if (seen.has(heading)) {
          return fail('duplicate', `Two columns are called "${heading}"`, ['columns', index])
        }

        seen.add(heading)
      }

      for (const [index, row] of rows.entries()) {
        if (row.length !== columns.length) {
          return fail(
            'width',
            `This row holds ${row.length} cells and the table has ${columns.length} columns`,
            ['rows', index],
          )
        }
      }

      return ok({ columns, rows })
    },

    toJsonSchema: () => ({ ...tableShape.toJsonSchema(), description: TABLE_DESCRIPTION }),
  }

  return start('table', schema)
}

// --- nesting -----------------------------------------------------------------

/**
 * What an array's element is called, in a refusal and in the descriptor Studio draws.
 *
 * The definition key, the issue path and the descriptor's name are one word on purpose:
 * an element that is `element` in the JSON, `item` in an error and `entry` in a form is
 * three things to learn about one.
 */
const ELEMENT = 'element'

const hasDefaultAgentAccess = (field: AnyField): boolean =>
  field.agent.read === DEFAULT_AGENT.read && field.agent.write === DEFAULT_AGENT.write

/**
 * The modifiers that mean nothing inside a group, and are therefore refused there.
 *
 * A resource enforces these one field at a time, by name: the projection drops a
 * `hidden()` field from a row, the validator refuses a write to a `readOnly()` one, the
 * agent checks look a name up in `writableFields`, and search, sort and filter address
 * a column or a top-level JSONB key. None of them reach *inside* a value — a group is
 * one document stored under one name — so a `hidden()` field nested in one would be
 * published in OpenAPI, returned by every read and writable by any agent (SPEC.md §28,
 * §52, §85).
 *
 * Refused rather than accepted and ignored. A security flag that silently does nothing
 * is worse than one that does not exist, because somebody will rely on it.
 *
 * `slug` is here for a plainer reason: it derives from another of the *resource's*
 * fields, and inside a group its source names something no derivation will ever read.
 */
const nestingIssues = (name: string, field: AnyField): Issue[] => {
  const issues: Issue[] = []

  const refuse = (key: string, message: string) => {
    issues.push({ path: [name, key], code: 'not_nestable', message })
  }

  if (field.isHidden)
    refuse('hidden', 'hidden() is enforced per field of a resource, not inside a value')
  if (field.isReadOnly)
    refuse('readOnly', 'readOnly() is enforced per field of a resource, not inside a value')
  if (!hasDefaultAgentAccess(field))
    refuse('agent', 'Agent access is enforced per field of a resource, not inside a value')
  if (field.isSearchable) refuse('searchable', 'Search addresses a resource field by name')
  if (field.isSortable) refuse('sortable', 'Sorting addresses a resource field by name')
  if (field.isFilterable) refuse('filterable', 'Filtering addresses a resource field by name')
  if (field.kind === 'slug')
    refuse('kind', 'A slug is derived from another field of the resource, so it has to be one')

  return issues
}

const refuseNesting = (issues: readonly Issue[]): void => {
  if (issues.length > 0) throw new ValidationError(issues)
}

/**
 * A required inner field, refusing an absent value the way the resource's own validator
 * does.
 *
 * Without it an absent key reaches the inner schema as `undefined` and comes back as
 * "Expected a string" — the type of the value that never arrived, rather than the fact
 * that it never arrived (SPEC.md §84).
 */
const requiredSchema = <T>(inner: Schema<T>): Schema<T> => ({
  ...inner,
  parse: (value: unknown) =>
    value === undefined ? fail('required', 'This field is required') : inner.parse(value),
})

/**
 * An inner field's schema, made absent-able unless the field says it is required.
 *
 * And null-able with it, because clearing a field is a normal edit everywhere else
 * (see `validation.ts`) and a group whose empty inputs have to be *deleted* rather than
 * emptied is a group every form gets wrong once.
 */
const innerSchema = (field: AnyField): Schema<unknown> =>
  field.isRequired ? requiredSchema(field.schema) : optionalSchema(nullableSchema(field.schema))

const groupShape = (shape: Readonly<Record<string, AnyField>>): Shape =>
  Object.fromEntries(
    Object.entries(shape).map(([name, field]) => [name, innerSchema(field)]),
  ) satisfies Shape

/**
 * The inferred type of a group.
 *
 * Every key is optional, including a `required()` one — `isRequired` is a runtime flag
 * and not a literal type, so there is nothing here to read it from. The parser still
 * refuses a missing required key; the type is merely quieter than it is, which is the
 * safe direction for a reader to be wrong in.
 */
export type GroupValue<S extends Readonly<Record<string, AnyField>>> = {
  readonly [K in keyof S]?: FieldValue<S[K]>
}

/**
 * A group of fields, stored as one document.
 *
 * The shape is *fields* and not schemas, which is what makes a group drawable: an inner
 * field carries its own label, its help text and whether it is required, and Studio
 * builds the nested form from the same descriptor it builds the outer one from.
 */
export const object = <S extends Readonly<Record<string, AnyField>>>(
  shape: S,
): FieldBuilder<GroupValue<S>> => {
  refuseNesting(Object.entries(shape).flatMap(([name, field]) => nestingIssues(name, field)))

  return start('object', objectSchema(groupShape(shape)) as Schema<GroupValue<S>>, { shape })
}

/** A repeater: any number of one field. */
export const array = <E extends AnyField>(element: E): FieldBuilder<FieldValue<E>[]> => {
  refuseNesting(nestingIssues(ELEMENT, element))

  return start('array', arraySchema(element.schema) as Schema<FieldValue<E>[]>, { element })
}

export { ELEMENT as ELEMENT_NAME }
