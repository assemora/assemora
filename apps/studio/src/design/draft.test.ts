import { describe, expect, it } from 'vitest'

import type { ThemeState } from '../api/theme.ts'
import { defaultsOf, flatten, namesIn, patchOf, previewOf, removals } from './draft.ts'
import { COLORS, CONTAINER, SIZES, SPACING } from './tokens.ts'

/**
 * A theme where `brand` and `xl` have been changed, `brand-accent` was added, and
 * everything else is what the framework provides.
 */
const state: ThemeState = {
  version: 3,
  cssVersion: 'aaaabbbbccccdddd',
  overrides: {
    colors: { brand: '#0f766e', 'brand-accent': '#ff8800' },
    spacing: { xl: '7rem' },
  },
  tokens: {
    colors: { brand: '#0f766e', 'brand-accent': '#ff8800', ink: '#16181d' },
    typography: {
      fonts: { body: ['Inter', 'sans-serif'] },
      sizes: { md: '1rem', '2xl': '2.5rem' },
      weights: { bold: 700 },
      lineHeights: { normal: 1.55 },
    },
    spacing: {
      none: '0',
      xs: '0.5rem',
      sm: '1rem',
      md: '2rem',
      lg: '4rem',
      xl: '7rem',
      '2xl': '9rem',
    },
    radius: { none: '0', sm: '0.375rem', md: '0.75rem', lg: '1.25rem', full: '9999px' },
    container: { narrow: '34rem', normal: '48rem', wide: '68rem', full: '100%' },
  },
}

const base = flatten(state.tokens)
const defaults = defaultsOf(state)

describe('flatten', () => {
  it('addresses every token by group and name', () => {
    expect(base.get('colors.brand')).toBe('#0f766e')
    expect(base.get('typography.sizes.2xl')).toBe('2.5rem')
    expect(base.get('typography.fonts.body')).toEqual(['Inter', 'sans-serif'])
    expect(base.get('spacing.xl')).toBe('7rem')
  })
})

describe('namesIn', () => {
  it('lists an open group by what it holds, sorted', () => {
    expect(namesIn(base, COLORS)).toEqual(['brand', 'brand-accent', 'ink'])
    expect(namesIn(base, SIZES)).toEqual(['2xl', 'md'])
  })

  it('lists a fixed group by its scale, whatever the document holds', () => {
    expect(namesIn(new Map(), CONTAINER)).toEqual(['narrow', 'normal', 'wide', 'full'])
  })
})

describe('defaultsOf', () => {
  it('knows the default of every token nobody has overridden', () => {
    expect(defaults.get('colors.ink')).toBe('#16181d')
    expect(defaults.get('spacing.lg')).toBe('4rem')
  })

  it('does not claim to know one standing under an override', () => {
    expect(defaults.has('colors.brand')).toBe(false)
    expect(defaults.has('spacing.xl')).toBe(false)
  })
})

describe('previewOf', () => {
  it('shows a staged value in place of the saved one', () => {
    const preview = previewOf(base, new Map([['colors.brand', '#123456']]), defaults)

    expect(preview.get('colors.brand')).toBe('#123456')
    expect(preview.get('colors.ink')).toBe('#16181d')
  })

  it('puts back a default it knows', () => {
    const preview = previewOf(base, new Map([['colors.ink', null]]), defaults)

    expect(preview.get('colors.ink')).toBe('#16181d')
  })

  it('drops an open token whose default it has no reason to believe in', () => {
    const preview = previewOf(base, new Map([['colors.brand-accent', null]]), defaults)

    expect(preview.has('colors.brand-accent')).toBe(false)
  })

  it('keeps a fixed token, because the scale requires one and it cannot be lost', () => {
    const preview = previewOf(base, new Map([['spacing.xl', null]]), defaults)

    expect(preview.get('spacing.xl')).toBe('7rem')
  })
})

describe('removals', () => {
  it('names only the clears that end with the token gone', () => {
    const edits = new Map([
      ['colors.brand-accent', null],
      ['colors.ink', null],
      ['spacing.xl', null],
      ['colors.brand', '#000000'],
    ])

    expect(removals(edits, defaults)).toEqual(['colors.brand-accent'])
  })
})

describe('patchOf', () => {
  it('rebuilds the nesting the command asks for', () => {
    const edits = new Map<string, string | number | readonly string[] | null>([
      ['colors.brand', '#0f766e'],
      ['colors.brand-accent', null],
      ['typography.fonts.heading', ['Fraunces', 'serif']],
      ['typography.weights.bold', 800],
      ['spacing.xl', '7rem'],
    ])

    expect(patchOf(edits)).toEqual({
      colors: { brand: '#0f766e', 'brand-accent': null },
      typography: { fonts: { heading: ['Fraunces', 'serif'] }, weights: { bold: 800 } },
      spacing: { xl: '7rem' },
    })
  })

  it('sends nothing for a group nobody touched', () => {
    expect(patchOf(new Map([['spacing.md', '2rem']]))).toEqual({ spacing: { md: '2rem' } })
  })
})

describe('the groups', () => {
  it('names each token the way the generated stylesheet declares it', () => {
    expect(COLORS.property('brand')).toBe('--brand')
    expect(SPACING.property('2xl')).toBe('--space-2xl')
    expect(SIZES.property('md')).toBe('--text-md')
    expect(CONTAINER.property('narrow')).toBe('--width-narrow')
  })
})
