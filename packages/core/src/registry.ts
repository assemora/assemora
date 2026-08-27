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

/**
 * Where a command may be called from (SPEC.md §85).
 *
 * `'anywhere'` is the default and the ordinary case: the generated
 * `POST /commands/<name>` endpoint and the MCP tool are safe by construction,
 * because the bus authorizes first and authorization denies by default.
 *
 * `'its own route'` is for the handful of commands that are *publicly* authorized —
 * a login has to be callable by somebody who is nobody yet. For those, the checks
 * that make them safe live in the route written for them (cookie-only issuance,
 * CSRF minting, the forensic fields taken from the request rather than the caller),
 * and a generated endpoint or a tool beside it would be a second, unhardened door on
 * to the same handler.
 */
export type CommandReach = 'anywhere' | 'its own route'

/** A command as the outside world sees it. */
export type CommandDescriptor = RegistryEntry & {
  readonly description?: string
  readonly input: JsonSchema
  readonly module?: string
  /**
   * Absent when the command is reachable from anywhere, which is nearly all of them.
   *
   * The generators read this section rather than the bus, so a restriction the
   * registry does not carry is one no generator can honour (ADR-0002).
   */
  readonly reachableFrom?: CommandReach
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
