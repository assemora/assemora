import { describe, expect, it } from 'vitest'

import { createApplication } from './application.js'
import { currentContext } from './context.js'
import { isLocale, resolveLocales } from './locales.js'

describe('resolveLocales', () => {
  it('is undefined for an application in one language', () => {
    expect(resolveLocales({})).toBeUndefined()
  })

  it('falls back to the first when no default is named', () => {
    expect(resolveLocales({ locales: ['uk', 'en', 'ru'] })).toEqual({
      locales: ['uk', 'en', 'ru'],
      defaultLocale: 'uk',
    })
  })

  it('refuses a default that is not one of the languages served', () => {
    expect(() => resolveLocales({ locales: ['uk', 'en'], defaultLocale: 'de' })).toThrow(/de/)
  })

  it('refuses a default with no languages beside it', () => {
    expect(() => resolveLocales({ defaultLocale: 'uk' })).toThrow(/no locales are configured/)
  })

  it('refuses an empty list rather than reading it as one language', () => {
    expect(() => resolveLocales({ locales: [] })).toThrow(/empty/)
  })

  it('refuses the three ways a tag is mistyped', () => {
    for (const wrong of ['EN', 'english', 'en_GB']) {
      expect(() => resolveLocales({ locales: [wrong] })).toThrow(/language tag/)
    }
  })

  it('accepts a tag with subtags', () => {
    expect(resolveLocales({ locales: ['pt-BR'] })?.defaultLocale).toBe('pt-BR')
  })

  it('refuses a language named twice', () => {
    expect(() => resolveLocales({ locales: ['uk', 'en', 'uk'] })).toThrow(/twice/)
  })
})

describe('isLocale', () => {
  const settings = resolveLocales({ locales: ['uk', 'en'] })

  it('is the one place a string from outside is checked', () => {
    expect(isLocale(settings, 'uk')).toBe(true)
    expect(isLocale(settings, 'de')).toBe(false)
    expect(isLocale(settings, 42)).toBe(false)
  })

  it('is false for every value when the application serves one language', () => {
    expect(isLocale(undefined, 'uk')).toBe(false)
  })
})

describe('an application that serves several languages', () => {
  it('describes them, so nothing else has to be told', () => {
    const app = createApplication({ locales: ['uk', 'en', 'ru'], defaultLocale: 'en' })

    expect(app.registry.section('locales')).toEqual([
      { name: 'uk', default: false },
      { name: 'en', default: true },
      { name: 'ru', default: false },
    ])
  })

  it('puts the default into an operation that named none', async () => {
    const app = createApplication({ locales: ['uk', 'en'] })

    const seen = await app.run({ source: 'cli' }, async () => currentContext())

    expect(seen?.locale).toBe('uk')
    expect(seen?.locales?.defaultLocale).toBe('uk')
  })

  it('keeps the language an operation did name', async () => {
    const app = createApplication({ locales: ['uk', 'en'] })

    const seen = await app.run({ source: 'cli', locale: 'en' }, async () => currentContext())

    expect(seen?.locale).toBe('en')
    // The fallback is the deployment's, never the operation's.
    expect(seen?.locales?.defaultLocale).toBe('uk')
  })

  it('leaves an application in one language exactly as it was', async () => {
    const app = createApplication({})

    const seen = await app.run({ source: 'cli' }, async () => currentContext())

    expect(app.locales).toBeUndefined()
    expect(seen?.locale).toBeUndefined()
    expect(app.registry.section('locales')).toEqual([])
  })
})
