/**
 * The arrangement a form is drawn from (ADR-0033).
 *
 * Three sources, one shape. A resource that declared or stored a layout is drawn from
 * it; one that did not is drawn the way every form was before — what the entry *is* on
 * the left, what is *true of* it on the right, decided by the kind of each field
 * (`mainFields` / `asideFields`). Either way the answer here is complete: every editable
 * field the layout did not name lands in a trailing section, because a layout may
 * arrange fields and may not hide them.
 */
import {
  asideFields,
  type Condition,
  type FieldDescriptor,
  type Layout,
  type LayoutField,
  type LayoutSection,
  mainFields,
} from '../api/introspection.ts'
import type { Said } from '../settings/said.ts'

/** The key of the section that holds what a layout left out. Studio names it. */
export const LEFT_OUT = '__left-out'

export type Placed = {
  readonly field: FieldDescriptor
  readonly width: 'full' | 'half'
}

export type Section = {
  readonly key: string
  readonly title?: Said
  readonly description?: Said
  readonly columns: 1 | 2
  /** Shown only while this holds against the draft; see `layout/visible.ts`. */
  readonly visibleWhen?: Condition
  readonly fields: readonly Placed[]
}

export type Tab = {
  readonly key: string
  readonly label: Said
  readonly sections: readonly Section[]
}

/** The form, ready to draw: either tabs or sections, and the column beside them. */
export type Arranged = {
  readonly tabs?: readonly Tab[]
  readonly sections?: readonly Section[]
  readonly aside: readonly Section[]
  /** Whether the layout was derived from the kinds — nobody declared or arranged it. */
  readonly derived: boolean
}

const nameOf = (entry: LayoutField): string => (typeof entry === 'string' ? entry : entry.field)

const widthOf = (entry: LayoutField): 'full' | 'half' =>
  typeof entry === 'string' ? 'full' : (entry.width ?? 'full')

/** A layout section with its fields looked up. A name nothing declares is skipped. */
const placed = (section: LayoutSection, byName: ReadonlyMap<string, FieldDescriptor>): Section => ({
  key: section.key,
  ...(section.title === undefined ? {} : { title: section.title }),
  ...(section.description === undefined ? {} : { description: section.description }),
  columns: section.columns ?? 1,
  ...(section.visibleWhen === undefined ? {} : { visibleWhen: section.visibleWhen }),
  fields: section.fields.flatMap((entry) => {
    const field = byName.get(nameOf(entry))

    return field === undefined ? [] : [{ field, width: widthOf(entry) }]
  }),
})

/**
 * The fields, arranged.
 *
 * @param fields the editable fields, in declaration order
 * @param layout the registry's, or nothing
 */
export const arrange = (
  fields: readonly FieldDescriptor[],
  layout: Layout | undefined,
): Arranged => {
  if (layout === undefined) {
    const main = mainFields(fields)
    const aside = asideFields(fields)

    return {
      sections: [
        { key: 'main', columns: 1, fields: main.map((field) => ({ field, width: 'full' })) },
      ],
      aside:
        aside.length === 0
          ? []
          : [
              {
                key: 'aside',
                columns: 1,
                fields: aside.map((field) => ({ field, width: 'full' })),
              },
            ],
      derived: true,
    }
  }

  const byName = new Map(fields.map((field) => [field.name, field]))
  const tabs = layout.tabs?.map((tab) => ({
    key: tab.key,
    label: tab.label,
    sections: tab.sections.map((section) => placed(section, byName)),
  }))
  const sections = layout.sections?.map((section) => placed(section, byName))
  const aside = (layout.aside ?? []).map((section) => placed(section, byName))

  const named = new Set(
    [...(tabs ?? []).flatMap((tab) => tab.sections), ...(sections ?? []), ...aside]
      .flatMap((section) => section.fields)
      .map((entry) => entry.field.name),
  )
  const leftOut = fields.filter((field) => !named.has(field.name))
  const trailing: Section[] =
    leftOut.length === 0
      ? []
      : [
          {
            key: LEFT_OUT,
            columns: 1,
            fields: leftOut.map((field) => ({ field, width: 'full' as const })),
          },
        ]

  // What was left out goes at the end of the last tab, or after the sections: the
  // reader finds it where a form ends, and the layout's own order is untouched.
  if (tabs !== undefined && tabs.length > 0) {
    const last = tabs[tabs.length - 1]

    return {
      tabs: tabs.map((tab, index) =>
        index === tabs.length - 1 && last !== undefined
          ? { ...tab, sections: [...tab.sections, ...trailing] }
          : tab,
      ),
      aside,
      derived: false,
    }
  }

  return { sections: [...(sections ?? []), ...trailing], aside, derived: false }
}
