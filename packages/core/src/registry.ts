/**
 * Schema Registry (SPEC.md §42).
 *
 * One declaration is described once and read by OpenAPI, Studio, the SDK, MCP and
 * introspection. Sections are declared through interface augmentation, so `core`
 * never has to know what a resource or a block is (SPEC.md §8).
 */
import type { JsonSchema } from '@assemora/schema'

import { ConfigurationError } from './errors.js'

export type RegistryEntry = {
  readonly name: string
}

/** A command as the outside world sees it. */
export type CommandDescriptor = RegistryEntry & {
  readonly description?: string
  readonly input: JsonSchema
  readonly module?: string
}

/**
 * Packages add their sections by augmenting this interface:
 *
 * ```ts
 * declare module '@assemora/core' {
 *   interface RegistrySections {
 *     resources: ResourceDescriptor
 *   }
 * }
 * ```
 */
export interface RegistrySections {
  commands: CommandDescriptor
}

export type SectionName = keyof RegistrySections & string

export type SchemaRegistry = {
  register<K extends SectionName>(section: K, entry: RegistrySections[K]): void
  section<K extends SectionName>(section: K): readonly RegistrySections[K][]
  find<K extends SectionName>(section: K, name: string): RegistrySections[K] | undefined
  sections(): readonly SectionName[]
  /** The whole registry as plain data — the seed of `assemora.describe` (SPEC.md §71). */
  describe(): Readonly<Record<string, readonly RegistryEntry[]>>
}

/** Any entry the registry can hold — the union over every declared section. */
type AnyEntry = RegistrySections[SectionName]

export const createSchemaRegistry = (): SchemaRegistry => {
  const sections = new Map<string, Map<string, AnyEntry>>()

  const bucket = (section: string): Map<string, AnyEntry> => {
    const existing = sections.get(section)
    if (existing !== undefined) return existing

    const created = new Map<string, AnyEntry>()
    sections.set(section, created)
    return created
  }

  return {
    register(section, entry) {
      const entries = bucket(section)

      if (entries.has(entry.name)) {
        throw new ConfigurationError(`"${entry.name}" is already registered in ${section}`)
      }

      entries.set(entry.name, entry)
    },

    section<K extends SectionName>(section: K): readonly RegistrySections[K][] {
      // The section name determines which member of the union is stored under it.
      // Narrowing happens here once instead of at every call site.
      return [...bucket(section).values()] as readonly RegistrySections[K][]
    },

    find<K extends SectionName>(section: K, name: string): RegistrySections[K] | undefined {
      return bucket(section).get(name) as RegistrySections[K] | undefined
    },

    sections() {
      return [...sections.keys()] as readonly SectionName[]
    },

    describe() {
      const snapshot: Record<string, readonly RegistryEntry[]> = {}

      for (const [section, entries] of sections) {
        snapshot[section] = [...entries.values()]
      }

      return snapshot
    },
  }
}
