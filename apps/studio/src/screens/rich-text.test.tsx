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

  /**
   * The article is not in this markup, and that is the fix rather than a gap.
   *
   * It was rendered with `dangerouslySetInnerHTML`, which put it here — and rewrote the
   * box on every commit that touched the element, even with the string unchanged, so
   * every keystroke restored what the field held at mount. Typed into a harness, three
   * characters came back as none. The value goes in through a layout effect now, which a
   * static render does not run, so what this asserts is the box, not its contents.
   */
  it('renders the box empty, because the value arrives through the DOM', () => {
    expect(draw('<p>Тісто</p>')).not.toContain('<p>Тісто</p>')
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
      'Remove link',
      'Image',
    ]) {
      expect(markup).toContain(tool)
    }
  })

  /**
   * The strip is the design's, so it is drawn the design's way: a `#f1f1f1` band under a
   * hairline, 30px square buttons, and the headings as their own words rather than as an
   * icon somebody has to learn. Asserted because it is the half a screenshot review
   * catches and a unit test usually does not.
   */
  it('is drawn as the toolbar of the design and not as a row of glyphs', () => {
    const markup = draw('')

    expect(markup).toContain('bg-canvas')
    expect(markup).toContain('size-[30px]')
    expect(markup).toContain('>H2<')
    expect(markup).toContain('>H3<')
    // The emoji it used to be: a paperclip and a backspace key standing in for icons.
    expect(markup).not.toContain('🔗')
    expect(markup).not.toContain('⌫')
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
