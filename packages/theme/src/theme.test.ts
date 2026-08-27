/**
 * The theme (SPEC.md §62, ADR-0024).
 *
 * Half of this file is one claim: nobody who can edit the theme can author CSS. The
 * attempts are the tests that matter, and each of them has to be refused *at the
 * command* — an escape at the renderer would mean the document had already accepted
 * a stylesheet, and a document is read by more than one renderer eventually.
 */
import {
  type Application,
  clearRestorers,
  collectRevisions,
  createApplication,
  createLogger,
  ForbiddenError,
  permitAll,
  restorerFor,
  silentWriter,
  ValidationError,
} from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { RADIUS_SCALE, SPACING_SCALE } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { themeCss, themeVersion } from './css.js'
import { defaultTheme, resolveTheme } from './defaults.js'
import { THEME_ID, Theme } from './models.js'
import { theme } from './module.js'
import { applyThemePatch } from './patch.js'
import { type ThemeOverrides, themeOverrides, themeTokens } from './tokens.js'
import {
  colorCss,
  colorToken,
  fontStackCss,
  fontStackToken,
  fontWeightCss,
  fontWeightToken,
  guard,
  isSafeDeclarationValue,
  LENGTH_UNITS,
  lengthCss,
  lengthToken,
  lineHeightCss,
  lineHeightToken,
} from './values.js'

let app: Application
let revisions: ReturnType<typeof collectRevisions>

/**
 * @param transactions whether the command pipeline opens one.
 *
 * On by default, because that is what an application does. The concurrency tests turn
 * it off, and say there why.
 */
const build = (authorization = permitAll(), { transactions = true } = {}) => {
  revisions = collectRevisions()
  app = createApplication({
    modules: [theme()],
    authorization,
    revisions,
    ...(transactions ? { transactions: dataTransactions() } : {}),
    logger: createLogger(silentWriter),
  })

  return app.boot()
}

const ADA = '3f9c2a10-4d5b-4c8e-9a71-1f2e3d4c5b6a'

const run = <T>(work: () => Promise<T>): Promise<T> =>
  app.run({ source: 'studio', actor: { type: 'user', id: ADA } }, work)

const update = (input: Record<string, unknown>) =>
  run(() => app.commands.execute('theme.update', input)) as Promise<{
    version: number
    overrides: ThemeOverrides
    tokens: ReturnType<typeof resolveTheme>
    cssVersion: string
  }>

const get = () =>
  run(() => app.queries.execute('theme.get', {})) as Promise<{
    version: number
    overrides: ThemeOverrides
    tokens: ReturnType<typeof resolveTheme>
    cssVersion: string
  }>

beforeEach(async () => {
  clearRestorers()
  useAdapter(createMemoryAdapter())
  await build()
})

describe('what a theme may say (SPEC.md §62)', () => {
  it('takes a colour, a length and a font stack, each as its own kind', async () => {
    const result = await update({
      colors: { brand: '#0F766E' },
      spacing: { xl: '7rem' },
      radius: { md: '4px' },
      container: { wide: '72rem' },
      typography: {
        fonts: { heading: ['Fraunces', 'Georgia', 'serif'] },
        sizes: { '2xl': '2.75rem' },
        weights: { black: 900 },
        lineHeights: { tight: 1.1 },
      },
    })

    expect(result.version).toBe(1)
    expect(result.tokens.colors.brand).toBe('#0F766E')
    expect(result.tokens.spacing.xl).toBe('7rem')

    const css = themeCss(result.tokens)

    // Rebuilt from the parsed parts, which is why the casing normalises and why the
    // quoted family is quoted and the generic one is not.
    expect(css).toContain('--brand: #0f766e;')
    expect(css).toContain('--space-xl: 7rem;')
    expect(css).toContain('--radius-md: 4px;')
    expect(css).toContain('--width-wide: 72rem;')
    expect(css).toContain('--font-heading: "Fraunces", "Georgia", serif;')
    expect(css).toContain('--text-2xl: 2.75rem;')
    expect(css).toContain('--weight-black: 900;')
    expect(css).toContain('--leading-tight: 1.1;')
  })

  it('names a colour the way a block names it, so §61 and §62 agree', async () => {
    // `blockDesign.background` is a token name, and `@assemora/react` renders it as
    // `var(--surface-sunken)`. The theme is the list of colours there are.
    const { tokens } = await update({ colors: { 'surface-sunken': '#eef0f7' } })

    expect(themeCss(tokens)).toContain('--surface-sunken: #eef0f7;')
  })

  it('refuses a colour token name a block could not write', async () => {
    await expect(update({ colors: { Brand_Soft: '#000000' } })).rejects.toThrow(ValidationError)
  })
})

describe('the keys §61 addresses by name are required (ADR-0024)', () => {
  it('refuses a document missing a step of the spacing scale', () => {
    // A theme with no `xl` is a theme in which `spacingTop: 'xl'` renders nothing,
    // and the failure lands in a browser rather than here (ADR-0024).
    const { xl, ...withoutXl } = defaultTheme.spacing
    const parsed = themeTokens().parse({ ...defaultTheme, spacing: withoutXl })

    expect(xl).toBe('6rem')
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.issues[0]?.path).toEqual(['spacing', 'xl'])
  })

  it('refuses a step nobody can ask for, rather than dropping it', async () => {
    await expect(update({ spacing: { huge: '1rem' } })).rejects.toThrow(ValidationError)
  })

  it('defines every key of every scale, so no control renders nothing', () => {
    const css = themeCss(defaultTheme)

    for (const step of SPACING_SCALE) expect(css).toContain(`--space-${step}:`)
    for (const step of RADIUS_SCALE) expect(css).toContain(`--radius-${step}:`)
  })
})

/**
 * The attempts. Every one of them is a way to end a declaration and start writing
 * rules, and every one has to be refused where it is written rather than escaped
 * where it is read (SPEC.md §62, ADR-0024).
 */
describe('a theme is not a stylesheet', () => {
  const injections: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a semicolon in a colour', { colors: { brand: '#fff; color: red' } }],
    [
      'a closing brace in a font name',
      { typography: { fonts: { body: ['x; } body { display: none'] } } },
    ],
    [
      'a closing style element',
      { typography: { fonts: { body: ['</style><script>alert(1)</script>'] } } },
    ],
    ['a javascript url', { colors: { brand: 'url(javascript:alert(1))' } }],
    [
      'a url in a font stack',
      { typography: { fonts: { body: ['url(https://evil.test/x.css)'] } } },
    ],
    ['a comment opener in a length', { spacing: { md: '1rem /* ' } }],
    ['a newline in a colour', { colors: { brand: '#fff\n}\nbody{display:none}' } }],
    ['a backslash escape in a font name', { typography: { fonts: { body: ['A\\3b B'] } } }],
    ['a variable reference as a colour', { colors: { brand: 'var(--x)' } }],
    ['a variable reference as a font name', { typography: { fonts: { body: ['--brand'] } } }],
    ['a token name that closes the declaration', { colors: { 'a; --b': '#000000' } }],
    ['a quote in a font name', { typography: { fonts: { body: ['A", serif; } *{'] } } }],
    ['an expression instead of a length', { spacing: { md: 'calc(1rem + 1px)' } }],
    ['an import rule', { typography: { fonts: { body: ['@import url(x)'] } } }],
  ]

  for (const [what, input] of injections) {
    it(`refuses ${what}, at the command`, async () => {
      await expect(update(input)).rejects.toThrow(ValidationError)

      // And nothing was written: a refused command leaves no row behind.
      expect(await Theme.find(THEME_ID)).toBeNull()
    })
  }

  it('writes no declaration for a hostile value that reached the row another way', () => {
    // A schema cannot protect JSONB. Whoever reaches the database reaches the
    // document, so the renderer parses again and drops what it cannot rebuild.
    const poisoned = {
      ...defaultTheme,
      colors: { ...defaultTheme.colors, brand: '#fff; } body { display: none } :root {' },
      typography: {
        ...defaultTheme.typography,
        fonts: { ...defaultTheme.typography.fonts, body: ['</style>'] },
      },
    }

    const css = themeCss(poisoned)

    expect(css).not.toContain('--brand:')
    expect(css).not.toContain('--font-body:')
    expect(css).not.toContain('display: none }')
    expect(css).not.toContain('</style>')
  })
})

describe('an update is a merge, and null clears (SPEC.md §62)', () => {
  it('leaves alone what it does not name', async () => {
    await update({ colors: { brand: '#111111' } })
    const second = await update({ spacing: { md: '3rem' } })

    expect(second.tokens.colors.brand).toBe('#111111')
    expect(second.tokens.spacing.md).toBe('3rem')
    expect(second.version).toBe(2)
  })

  it('puts a token back the way the theme had it', async () => {
    await update({ colors: { brand: '#111111' } })
    const cleared = await update({ colors: { brand: null } })

    expect(cleared.tokens.colors.brand).toBe(defaultTheme.colors.brand)
    // The override is gone rather than emptied: two ways of saying "nothing here"
    // would be two rows and two cache versions.
    expect(cleared.overrides.colors).toBeUndefined()
  })

  it('stores only what somebody decided', async () => {
    await update({ spacing: { xl: '7rem' } })
    const stored = await Theme.findOrFail(THEME_ID)

    expect(stored.tokens).toEqual({ spacing: { xl: '7rem' } })
  })

  it('resets a required key to its default rather than deleting it', () => {
    const overrides = applyThemePatch({ spacing: { xl: '7rem' } }, { spacing: { xl: null } })

    expect(overrides.spacing).toBeUndefined()
    expect(resolveTheme(overrides).spacing.xl).toBe(defaultTheme.spacing.xl)
  })
})

describe('a theme change is a revision (SPEC.md §64)', () => {
  it('records what the theme was before', async () => {
    await update({ colors: { brand: '#111111' } })
    await update({ colors: { brand: '#222222' } })

    const [first, second] = revisions.entries
    const previous = second?.before as { tokens: ThemeOverrides }

    expect(first?.entityType).toBe('theme')
    expect(first?.command).toBe('theme.update')
    expect(first?.before).toBeNull()
    expect(previous.tokens.colors?.brand).toBe('#111111')
  })

  it('goes back, including to the state where there was no theme at all', async () => {
    await update({ colors: { brand: '#111111' } })

    const restore = restorerFor('theme')

    expect(restore).toBeDefined()
    await run(async () => {
      await restore?.(THEME_ID, null)
    })

    expect(await Theme.find(THEME_ID)).toBeNull()
    expect((await get()).tokens.colors.brand).toBe(defaultTheme.colors.brand)
  })
})

describe('reading it (SPEC.md §62)', () => {
  it('answers with the defaults before anybody has edited anything', async () => {
    const read = await get()

    expect(read.version).toBe(0)
    expect(read.overrides).toEqual({})
    expect(read.tokens).toEqual(defaultTheme)
  })

  it('refuses a caller the policy refuses', async () => {
    await build({
      authorize: async (request) => {
        if (request.command === 'theme.update') throw new ForbiddenError('not you')
      },
    })

    await expect(update({ colors: { brand: '#000000' } })).rejects.toThrow(ForbiddenError)
  })

  it('refuses an update written against a theme that has since moved (SPEC.md §66)', async () => {
    await update({ colors: { brand: '#111111' } })

    await expect(update({ colors: { brand: '#222222' }, expectedVersion: 0 })).rejects.toThrow(
      /changed since/,
    )
  })
})

describe('the version in the URL (ADR-0024)', () => {
  it('changes when the stylesheet does', () => {
    const before = themeVersion(defaultTheme)
    const after = themeVersion(resolveTheme({ colors: { brand: '#000000' } }))

    expect(after).not.toBe(before)
    expect(before).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not change when the document says the same thing differently', () => {
    // `#FFF` and `#ffffff` are different documents and the same white, but they are
    // not the same stylesheet — the version follows the CSS, so this pair is the one
    // that must agree: the same length, written two ways.
    const one = themeVersion(resolveTheme({ spacing: { md: '1.5rem' } }))
    const other = themeVersion(resolveTheme({ spacing: { md: '1.5000rem' } }))

    expect(other).toBe(one)
  })

  it('does not change when tokens are stored in another order', () => {
    const one = themeVersion(resolveTheme({ colors: { a: '#000000', b: '#ffffff' } }))
    const other = themeVersion(resolveTheme({ colors: { b: '#ffffff', a: '#000000' } }))

    expect(other).toBe(one)
  })
})

describe('the stylesheet (ADR-0024)', () => {
  it('renders the values the examples hand-wrote, so nothing looks different', () => {
    const css = themeCss(defaultTheme)

    expect(css).toContain('--space-none: 0;')
    expect(css).toContain('--space-xs: 0.5rem;')
    expect(css).toContain('--space-2xl: 9rem;')
    expect(css).toContain('--width-narrow: 34rem;')
    expect(css).toContain('--brand: #4a5ed6;')
    expect(css).toContain('--surface: #ffffff;')
    expect(css).toContain(
      '--font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;',
    )
  })

  it('carries the rules @assemora/react renders against', () => {
    const css = themeCss(defaultTheme)

    expect(css).toContain('padding-top: var(--assemora-space-top, 0);')
    expect(css).toContain('.assemora-design[data-width="narrow"] > *')
    expect(css).toContain('.assemora-design[data-container="wide"]')
    expect(css).toContain('[data-hidden-mobile]')
  })

  it('sits in a layer, so a site’s own stylesheet still wins', () => {
    expect(themeCss(defaultTheme)).toContain('@layer assemora {')
  })
})

describe('the value kinds, on their own (SPEC.md §62)', () => {
  it('takes a length in any unit it declares, and nothing else', () => {
    for (const unit of LENGTH_UNITS) expect(lengthCss(`1.5${unit}`)).toBe(`1.5${unit}`)

    expect(lengthCss('0')).toBe('0')
    // Normalised, so two spellings of one length are one stylesheet.
    expect(lengthCss('1.500rem')).toBe('1.5rem')
    expect(lengthCss('1cm')).toBeUndefined()
    expect(lengthCss('1e3px')).toBeUndefined()
    expect(lengthCss('-1rem')).toBeUndefined()
    expect(lengthCss('99999999rem')).toBeUndefined()
  })

  it('quotes a family name and leaves a generic one bare', () => {
    expect(fontStackCss(['Segoe UI', 'sans-serif'])).toBe('"Segoe UI", sans-serif')
    expect(fontStackCss(['-apple-system', 'BlinkMacSystemFont'])).toBe(
      '-apple-system, BlinkMacSystemFont',
    )
  })

  it('keeps a weight and a line height inside what CSS means by them', () => {
    expect(fontWeightCss(700)).toBe('700')
    expect(fontWeightCss(0)).toBeUndefined()
    expect(fontWeightCss(1001)).toBeUndefined()
    expect(fontWeightCss(400.5)).toBeUndefined()
    expect(lineHeightCss(1.55)).toBe('1.55')
    expect(lineHeightCss(0.0000001)).toBeUndefined()
    expect(lineHeightCss(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  it('validates a stored overrides document the same way', () => {
    expect(themeOverrides().parse({ spacing: { xl: '7rem' } }).ok).toBe(true)
    expect(themeOverrides().parse({}).ok).toBe(true)
    expect(themeOverrides().parse({ colors: { brand: 'red' } }).ok).toBe(false)
    expect(themeOverrides().parse({ spacing: { huge: '1rem' } }).ok).toBe(false)
  })

  it('renders what it can of a document that is missing whole groups', () => {
    // The parameter type says every group is present; JSONB says whatever it likes.
    const css = themeCss({ colors: { ink: '#000000' } } as unknown as typeof defaultTheme)

    expect(css).toContain('--ink: #000000;')
    expect(css).not.toContain('--space-md:')
    expect(css).toContain('@layer assemora {')
  })

  it('writes no declaration for a token name that reached the row another way', () => {
    const css = themeCss({
      ...defaultTheme,
      colors: { ...defaultTheme.colors, 'a: red; --b': '#000000' },
    })

    expect(css).not.toContain('a: red')
  })
})

/**
 * The two halves of every kind must accept the same set (SPEC.md §62, ADR-0024).
 *
 * `values.ts` says it out loud: a schema that refuses anything else at the command,
 * and a renderer that parses again and writes from what it parsed. If the schema is
 * the looser of the two, a 200 OK deletes a declaration — the theme with no `xl` that
 * ADR-0024 declares impossible, produced by an edit nobody was warned about.
 */
describe('what a command accepts, the stylesheet says', () => {
  const kinds: readonly (readonly [
    string,
    { parse: (value: unknown) => { ok: boolean } },
    (value: unknown) => string | undefined,
    readonly unknown[],
  ])[] = [
    [
      'length',
      lengthToken(),
      lengthCss,
      [
        '0',
        '1rem',
        '1.5rem',
        '24px',
        '100%',
        '0.0001rem',
        '9999px',
        '9999.9999rem',
        '10000px',
        '20000px',
        '99999rem',
        '99999.9999px',
        '1cm',
        '-1rem',
        '1e3px',
        '',
        'calc(1rem)',
        0,
      ],
    ],
    [
      'colour',
      colorToken(),
      colorCss,
      [
        '#fff',
        '#FFFF',
        '#4a5ed6',
        '#4a5ed6ff',
        'transparent',
        'Transparent',
        'currentColor',
        'currentcolor',
        'red',
        '#ff',
        'constructor',
        '__proto__',
        '',
      ],
    ],
    [
      'font stack',
      fontStackToken(),
      fontStackCss,
      [['Inter', 'sans-serif'], ['-apple-system'], ['Segoe UI'], [], ['x; }'], 'Inter'],
    ],
    ['weight', fontWeightToken(), fontWeightCss, [1, 400, 1000, 0, 1001, 400.5, '400']],
    ['line height', lineHeightToken(), lineHeightCss, [0.5, 1.55, 10, 0.4, 10.1, 1e-7, '1.5']],
  ]

  for (const [what, schema, render, values] of kinds) {
    it(`accepts no ${what} its renderer would drop`, () => {
      for (const value of values) {
        if (!schema.parse(value).ok) continue

        expect({ value, css: render(value) }).toEqual({ value, css: expect.any(String) })
      }
    })
  }

  it('refuses a length long enough to vanish from the stylesheet', async () => {
    // 20000px passed the pattern and then failed the parser's own range, so the token
    // was written to the row, answered with 200, and never reached the CSS.
    await expect(update({ spacing: { xl: '20000px' } })).rejects.toThrow(ValidationError)
  })

  it('keeps every required step present whatever a caller sets', async () => {
    const { tokens } = await update({ spacing: { xl: '9999px' } })
    const css = themeCss(tokens)

    for (const step of SPACING_SCALE) expect(css).toContain(`--space-${step}:`)
  })
})

describe('a colour is never something every object already has', () => {
  it('writes no declaration for a value that only exists on Object.prototype', () => {
    // `constructor` is the one all-lowercase key on `Object.prototype`, and the
    // keyword table was an object literal — so the lookup found a function, and the
    // one branch in the file that skipped the output gate returned it.
    expect(colorCss('constructor')).toBeUndefined()
    expect(colorCss('__proto__')).toBeUndefined()
    expect(colorCss('toString')).toBeUndefined()
    expect(colorCss('valueOf')).toBeUndefined()
  })

  it('drops it out of a document that reached the row another way', () => {
    const css = themeCss({
      ...defaultTheme,
      colors: { ...defaultTheme.colors, brand: 'constructor', danger: '__proto__' },
    })

    expect(css).not.toContain('--brand:')
    expect(css).not.toContain('--danger:')
    expect(css).not.toContain('native code')
    expect(css).not.toContain('[object Object]')
  })

  it('still writes the two keywords a theme actually needs', () => {
    expect(colorCss('transparent')).toBe('transparent')
    expect(colorCss('CurrentColor')).toBe('currentColor')
  })
})

/**
 * A row is JSONB, so whoever reaches the database reaches the document. What the
 * command owes that is a way back: a value nobody could have written through the API
 * must not be able to hold the API shut.
 */
describe('a row that was written past the schema', () => {
  const poison = (tokens: unknown) =>
    Theme.create({
      id: THEME_ID,
      tokens: tokens as ThemeOverrides,
      version: 1,
      updatedBy: null,
    })

  it('does not refuse a command for something the command did not do', async () => {
    await poison({ colors: { 'a; --b': '#000000', brand: '#111111' } })

    const result = await update({ spacing: { xl: '7rem' } })

    expect(result.version).toBe(2)
    expect(result.tokens.spacing.xl).toBe('7rem')
    expect(result.tokens.colors.brand).toBe('#111111')
  })

  it('drops what the stylesheet could never say, so the row is repairable', async () => {
    await poison({ colors: { 'a; --b': '#000000', brand: '#111111' } })

    await update({})

    const stored = await Theme.findOrFail(THEME_ID)

    expect(stored.tokens).toEqual({ colors: { brand: '#111111' } })
  })

  it('keeps a group only while something in it survives', async () => {
    await poison({ colors: { 'a; --b': '#000000' }, spacing: { xl: '7rem' } })

    const { overrides } = await update({})

    expect(overrides.colors).toBeUndefined()
    expect(overrides.spacing).toEqual({ xl: '7rem' })
  })

  it('drops a whole group the document could not have held', async () => {
    await poison({ colors: 'not a group', spacing: { xl: '7rem' } })

    const { overrides, tokens } = await update({})

    expect(overrides.colors).toBeUndefined()
    expect(tokens.colors.brand).toBe(defaultTheme.colors.brand)
    expect(overrides.spacing).toEqual({ xl: '7rem' })
  })

  it('records the repair as a revision, so nothing is dropped without a trace', async () => {
    await poison({ colors: { 'a; --b': '#000000' } })
    await update({ colors: { brand: '#111111' } })

    const [entry] = revisions.entries
    const before = entry?.before as { tokens: Record<string, unknown> }

    // A group the patch did not name is the instance's own object, and this is a
    // reference to it — so a repair that removed the token in place would edit the
    // history that records the removal, and `revisions.undo` would put back a row
    // that no longer says what it said.
    expect(before.tokens).toEqual({ colors: { 'a; --b': '#000000' } })
  })
})

/**
 * Two edits at once (SPEC.md §66).
 *
 * Without transactions, deliberately: the in-memory adapter undoes one by restoring a
 * snapshot of the whole store, so the loser's rollback would erase the winner's row
 * as well — an artefact of the double rather than of the command. What is under test
 * is the write itself, and the write is one statement either way. The same two cases
 * were run against real PostgreSQL with transactions on, and behave identically.
 */
describe('two edits at once (SPEC.md §66)', () => {
  beforeEach(async () => {
    await build(permitAll(), { transactions: false })
  })

  it('lets one of them win and tells the other, rather than losing a write', async () => {
    await update({ colors: { brand: '#111111' } })

    const [first, second] = await Promise.allSettled([
      update({ colors: { brand: '#aaaaaa' }, expectedVersion: 1 }),
      update({ colors: { brand: '#bbbbbb' }, expectedVersion: 1 }),
    ])

    const settled = [first, second]
    const won = settled.filter((result) => result.status === 'fulfilled')
    const lost = settled.filter((result) => result.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(lost[0]?.status === 'rejected' && String(lost[0].reason)).toMatch(/changed since/)

    const stored = await Theme.findOrFail(THEME_ID)

    // And the winner's version is the one the row actually holds: being told "you
    // wrote version 2" by a command that wrote nothing is the same lie one layer up.
    expect(stored.version).toBe(2)
    expect(won[0]?.status === 'fulfilled' && won[0].value.version).toBe(2)
    expect(won[0]?.status === 'fulfilled' && won[0].value.tokens.colors.brand).toBe(
      (stored.tokens.colors as Record<string, string>).brand,
    )
  })

  it('applies both when neither stated a version, on top of whatever is there', async () => {
    await update({ colors: { brand: '#111111' } })

    await Promise.all([
      update({ colors: { brand: '#aaaaaa' } }),
      update({ spacing: { xl: '7rem' } }),
    ])

    const stored = await Theme.findOrFail(THEME_ID)

    // A patch that states no version means "apply this on top of whatever is there",
    // so neither of these two is an overwrite of the other.
    expect(stored.version).toBe(3)
    expect(stored.tokens.colors?.brand).toBe('#aaaaaa')
    expect(stored.tokens.spacing?.xl).toBe('7rem')
  })
})

/**
 * The last gate (`values.ts`).
 *
 * Every renderer builds its answer out of the parts it parsed, so on a correct day
 * nothing reaches this and fails it. That is exactly why it is tested here rather
 * than through a renderer: a gate whose refusal no test can see is a gate that can
 * quietly stop being applied on one path — which is what the keyword branch of
 * `colorCss` did, for as long as nobody looked.
 */
describe('the last gate (ADR-0024)', () => {
  it('refuses every shape an attack takes', () => {
    const attempts = [
      '#fff; color: red',
      'red } body { display: none',
      '{',
      '</style><script>alert(1)</script>',
      'url(https://evil.test/x.css)',
      'A\\3b B',
      '1rem /* ',
      'a: b',
      '#fff\nbody',
      '#fff\tred',
      'a/b',
      'function Object() { [native code] }',
    ]

    for (const attempt of attempts) expect(guard(attempt)).toBeUndefined()
  })

  it('lets through what a renderer actually builds', () => {
    expect(guard('#4a5ed6')).toBe('#4a5ed6')
    expect(guard('"Segoe UI", sans-serif')).toBe('"Segoe UI", sans-serif')
    expect(guard('1.5rem')).toBe('1.5rem')
    expect(guard('100%')).toBe('100%')
    expect(guard('700')).toBe('700')
    expect(guard('currentColor')).toBe('currentColor')
  })

  it('is what every renderer answers through', () => {
    // Whatever the document held, what came out of a renderer is something the gate
    // would pass — which is what leaves `css.ts` free to write it after a colon.
    const values: readonly unknown[] = [
      '#fff; color: red',
      'constructor',
      '__proto__',
      'transparent',
      '#4a5ed6',
      '1.5rem',
      '20000px',
      ['Segoe UI', 'sans-serif'],
      ['</style>'],
      700,
      1.55,
      null,
      undefined,
      {},
    ]

    for (const render of [colorCss, lengthCss, fontStackCss, fontWeightCss, lineHeightCss]) {
      for (const value of values) {
        const written = render(value)

        if (written !== undefined) expect(isSafeDeclarationValue(written)).toBe(true)
      }
    }
  })
})

describe('the width a block spans (SPEC.md §61)', () => {
  it('makes full the width of the container itself, not a narrower one', () => {
    // `data-width="full"` reads `--width-full`, like the other three, so the token is
    // the theme's to define — and its default has to be the width of the container
    // itself. Anything narrower would make "full" the one width that is not.
    expect(defaultTheme.container.full).toBe('100%')
    expect(themeCss(defaultTheme)).toContain('--width-full: 100%;')
  })
})
