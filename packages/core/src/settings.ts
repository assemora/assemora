/**
 * The settings a deployment has, described (SPEC.md §42, §58; ADR-0031).
 *
 * Studio's settings screen is drawn from this section the way its sidebar is drawn from
 * `resources`: it holds no list of groups and no idea what a group contains. Whoever
 * knows a fact declares it here — the umbrella declares what only it knows (the
 * project's name, the languages, the upload ceiling, where an agent connects), and a
 * module declares its own with `.settings()` — and Studio, `assemora.describe` and the
 * API Explorer read one description rather than each being told.
 *
 * A group is declarative data and nothing else: strings, a kind per row, and no
 * function anywhere. That is not a restriction on what a setting can be; it is what
 * lets the same group reach a browser as JSON and an agent over MCP without either
 * being handed something it cannot carry (ADR-0027).
 *
 * A row is one of two things. A `value` is a fact the application decided and prints —
 * a name, a path, a size — already written as words, because the application is the
 * one that knows what its own number means. A `link` is somewhere the reader goes to
 * decide something this screen does not hold. There is deliberately no `input`: a
 * setting somebody changes is a command's input, and a command is described in its own
 * section already (SPEC.md §14). The day a stored setting exists (SPEC.md §135) it
 * arrives as a command, not as a third row kind.
 */
import { ConfigurationError } from './errors.js'
import type { RegistryEntry } from './registry.js'

/** Where in the system a group lives — the three headings of the settings sidebar. */
export const SETTING_SECTIONS = ['workspace', 'content', 'platform'] as const

export type SettingSection = (typeof SETTING_SECTIONS)[number]

export type SettingRow = {
  /** Stable, and unique within the group: `project.name`. What a search and a test address. */
  readonly key: string
  readonly label: string
  readonly help?: string
} & (
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'link'; readonly href: string; readonly action: string }
)

export type SettingBlock = {
  readonly title: string
  readonly note?: string
  /**
   * Decided in the project's own source. Drawn with a tag saying so, and never with a
   * control: changing it is a deploy, not a setting.
   */
  readonly locked?: boolean
  readonly rows: readonly SettingRow[]
}

export type SettingsGroupDescriptor = RegistryEntry & {
  readonly section: SettingSection
  readonly label: string
  /** One sentence under the title. */
  readonly blurb?: string
  /** A name from the set Studio ships, the way a resource names one (SPEC.md §58). */
  readonly icon?: string
  /** What the sidebar shows beside the name: a count, where one is true. */
  readonly badge?: string
  readonly blocks: readonly SettingBlock[]
}

declare module './registry.js' {
  interface RegistrySections {
    settings: SettingsGroupDescriptor
  }
}

/**
 * A size as a `value` row prints it: whole megabytes without a decimal, a fraction with
 * one — `16 MB`, `1.4 MB`. Here rather than in each declarer, so two modules writing
 * the same number write it the same way.
 */
export const megabytes = (bytes: number): string =>
  `${Math.round((bytes / 1_048_576) * 10) / 10} MB`

/** kebab-case, the way a resource's icon and a group's own name are written. */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** `project.name`, `media.max-upload`: a dotted path of names. */
const KEY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

const refuse = (group: string, said: string): never => {
  throw new ConfigurationError(`Settings group "${group}": ${said}`)
}

/**
 * A group, checked before it is registered.
 *
 * Refused here rather than drawn wrong: a group with an icon Studio cannot name draws
 * a document, a group in a section nobody has draws nowhere, and a row whose key
 * repeats is two rows a search counts as one. Every one of those is a fact about the
 * declaration, and the declaration is where the person who can fix it is looking.
 */
export const settingsGroup = (definition: SettingsGroupDescriptor): SettingsGroupDescriptor => {
  const { name } = definition

  if (!NAME.test(name)) refuse(name, 'the name must be kebab-case, like "media" or "api-tokens"')
  if (!SETTING_SECTIONS.includes(definition.section)) {
    refuse(name, `the section must be one of ${SETTING_SECTIONS.join(', ')}`)
  }
  if (definition.label.trim() === '') refuse(name, 'it needs a label')
  if (definition.icon !== undefined && !NAME.test(definition.icon)) {
    refuse(name, `"${definition.icon}" is not an icon name; use kebab-case, like "credit-card"`)
  }
  if (definition.blocks.length === 0) refuse(name, 'it has no blocks, so it has nothing to show')

  const keys = new Set<string>()
  const titles = new Set<string>()

  for (const block of definition.blocks) {
    if (block.title.trim() === '') refuse(name, 'every block needs a title')
    // Two blocks with one title are one decision written twice as far as a reader can
    // tell, and one card twice as far as a screen keyed on the title can.
    if (titles.has(block.title)) refuse(name, `block title "${block.title}" is used twice`)
    titles.add(block.title)
    if (block.rows.length === 0) refuse(name, `block "${block.title}" has no rows`)

    for (const row of block.rows) {
      const { key, kind } = row as { key: string; kind: unknown }

      if (!KEY.test(key)) {
        refuse(name, `row key "${key}" must be a dotted path of names, like "project.name"`)
      }
      if (keys.has(key)) refuse(name, `row key "${key}" is used twice`)
      keys.add(key)

      if (row.label.trim() === '') refuse(name, `row "${key}" needs a label`)
      if (kind !== 'value' && kind !== 'link') {
        refuse(name, `row "${key}" has kind "${String(kind)}"; a row is a value or a link`)
      }
    }
  }

  return definition
}
