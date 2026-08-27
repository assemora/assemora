import { describe, expect, it } from 'vitest'

import { colorTokensOf } from './theme.ts'

/**
 * A generated stylesheet, as `/api/theme.css` actually serves one.
 *
 * Copied from the bytes the reference application answers with, cut to one token per
 * group and with two additions that are the whole point of the test: a colour whose
 * name collides with the type scale's prefix, and a custom property outside `:root`.
 */
const STYLESHEET = `/* Generated from the theme (SPEC.md §62). Change tokens, not this file. */
@layer assemora {
  :root {
    --space-none: 0;
    --space-xl: 6rem;
    --width-full: 100%;
    --radius-full: 9999px;
    --brand: #4a5ed6;
    --brand-soft: #e4e7fb;
    --ink: #16181d;
    --surface: #ffffff;
    --text-muted: #8a8f9e;
    --veil: transparent;
    --rule: currentColor;
    --font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --text-md: 1rem;
    --weight-bold: 700;
    --leading-normal: 1.55;
  }

  .assemora-design[data-container="wide"] {
    --container: var(--width-wide);
  }

  .site-header {
    --sticky-background: #ff0000;
  }
}
`

describe('the colours a block may be given as a background (SPEC.md §61)', () => {
  it('offers every colour the stylesheet declares and nothing else', () => {
    expect(colorTokensOf(STYLESHEET)).toEqual([
      'brand',
      'brand-soft',
      'ink',
      'rule',
      'surface',
      'text-muted',
      'veil',
    ])
  })

  it('decides by the value, because a colour may be named like another group', () => {
    // `--text-muted` is a colour and `--text-md` is a size, and they are told apart by
    // what they hold. Reading the name would offer both or neither, and a site that
    // calls a colour `text-muted` is a site, not an edge case.
    expect(colorTokensOf(STYLESHEET)).toContain('text-muted')
    expect(colorTokensOf(STYLESHEET)).not.toContain('text-md')
  })

  it('takes nothing from a rule that is not :root', () => {
    // A custom property on a selector is that selector's business. Offering it as a
    // background would name a token that resolves to nothing anywhere else.
    expect(colorTokensOf(STYLESHEET)).not.toContain('sticky-background')
    expect(colorTokensOf(STYLESHEET)).not.toContain('container')
  })

  it('is empty when there is no stylesheet to read', () => {
    // The request can fail — an application still starting, a network that dropped.
    // The control then offers the theme default alone, which is what it did before
    // anybody chose a background.
    expect(colorTokensOf('')).toEqual([])
    expect(colorTokensOf(':root { }')).toEqual([])
  })
})
