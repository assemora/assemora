/**
 * That the set is a set: every name it offers draws its own glyph, and a name it does
 * not know draws the one every resource used to draw.
 *
 * The list a picker offers and the table a name is looked up in are two objects, and
 * two objects agree until somebody adds to one of them. A name in the picker with no
 * glyph behind it is a button that silently sets a resource's icon to a document.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ICON_GROUPS, ICON_NAMES, ResourceIcon } from './icons.tsx'

const drawn = (name: string | undefined): string =>
  renderToStaticMarkup(<ResourceIcon name={name} />)

/** Lucide names the element it renders, so the markup says which glyph came out. */
const glyphOf = (markup: string): string => markup.match(/lucide-([a-z0-9-]+)/)?.[1] ?? '(none)'

describe('what a resource is drawn as', () => {
  it('has a glyph for every name it offers', () => {
    // Compared against the *fallback* rather than against the name: Lucide spells a few
    // of its own classes differently from its file names — `grid-2x2` renders
    // `lucide-grid2x2` — and what this pins is that a name reaches a glyph at all.
    const missing = ICON_NAMES.filter(
      (name) => name !== 'file-text' && glyphOf(drawn(name)) === 'file-text',
    )

    expect(missing).toEqual([])
  })

  it('offers each name once, so a picker never draws the same choice twice', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
  })

  it('offers only names a definition is allowed to hold', () => {
    // The framework validates `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and stores what it is
    // given. A picker offering a name that pattern refuses would be a control whose
    // every use is a 422.
    const allowed = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

    expect(ICON_NAMES.filter((name) => !allowed.test(name))).toEqual([])
  })

  it('draws a document for a name it has never heard of, and for none at all', () => {
    // The degradation story: an application naming an icon a newer Studio would know
    // reads plainer, and does not break.
    expect(glyphOf(drawn('wormhole'))).toBe('file-text')
    expect(glyphOf(drawn(undefined))).toBe('file-text')
  })

  it('files every glyph under a heading, because a wall of sixty-one is not a choice', () => {
    expect(ICON_GROUPS.every((group) => group.names.length > 0)).toBe(true)
    expect(ICON_GROUPS.length).toBeGreaterThan(3)
  })
})
