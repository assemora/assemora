/**
 * Editing a layout, as pure functions over the registry's own shape (ADR-0033).
 *
 * The form screen holds a `Layout` and applies one of these per click; every function
 * answers with a new layout and leaves its argument alone, so a step can be undone by
 * keeping the one before. Sections are addressed by key wherever they sit — in a tab,
 * on the one page, beside the form — because a field moves between all three.
 */
import type {
  Condition,
  Layout,
  LayoutField,
  LayoutSection,
  LayoutTab,
} from '../api/introspection.ts'

const nameOf = (entry: LayoutField): string => (typeof entry === 'string' ? entry : entry.field)

/** A key nothing else in the layout uses: `section`, `section-2`, `section-3`. */
export const uniqueKey = (layout: Layout, prefix: string): string => {
  const taken = new Set([
    ...(layout.tabs ?? []).map((tab) => tab.key),
    ...allSections(layout).map((section) => section.key),
  ])

  if (!taken.has(prefix)) return prefix

  let counter = 2

  while (taken.has(`${prefix}-${counter}`)) counter += 1

  return `${prefix}-${counter}`
}

/** Every section, wherever it sits, in reading order. */
export const allSections = (layout: Layout): readonly LayoutSection[] => [
  ...(layout.tabs === undefined ? layout.sections : layout.tabs.flatMap((tab) => tab.sections)),
  ...(layout.aside ?? []),
]

/** Every field the layout places. */
export const placedNames = (layout: Layout): readonly string[] =>
  allSections(layout).flatMap((section) => section.fields.map(nameOf))

/** The same layout with every list of sections passed through `change`. */
const mapSections = (
  layout: Layout,
  change: (sections: readonly LayoutSection[]) => readonly LayoutSection[],
): Layout => {
  const aside = layout.aside === undefined ? {} : { aside: change(layout.aside) }

  return layout.tabs === undefined
    ? { sections: change(layout.sections), ...aside }
    : { tabs: layout.tabs.map((tab) => ({ ...tab, sections: change(tab.sections) })), ...aside }
}

const mapSection = (
  layout: Layout,
  key: string,
  change: (section: LayoutSection) => LayoutSection,
): Layout =>
  mapSections(layout, (sections) =>
    sections.map((section) => (section.key === key ? change(section) : section)),
  )

const moved = <T>(list: readonly T[], index: number, direction: -1 | 1): readonly T[] => {
  const target = index + direction

  if (index < 0 || target < 0 || target >= list.length) return list

  const next = [...list]
  const [item] = next.splice(index, 1)

  if (item !== undefined) next.splice(target, 0, item)

  return next
}

/* ------------------------------------------------------------------------------ tabs */

/**
 * Between one page and tabs. Turning tabs on puts every section in one tab; turning
 * them off lays the tabs' sections out in order. Nothing is lost either way.
 */
export const withTabs = (layout: Layout, on: boolean, firstLabel: string): Layout => {
  const aside = layout.aside === undefined ? {} : { aside: layout.aside }

  if (on) {
    if (layout.tabs !== undefined) return layout

    return {
      tabs: [{ key: uniqueKey(layout, 'tab'), label: firstLabel, sections: layout.sections }],
      ...aside,
    }
  }

  if (layout.tabs === undefined) return layout

  return { sections: layout.tabs.flatMap((tab) => tab.sections), ...aside }
}

export const addTab = (layout: Layout, label: string): Layout =>
  layout.tabs === undefined
    ? layout
    : { ...layout, tabs: [...layout.tabs, { key: uniqueKey(layout, 'tab'), label, sections: [] }] }

/** Removing a tab keeps its sections: they join the tab before it, or the one after. */
export const removeTab = (layout: Layout, key: string): Layout => {
  if (layout.tabs === undefined || layout.tabs.length < 2) return layout

  const index = layout.tabs.findIndex((tab) => tab.key === key)

  if (index === -1) return layout

  const gone = layout.tabs[index]
  const rest = layout.tabs.filter((tab) => tab.key !== key)
  const into = Math.max(0, index - 1)

  return {
    ...layout,
    tabs: rest.map((tab, at) =>
      at === into && gone !== undefined
        ? { ...tab, sections: [...tab.sections, ...gone.sections] }
        : tab,
    ),
  }
}

export const moveTab = (layout: Layout, key: string, direction: -1 | 1): Layout =>
  layout.tabs === undefined
    ? layout
    : {
        ...layout,
        tabs: moved(
          layout.tabs,
          layout.tabs.findIndex((tab) => tab.key === key),
          direction,
        ),
      }

export const relabelTab = (layout: Layout, key: string, label: string): Layout =>
  layout.tabs === undefined
    ? layout
    : { ...layout, tabs: layout.tabs.map((tab) => (tab.key === key ? { ...tab, label } : tab)) }

/* -------------------------------------------------------------------------- sections */

/** Where a new section goes: beside the form, on the one page, or in a tab. */
export type Place = { readonly aside: true } | { readonly tab?: string }

export const addSection = (layout: Layout, place: Place): Layout => {
  const section: LayoutSection = { key: uniqueKey(layout, 'section'), fields: [] }

  if ('aside' in place) return { ...layout, aside: [...(layout.aside ?? []), section] }

  if (layout.tabs === undefined) return { ...layout, sections: [...layout.sections, section] }

  const tabKey = place.tab ?? layout.tabs[0]?.key

  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.key === tabKey ? { ...tab, sections: [...tab.sections, section] } : tab,
    ),
  }
}

/** Removing a section unplaces its fields; the form still draws them at the end. */
export const removeSection = (layout: Layout, key: string): Layout =>
  mapSections(layout, (sections) => sections.filter((section) => section.key !== key))

export const moveSection = (layout: Layout, key: string, direction: -1 | 1): Layout =>
  mapSections(layout, (sections) =>
    moved(
      sections,
      sections.findIndex((section) => section.key === key),
      direction,
    ),
  )

export const retitleSection = (layout: Layout, key: string, title: string): Layout =>
  mapSection(layout, key, (section) => {
    const { title: _dropped, ...rest } = section

    return title.trim() === '' ? rest : { ...rest, title }
  })

export const setColumns = (layout: Layout, key: string, columns: 1 | 2): Layout =>
  mapSection(layout, key, (section) => ({ ...section, columns }))

/** When the section is shown; `undefined` means always. */
export const setCondition = (layout: Layout, key: string, when: Condition | undefined): Layout =>
  mapSection(layout, key, (section) => {
    const { visibleWhen: _dropped, ...rest } = section

    return when === undefined ? rest : { ...rest, visibleWhen: when }
  })

/* ---------------------------------------------------------------------------- fields */

/** Takes a field out of wherever it is. */
export const unplaceField = (layout: Layout, name: string): Layout =>
  mapSections(layout, (sections) =>
    sections.map((section) => ({
      ...section,
      fields: section.fields.filter((entry) => nameOf(entry) !== name),
    })),
  )

/** Puts a field at the end of a section, taking it out of wherever it was first. */
export const placeField = (layout: Layout, name: string, sectionKey: string): Layout =>
  mapSection(unplaceField(layout, name), sectionKey, (section) => ({
    ...section,
    fields: [...section.fields, name],
  }))

export const moveField = (layout: Layout, name: string, direction: -1 | 1): Layout =>
  mapSections(layout, (sections) =>
    sections.map((section) => {
      const index = section.fields.findIndex((entry) => nameOf(entry) === name)

      return index === -1
        ? section
        : { ...section, fields: moved(section.fields, index, direction) }
    }),
  )

export const setWidth = (layout: Layout, name: string, width: 'full' | 'half'): Layout =>
  mapSections(layout, (sections) =>
    sections.map((section) => ({
      ...section,
      fields: section.fields.map((entry) =>
        nameOf(entry) !== name ? entry : width === 'full' ? name : { field: name, width },
      ),
    })),
  )

/** The one page, as a layout to start arranging from: every field, one section. */
export const startingLayout = (fieldNames: readonly string[]): Layout => ({
  sections: [{ key: 'main', fields: [...fieldNames] }],
})

export type { LayoutTab }
