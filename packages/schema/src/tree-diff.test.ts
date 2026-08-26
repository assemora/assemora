import { describe, expect, it } from 'vitest'

import type { BlockNode, BlockTree } from './blocks.js'
import { diffTrees } from './blocks.js'

const node = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: BlockNode[] = [],
): BlockNode => ({
  id,
  type,
  version: 1,
  props,
  children,
})

const tree = (...blocks: BlockNode[]): BlockTree => ({ blocks })

describe('what happened to a page (SPEC.md §65)', () => {
  it('names the block and the prop that changed, not the whole document', () => {
    const before = tree(node('a', 'hero', { title: 'One', subtitle: 'Same' }))
    const after = tree(node('a', 'hero', { title: 'Two', subtitle: 'Same' }))

    expect(diffTrees(before, after).changed).toEqual([
      { id: 'a', type: 'hero', fields: ['title'], design: false, hidden: false },
    ])
  })

  it('sees a block appear and a block go', () => {
    const change = diffTrees(tree(node('a', 'hero')), tree(node('b', 'faq')))

    expect(change.added.map((block) => block.type)).toEqual(['faq'])
    expect(change.removed.map((block) => block.type)).toEqual(['hero'])
    expect(change.changed).toEqual([])
  })

  it('sees a block move without calling it a change', () => {
    const before = tree(node('a', 'hero'), node('b', 'faq'))
    const after = tree(node('b', 'faq'), node('a', 'hero'))
    const change = diffTrees(before, after)

    expect(change.moved.map((block) => block.id).sort()).toEqual(['a', 'b'])
    expect(change.changed).toEqual([])
  })

  it('sees a block nested into another one', () => {
    const before = tree(node('a', 'section'), node('b', 'faq'))
    const after = tree(node('a', 'section', {}, [node('b', 'faq')]))

    expect(diffTrees(before, after).moved.map((block) => block.id)).toEqual(['b'])
  })

  it('tells a design change from a content change', () => {
    const before = tree(node('a', 'hero', { title: 'One' }))
    const after: BlockTree = {
      blocks: [{ ...node('a', 'hero', { title: 'One' }), design: { width: 'wide' } }],
    }

    expect(diffTrees(before, after).changed).toEqual([
      { id: 'a', type: 'hero', fields: [], design: true, hidden: false },
    ])
  })

  it('sees a block hidden', () => {
    const before = tree(node('a', 'hero'))
    const after: BlockTree = { blocks: [{ ...node('a', 'hero'), hidden: true }] }

    expect(diffTrees(before, after).changed[0]?.hidden).toBe(true)
  })

  it('says nothing happened when nothing did', () => {
    const same = tree(node('a', 'hero', { title: 'One' }, [node('b', 'faq')]))

    expect(diffTrees(same, same)).toEqual({ added: [], removed: [], changed: [], moved: [] })
  })
})
