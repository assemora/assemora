import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EmptyPage, type Insertable, InsertionGap } from './canvas.tsx'
import type { InsertionPoint } from './insertion.ts'

/** A line the width of a page, which is what one between two stacked blocks is. */
const point: InsertionPoint = { index: 1, top: 100, left: 0, width: 772, height: 2 }

const hero: Insertable = { name: 'hero', label: 'Hero' }

const draw = (over: Partial<Parameters<typeof InsertionGap>[0]> = {}): string =>
  renderToStaticMarkup(
    <InsertionGap
      point={point}
      open={false}
      busy={false}
      options={[hero]}
      reason="Add a block here"
      holder={null}
      onOpen={() => undefined}
      onPick={() => undefined}
      {...over}
    />,
  )

/** The opening tag of the first element of this kind, attributes and all. */
const tagOf = (markup: string, name: string): string => {
  const at = markup.indexOf(`<${name}`)

  return at === -1 ? '' : markup.slice(at, markup.indexOf('>', at) + 1)
}

describe('an insertion point on the canvas (SPEC.md §59, §60)', () => {
  it('draws a band far larger than the line, so it can be aimed at', () => {
    const markup = draw()

    // The line is 772 × 2 and the band around it is 792 × 22 — the reviewer's own
    // measurement of what it drew.
    expect(tagOf(markup, 'div')).toContain('width:792px;height:22px')
  })

  /**
   * Finding 7. The whole overlay is `pointer-events: none` so Studio's chrome never
   * swallows a click meant for the page. The band inherited that and never took it
   * back, so the only thing that answered a pointer was the 20px circle: the padding
   * bought nothing and `group-hover` fired from the control it was there to reveal.
   */
  it('takes the pointer over the whole band, not over the circle alone', () => {
    const button = tagOf(draw(), 'button')

    expect(button).toContain('pointer-events-auto')
    // The same element, filling the band: a target elsewhere would be the old defect
    // with a different set of coordinates.
    expect(button).toContain('inset-0')
  })

  it('carries the hover group on the thing a pointer can reach', () => {
    // `:hover` never matches an element with `pointer-events: none`, so a group on
    // the wrapper is a highlight that cannot fire.
    expect(tagOf(draw(), 'button')).toMatch(/class="[^"]*\bgroup\b/)
  })

  it('offers what may go in when it is opened', () => {
    const markup = draw({ open: true })

    expect(markup).toContain('Hero')
    expect(draw({ open: false })).not.toContain('Hero')
  })

  /**
   * Selecting a block inside a full container used to drop every `+` from the page
   * at once, with nothing on screen to say why — which reads as a bug rather than as
   * the application's own rule.
   */
  it('still draws where nothing may go, and says why', () => {
    const full = { options: [], reason: 'The Section block will not take anything more' }
    const markup = draw({ ...full, open: true })

    expect(tagOf(markup, 'button')).toContain('The Section block will not take anything more')
    expect(markup).toContain('The Section block will not take anything more')
  })
})

describe('a page with nothing on it (SPEC.md §59)', () => {
  const card = (options: readonly Insertable[]): string =>
    renderToStaticMarkup(<EmptyPage options={options} busy={false} onInsert={() => undefined} />)

  it('invites the first block, and offers the ones that fit', () => {
    const markup = card([hero])

    expect(markup).toContain('This page has nothing on it yet')
    expect(markup).toContain('Hero')
  })

  /**
   * A fresh install declares no `block()` at all, and the invitation then stood over
   * a row of no buttons: "put the first one in" with nothing to put in reads as
   * software that has lost its palette rather than as a project that has not written
   * one yet.
   */
  it('says why there is nothing to offer, rather than offering nothing', () => {
    const markup = card([])

    expect(markup).toContain('Nothing can go on this page yet')
    expect(markup).toContain('This application declares no block types')
    expect(markup).not.toContain('Put the first one in')
  })

  it('sends somebody to the panel that says what to do, rather than repeating it', () => {
    // The Blocks panel carries the `assemora make:block` line, because it is also
    // where somebody looks on a page that already has blocks on it.
    expect(card([])).toContain('the Blocks panel on the left has the command that can')
  })
})
