/**
 * `singleton()` — a page there is exactly one of (SPEC.md §135, ADR-0032).
 *
 * Site settings, the footer, a contact block: content with fields like a resource and
 * no list, no id and no second row. The theme (§62) is the first singleton and the
 * shape the rest follow — one row, edited through a command, revised and restorable
 * like any other content.
 *
 * ```ts
 * export const Site = singleton(
 *   'site',
 *   { title: text().required(), tagline: text(), contactEmail: email() },
 *   { label: 'Site settings', icon: 'building' },
 * )
 *
 * module('site').singletons(Site)
 * ```
 *
 * The fields are the resource fields, so one declaration feeds validation, the form
 * Studio draws on its settings screen, the OpenAPI schema of `singletons.update`, the
 * SDK and the MCP tool. The values live in one JSONB row per name, in a table this
 * package owns, so a singleton never becomes a migration of its own.
 */
import { AssemoraError, ConfigurationError } from '@assemora/core'

import { describeField, humanize, type ResourceFieldDescriptor } from './descriptor.js'
import type { AnyField } from './fields.js'
import { validateAgainstFields } from './validation.js'

/** kebab-case, the way a resource's icon and a settings group's name are written. */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export type SingletonOptions = {
  /** Defaults to the name, humanized. */
  readonly label?: string
  /** One sentence under the title, on the settings screen. */
  readonly description?: string
  /** What Studio draws it as: a name from the set it ships, like a resource's. */
  readonly icon?: string
}

/** How a singleton describes itself in the Schema Registry (SPEC.md §42). */
export type SingletonDescriptor = {
  readonly name: string
  readonly label: string
  readonly description?: string
  readonly icon?: string
  readonly fields: readonly ResourceFieldDescriptor[]
}

declare module '@assemora/core' {
  interface RegistrySections {
    singletons: SingletonDescriptor
  }
}

export type Singleton = {
  readonly node: 'singleton'
  readonly name: string
  readonly descriptor: SingletonDescriptor
  readonly fields: ReadonlyMap<string, AnyField>
  /** Checks a partial write against the declared fields, the way a resource does. */
  validate(values: unknown): Record<string, unknown>
}

export const singleton = (
  name: string,
  fields: Readonly<Record<string, AnyField>>,
  options: SingletonOptions = {},
): Singleton => {
  if (!NAME.test(name)) {
    throw new ConfigurationError(
      `Singleton "${name}": the name must be kebab-case, like "site" or "contact-block"`,
    )
  }

  const entries = Object.entries(fields)

  if (entries.length === 0) {
    throw new ConfigurationError(
      `Singleton "${name}" declares no fields, so it has nothing to hold`,
    )
  }

  if (options.icon !== undefined && !NAME.test(options.icon)) {
    throw new ConfigurationError(
      `Singleton "${name}": "${options.icon}" is not an icon name; use kebab-case, like "building"`,
    )
  }

  const fieldByName = new Map(entries)

  const descriptor: SingletonDescriptor = {
    name,
    label: options.label ?? humanize(name),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    fields: entries.map(([fieldName, field]) => describeField(fieldName, field)),
  }

  return {
    node: 'singleton',
    name,
    descriptor,
    fields: fieldByName,
    // Every field is clearable: the values live in one JSONB document, which holds a
    // `null` under any key, the way a collection's do (ADR-0012).
    validate: (values) =>
      validateAgainstFields(values, 'update', {
        resource: name,
        fields: fieldByName,
        clearable: () => true,
      }),
  }
}

/* ---------------------------------------------------------------------------- registry */

const singletons = new Map<string, Singleton>()

export const registerSingleton = (declared: Singleton): void => {
  if (singletons.has(declared.name)) {
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `Singleton "${declared.name}" is registered twice`,
      { status: 500 },
    )
  }

  singletons.set(declared.name, declared)
}

export const singletonByName = (name: string): Singleton => {
  const found = singletons.get(name)

  if (found === undefined) {
    throw new AssemoraError('UNKNOWN_SINGLETON', `Singleton "${name}" is not registered`, {
      status: 404,
    })
  }

  return found
}

export const registeredSingletons = (): readonly Singleton[] => [...singletons.values()]

export const clearSingletonRegistry = (): void => {
  singletons.clear()
}
