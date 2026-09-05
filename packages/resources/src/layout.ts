/**
 * How a resource's form is arranged (SPEC.md §58, ADR-0033).
 *
 * Three levels, which are the three levels of the entry screen: tabs, sections, fields
 * — plus the column beside the form, `aside`. A layout says *where* a field is drawn
 * and nothing about what it is: validation, OpenAPI, the SDK and the MCP schema read
 * the fields and never this. It is declarative data with no function in it, so it
 * reaches Studio as JSON and an agent through `assemora.describe` (ADR-0027).
 *
 * A layout can come from three places, and the registry carries which:
 *
 * - **declared**, in `resource(…, { layout })`, by whoever wrote the resource;
 * - **stored**, by `resources.arrange` — an administrator on the form screen, or an
 *   agent — in one JSONB row per resource, which wins over the declaration;
 * - nothing, in which case Studio derives one from the kinds of the fields, as it
 *   always has.
 *
 * One rule matters more than the rest: a layout cannot hide a field. A field the
 * layout does not name is still drawn, in a trailing section, because a developer who
 * adds a column to a model must not have it vanish from the form for the want of a
 * line here. Hiding is `hidden()` and permissions, and nothing else.
 */
import type { Said } from '@assemora/core'
import type { Issue } from '@assemora/schema'

import type { ResourceFieldDescriptor } from './descriptor.js'

/** A field in a section: its name, or its name and how much of the row it takes. */
export type LayoutField = string | { readonly field: string; readonly width?: 'full' | 'half' }

/**
 * When a section is shown: while a field of the same form holds a value, or holds
 * anything at all. Data, evaluated by whoever draws the form against what is typed in
 * it — never by the server, which validates the fields whatever is on screen.
 */
export type Condition = { readonly field: string } & (
  | { readonly equals: string | number | boolean | null; readonly present?: undefined }
  | { readonly present: true; readonly equals?: undefined }
)

export type LayoutSection = {
  /** Stable, unique within the layout: what a test and an editor address. */
  readonly key: string
  readonly title?: Said
  readonly description?: Said
  /** How many fields sit on one row. 1 by default. */
  readonly columns?: 1 | 2
  /**
   * Shown only while this holds (ADR-0033, amended). A required field may not sit in
   * such a section: the server would refuse the save while the input that could fix it
   * is hidden, which is a refusal nobody can act on.
   */
  readonly visibleWhen?: Condition
  readonly fields: readonly LayoutField[]
}

export type LayoutTab = {
  readonly key: string
  readonly label: Said
  readonly sections: readonly LayoutSection[]
}

/** The form: tabs of sections, or sections alone; and the column beside it. */
export type Layout = (
  | { readonly tabs: readonly LayoutTab[]; readonly sections?: undefined }
  | { readonly sections: readonly LayoutSection[]; readonly tabs?: undefined }
) & {
  readonly aside?: readonly LayoutSection[]
}

/** How a layout describes itself in the Schema Registry: the resource's, and whose. */
export type LayoutDescriptor = {
  /** The resource's name — the entry is addressed by it. */
  readonly name: string
  readonly source: 'declared' | 'stored'
  readonly layout: Layout
  /** The stored row's version, which the next `resources.arrange` has to state. */
  readonly version?: number
}

declare module '@assemora/core' {
  interface RegistrySections {
    layouts: LayoutDescriptor
  }
}

const KEY = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/

const fieldName = (entry: LayoutField): string => (typeof entry === 'string' ? entry : entry.field)

const emptySaid = (text: Said | undefined): boolean =>
  text !== undefined &&
  (typeof text === 'string'
    ? text.trim() === ''
    : Object.keys(text).length === 0 || Object.values(text).some((value) => value.trim() === ''))

/**
 * What is wrong with a layout for these fields, as issues, or nothing.
 *
 * Issues rather than a throw, because the two callers throw different things: a
 * declaration is refused with a `ConfigurationError` where it was written, and the
 * command refuses with a `ValidationError` a client reads field by field. The rules
 * are the same, so the check is written once.
 */
export const layoutIssues = (
  fields: readonly ResourceFieldDescriptor[],
  candidate: unknown,
): readonly Issue[] => {
  const issues: Issue[] = []
  const at = (path: readonly (string | number)[], code: string, message: string) => {
    issues.push({ path: [...path], code, message })
  }

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return [{ path: [], code: 'type', message: 'A layout is an object' }]
  }

  const layout = candidate as {
    readonly tabs?: unknown
    readonly sections?: unknown
    readonly aside?: unknown
  }
  const known = new Map(fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const keys = new Set<string>()

  const checkSections = (sections: unknown, path: readonly (string | number)[]) => {
    if (!Array.isArray(sections)) {
      at(path, 'type', 'Expected a list of sections')
      return
    }
    if (sections.length === 0) at(path, 'empty', 'A list of sections cannot be empty')

    sections.forEach((section: unknown, index) => {
      const here = [...path, index]

      if (typeof section !== 'object' || section === null) {
        at(here, 'type', 'A section is an object')
        return
      }

      const { key, title, description, columns, fields: entries } = section as LayoutSection

      if (typeof key !== 'string' || !KEY.test(key)) {
        at([...here, 'key'], 'invalid', 'A key is a word, like "identity" or "seo"')
      } else if (keys.has(key)) at([...here, 'key'], 'duplicate', `"${key}" is used twice`)
      else keys.add(key)

      if (emptySaid(title)) at([...here, 'title'], 'empty', 'A title says nothing')
      if (emptySaid(description))
        at([...here, 'description'], 'empty', 'A description says nothing')
      if (columns !== undefined && columns !== 1 && columns !== 2) {
        at([...here, 'columns'], 'invalid', 'A section has 1 or 2 columns')
      }

      const condition = (section as { visibleWhen?: unknown }).visibleWhen

      if (condition !== undefined) {
        const where = [...here, 'visibleWhen']

        if (typeof condition !== 'object' || condition === null) {
          at(where, 'type', 'A condition is { field, equals } or { field, present: true }')
        } else {
          const {
            field: on,
            equals,
            present,
          } = condition as {
            field?: unknown
            equals?: unknown
            present?: unknown
          }
          const scalar = equals === null || ['string', 'number', 'boolean'].includes(typeof equals)

          if (typeof on !== 'string' || !known.has(on)) {
            at(
              [...where, 'field'],
              'unknown_field',
              `"${String(on)}" is not a field of this resource`,
            )
          } else if (known.get(on)?.hidden === true) {
            at(
              [...where, 'field'],
              'hidden',
              `"${on}" is hidden, so nothing on the form can depend on it`,
            )
          }
          if ((present === undefined) === (equals === undefined)) {
            at(where, 'shape', 'A condition says either equals or present, and one of the two')
          } else if (present !== undefined && present !== true) {
            at([...where, 'present'], 'invalid', 'present is true, or left out')
          } else if (equals !== undefined && !scalar) {
            at([...where, 'equals'], 'invalid', 'equals is a string, a number, a boolean or null')
          }
        }
      }

      if (!Array.isArray(entries)) {
        at([...here, 'fields'], 'type', 'Expected a list of fields')
        return
      }
      if (entries.length === 0)
        at([...here, 'fields'], 'empty', 'A section with no fields is a heading')

      entries.forEach((entry: unknown, position) => {
        const where = [...here, 'fields', position]
        const isPlain = typeof entry === 'string'
        const isPlaced =
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { field?: unknown }).field === 'string'

        if (!isPlain && !isPlaced) {
          at(where, 'type', 'A field is its name, or { field, width }')
          return
        }

        const name = fieldName(entry as LayoutField)
        const width = isPlain ? undefined : (entry as { width?: unknown }).width

        if (width !== undefined && width !== 'full' && width !== 'half') {
          at([...where, 'width'], 'invalid', 'A width is "full" or "half"')
        }

        const field = known.get(name)

        if (field === undefined)
          at(where, 'unknown_field', `"${name}" is not a field of this resource`)
        else if (field.hidden)
          at(where, 'hidden', `"${name}" is hidden, and a layout cannot show it`)
        else if (placed.has(name)) at(where, 'duplicate', `"${name}" is placed twice`)
        else {
          placed.add(name)

          // The server requires the field whatever is on screen, so a refusal would
          // land on an input nobody can see.
          if (field.required && condition !== undefined) {
            at(
              where,
              'required_hidden',
              `"${name}" is required, so it cannot sit in a section a condition hides`,
            )
          }
        }
      })
    })
  }

  const hasTabs = layout.tabs !== undefined
  const hasSections = layout.sections !== undefined

  if (hasTabs === hasSections) {
    at([], 'shape', 'A layout has either tabs or sections, and one of the two')
  } else if (hasTabs) {
    if (!Array.isArray(layout.tabs) || layout.tabs.length === 0) {
      at(['tabs'], 'empty', 'Expected at least one tab')
    } else {
      layout.tabs.forEach((tab: unknown, index) => {
        const here = ['tabs', index]

        if (typeof tab !== 'object' || tab === null) {
          at(here, 'type', 'A tab is an object')
          return
        }

        const { key, label, sections } = tab as LayoutTab

        if (typeof key !== 'string' || !KEY.test(key)) {
          at([...here, 'key'], 'invalid', 'A key is a word, like "content" or "seo"')
        } else if (keys.has(key)) at([...here, 'key'], 'duplicate', `"${key}" is used twice`)
        else keys.add(key)

        if (label === undefined || emptySaid(label))
          at([...here, 'label'], 'empty', 'A tab needs a label')

        checkSections(sections, [...here, 'sections'])
      })
    }
  } else {
    checkSections(layout.sections, ['sections'])
  }

  if (layout.aside !== undefined) checkSections(layout.aside, ['aside'])

  return issues
}

/** Every field name a layout places, in reading order. */
export const placedFields = (layout: Layout): readonly string[] => {
  const sections = [
    ...(layout.tabs === undefined ? layout.sections : layout.tabs.flatMap((tab) => tab.sections)),
    ...(layout.aside ?? []),
  ]

  return sections.flatMap((section) => section.fields.map(fieldName))
}
