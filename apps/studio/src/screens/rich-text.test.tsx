/**
 * The field somebody writes an article in.
 *
 * Rendered rather than reasoned about, because the defect was in the rendering: `richText`
 * was drawn as a textarea, so writing meant typing `<p>` and `<strong>` by hand.
 *
 * `execCommand` cannot be exercised without a browser, so what is checked here is what
 * can be: that the field is an editor rather than a box of source, that its first paint
 * already holds the article, and that the toolbar offers structure and nothing else.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RichTextInput } from './rich-text.tsx'

const draw = (value: string): string =>
  renderToStaticMarkup(<RichTextInput value={value} onChange={() => {}} />)

describe('the rich text field', () => {
  it('is written in, not typed as tags', () => {
    const markup = draw('<p>Привіт</p>')

    // Lowercased: React renders the attribute in its own casing, and the DOM normalises
    // it. What is being asserted is the editor, not the spelling.
    expect(markup.toLowerCase()).toContain('contenteditable="true"')
    expect(markup).not.toContain('<textarea')
  })

  it('holds the article from the first paint, not after an effect', () => {
    // Rendered on a server there are no effects at all, and a field that filled itself in
    // one would be empty here — and blank for a moment in a browser.
    expect(draw('<p>Тісто <strong>власного</strong> замісу.</p>')).toContain(
      '<p>Тісто <strong>власного</strong> замісу.</p>',
    )
  })

  it('offers structure', () => {
    const markup = draw('')

    for (const tool of [
      'Bold',
      'Italic',
      'Heading',
      'Subheading',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Link',
    ]) {
      expect(markup).toContain(tool)
    }
  })

  /**
   * SPEC.md §61, and the same rule the markdown field is written under: the theme decides
   * how a thing looks. A colour or a font here is the CSS editor arriving through the
   * field layer, one button at a time.
   */
  it('offers no colour, no font and no size', () => {
    const markup = draw('')

    for (const absent of ['color', 'Colour', 'font', 'Font', 'size', 'Size', 'background']) {
      expect(markup.toLowerCase()).not.toContain(`title="${absent.toLowerCase()}"`)
    }
  })
})
