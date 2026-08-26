import type { BlockTree } from '@assemora/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssemoraPage } from './page.js'
import { type BlockView, createBlockRegistry } from './registry.js'

const Hero: BlockView<{ title?: string }> = ({ props }) => <h1>{props.title}</h1>
const Section: BlockView = ({ children }) => <section>{children}</section>
const Missing: BlockView = ({ block }) => <p>No view for {block.type}</p>

const node = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: BlockTree['blocks'] = [],
  hidden?: boolean,
) => ({ id, type, version: 1, props, children, ...(hidden === undefined ? {} : { hidden }) })

const tree: BlockTree = {
  blocks: [
    node('a', 'hero', { title: 'Build visually' }),
    node('b', 'section', {}, [node('c', 'hero', { title: 'Inside' })]),
  ],
}

const registry = createBlockRegistry({ hero: Hero as BlockView<never>, section: Section })

describe('rendering a page', () => {
  it('draws the tree, parents around their children', () => {
    expect(renderToStaticMarkup(<AssemoraPage page={{ tree }} blocks={registry} />)).toBe(
      '<h1>Build visually</h1><section><h1>Inside</h1></section>',
    )
  })

  it('takes a bare tree as well as a page', () => {
    expect(renderToStaticMarkup(<AssemoraPage page={tree} blocks={registry} />)).toBe(
      renderToStaticMarkup(<AssemoraPage page={{ tree }} blocks={registry} />),
    )
  })

  it('leaves a hidden block out of the page', () => {
    const hidden: BlockTree = { blocks: [node('a', 'hero', { title: 'Gone' }, [], true)] }

    expect(renderToStaticMarkup(<AssemoraPage page={hidden} blocks={registry} />)).toBe('')
  })

  it('keeps a hidden block in the canvas, marked, so it can be brought back', () => {
    const hidden: BlockTree = { blocks: [node('a', 'hero', { title: 'Gone' }, [], true)] }
    const markup = renderToStaticMarkup(<AssemoraPage page={hidden} blocks={registry} editing />)

    expect(markup).toContain('data-assemora-hidden="true"')
    expect(markup).toContain('Gone')
  })

  it('draws nothing for a type it does not know', () => {
    const unknown: BlockTree = { blocks: [node('a', 'nowhere')] }

    expect(renderToStaticMarkup(<AssemoraPage page={unknown} blocks={registry} />)).toBe('')
  })

  it('draws the fallback instead when one was given', () => {
    const unknown: BlockTree = { blocks: [node('a', 'nowhere')] }
    const withFallback = createBlockRegistry(
      { hero: Hero as BlockView<never> },
      { fallback: Missing },
    )

    expect(renderToStaticMarkup(<AssemoraPage page={unknown} blocks={withFallback} />)).toBe(
      '<p>No view for nowhere</p>',
    )
  })

  it('marks every block for the editor without changing the layout', () => {
    const markup = renderToStaticMarkup(<AssemoraPage page={{ tree }} blocks={registry} editing />)

    expect(markup).toContain('data-assemora-block="a"')
    expect(markup).toContain('data-assemora-block="c"')
    expect(markup).toContain('style="display:contents"')
  })

  it('marks nothing when it is not editing', () => {
    expect(renderToStaticMarkup(<AssemoraPage page={{ tree }} blocks={registry} />)).not.toContain(
      'data-assemora-block',
    )
  })
})

describe('the registry', () => {
  it('knows what it was given', () => {
    expect(registry.types).toEqual(['hero', 'section'])
    expect(registry.has('hero')).toBe(true)
    expect(registry.has('nowhere')).toBe(false)
    expect(registry.viewFor('nowhere')).toBeUndefined()
  })
})

describe('the universal design controls (SPEC.md §61)', () => {
  const styled: BlockTree = {
    blocks: [
      {
        id: 'a',
        type: 'hero',
        version: 1,
        props: { title: 'Styled' },
        children: [],
        design: {
          spacingTop: 'lg',
          width: 'wide',
          align: 'center',
          background: 'surface-sunken',
          hiddenOn: ['mobile'],
        },
      },
    ],
  }

  it('turns each control into a token reference, never a value', () => {
    const markup = renderToStaticMarkup(<AssemoraPage page={styled} blocks={registry} />)

    expect(markup).toContain('class="assemora-design"')
    expect(markup).toContain('--assemora-space-top:var(--space-lg)')
    expect(markup).toContain('--assemora-background:var(--surface-sunken)')
    expect(markup).toContain('data-width="wide"')
    expect(markup).toContain('data-align="center"')
    expect(markup).toContain('data-hidden-mobile=""')
  })

  it('wraps nothing when nothing has been set', () => {
    expect(renderToStaticMarkup(<AssemoraPage page={tree} blocks={registry} />)).not.toContain(
      'assemora-design',
    )
  })
})
