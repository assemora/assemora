/**
 * What a preset promises (SPEC.md §37).
 *
 * A preset fills the form in, and everything it writes then goes through `issuesOf` and
 * `payloadOf` exactly as typed rows do — so what has to be true of one is that it could
 * have been typed: every row named, every key unique, and every kind one the application
 * actually registered. The last is the one that cannot be seen by reading it, because
 * the set of kinds belongs to the application and not to this file.
 */
import { describe, expect, it } from 'vitest'

import { KINDS } from './contract.ts'
import { fits, helpOf, iconOf, PRESETS } from './kinds.tsx'

const keys = () => {
  let at = 0

  return () => {
    at += 1

    return `new:${at}`
  }
}

describe('the shapes offered where a definition is empty', () => {
  it('only uses kinds this application registered', () => {
    for (const preset of PRESETS) {
      expect(fits(preset, KINDS), preset.name).toBe(true)
    }
  })

  it('is not offered at all when a kind it needs is missing', () => {
    // An application can register fewer — `collections.create` publishes the kinds this
    // process has — and a preset that fills the form with a kind the command refuses is
    // worse than one button fewer.
    const withoutMedia = KINDS.filter((kind) => kind !== 'media')

    expect(PRESETS.filter((preset) => fits(preset, withoutMedia)).map((one) => one.name)).toEqual([
      'testimonial',
    ])
  })

  it('names every row and counts them without building them', () => {
    for (const preset of PRESETS) {
      const fields = preset.fields(keys())

      expect(fields.length, preset.name).toBe(preset.count)
      expect(
        fields.every((field) => field.name !== ''),
        preset.name,
      ).toBe(true)
      expect(new Set(fields.map((field) => field.key)).size, preset.name).toBe(fields.length)
    }
  })

  it('leaves a choice field with the options it needs, so it is ready as it lands', () => {
    const testimonial = PRESETS.find((preset) => preset.name === 'testimonial')
    const sentiment = testimonial?.fields(keys()).find((field) => field.kind === 'checkboxes')

    expect(sentiment?.options.length).toBeGreaterThan(0)
  })
})

describe('what a kind is, for somebody choosing one', () => {
  it('explains every kind this package knows the application can register', () => {
    for (const kind of KINDS) {
      expect(helpOf(kind), kind).toBeDefined()
    }
  })

  it('draws a kind it has never heard of rather than nothing', () => {
    // A plugin's kind arrives through the registry and reaches the picker; it has no
    // sentence and no icon of its own, and saying nothing about it is the honest state.
    expect(helpOf('wormhole')).toBeUndefined()
    expect(iconOf('wormhole')).toBeDefined()
  })
})
