/**
 * The languages a deployment serves (SPEC.md §131).
 *
 * Configured rather than stored. Which languages a site is in is a deployment fact like
 * the database URL: it decides what the addresses are, what a migration has to hold and
 * what a translator is asked for, and none of those can be changed by writing a row
 * while the process runs.
 *
 * ```ts
 * assemora({ locales: ['uk', 'en', 'ru'], defaultLocale: 'uk' })
 * ```
 *
 * It reaches the Schema Registry as a section of its own, so the set of languages is
 * described once and read from there by Studio, OpenAPI, the SDK and `assemora.describe`
 * — rather than each of them being told separately, which is how the four come to
 * disagree about what a site is in.
 */
import { ConfigurationError } from './errors.js'
import type { RegistryEntry } from './registry.js'

/**
 * A language tag, loosely: a two or three letter code and any number of subtags.
 *
 * Loose on purpose. This refuses `EN`, `english` and `en_GB` — the three ways a language
 * is actually mistyped — and accepts everything BCP 47 makes meaningful, because a list
 * of valid tags belongs in a library rather than in a framework, and a framework that
 * shipped a stale one would refuse a real language.
 */
const TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export type LocaleSettings = {
  /** Every language served, in the order they were declared. */
  readonly locales: readonly string[]
  /** The one a missing translation falls back to, and the one an unmarked row is in. */
  readonly defaultLocale: string
}

export type LocaleOptions = {
  readonly locales?: readonly string[]
  /** Defaults to the first of `locales`. */
  readonly defaultLocale?: string
}

/** The registry's own entry per language, so the set is described rather than told. */
export type LocaleDescriptor = RegistryEntry & {
  /** Whether this is the one a missing translation falls back to. */
  readonly default: boolean
}

declare module './registry.js' {
  interface RegistrySections {
    locales: LocaleDescriptor
  }
}

/**
 * Reads the configuration, or refuses it.
 *
 * `undefined` when no languages are configured, which is what an application that is in
 * one language has always been and stays: nothing about a read, a write or an address
 * changes for it.
 */
export const resolveLocales = (options: LocaleOptions): LocaleSettings | undefined => {
  const { locales, defaultLocale } = options

  if (locales === undefined) {
    if (defaultLocale === undefined) return undefined

    throw new ConfigurationError(
      `defaultLocale is "${defaultLocale}", but no locales are configured. Say which languages this deployment serves: locales: ['${defaultLocale}', …]`,
    )
  }

  if (locales.length === 0) {
    throw new ConfigurationError(
      'locales is empty. Leave it out for an application in one language, rather than saying it serves none.',
    )
  }

  for (const code of locales) {
    if (!TAG.test(code)) {
      throw new ConfigurationError(
        `"${code}" is not a language tag. A tag is lower-case and hyphenated — "uk", "en", "pt-BR".`,
      )
    }
  }

  const duplicate = locales.find((code, at) => locales.indexOf(code) !== at)

  if (duplicate !== undefined) {
    throw new ConfigurationError(`locales names "${duplicate}" twice.`)
  }

  // `locales[0]` is defined: the empty case was refused above, and `noUncheckedIndexedAccess`
  // cannot see that.
  const chosen = defaultLocale ?? (locales[0] as string)

  if (!locales.includes(chosen)) {
    throw new ConfigurationError(
      `defaultLocale is "${chosen}", which is not one of the configured locales (${locales.join(', ')}). The fallback has to be a language this deployment serves.`,
    )
  }

  return { locales, defaultLocale: chosen }
}

/**
 * Whether a caller-supplied string is one of the configured languages.
 *
 * The one place that question is answered, because everything that can be asked it — a
 * path segment, a query argument, an MCP tool's input — is arriving from outside.
 */
export const isLocale = (settings: LocaleSettings | undefined, value: unknown): value is string =>
  typeof value === 'string' && settings !== undefined && settings.locales.includes(value)
