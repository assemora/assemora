import type { BlockNode, BlockTree } from '@assemora/schema'
import { describe, expect, it } from 'vitest'

import { blockAbove, parentOf, siblingsOf, stepFrom } from './state.ts'

const node = (id: string, children: BlockNode[] = []): BlockNode => ({
  id,
  type: 'hero',
  version: 1,
  props: {},
  children,
})

/**
 * ```text
 * a
 * b
 *   c
 *   d
 * ```
 */
const tree: BlockTree = { blocks: [node('a'), node('b', [node('c'), node('d')])] }

describe('where a block sits', () => {
  it('names the block that holds it, or nothing at the top', () => {
    expect(parentOf(tree, 'a')).toBeNull()
    expect(parentOf(tree, 'c')).toBe('b')
  })

  it('lists the blocks it shares a parent with, in order', () => {
    expect(siblingsOf(tree, 'a').map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(siblingsOf(tree, 'c').map((entry) => entry.id)).toEqual(['c', 'd'])
  })

  it('names the block just before it', () => {
    expect(blockAbove(tree, 'b')?.id).toBe('a')
    expect(blockAbove(tree, 'd')?.id).toBe('c')
    expect(blockAbove(tree, 'a')).toBeUndefined()
    expect(blockAbove(tree, 'c')).toBeUndefined()
  })
})

describe('moving one place (SPEC.md §60)', () => {
  it('states the parent as well as the index, because omitting it means the top', () => {
    expect(stepFrom(tree, 'd', -1)).toEqual({ parentId: 'b', index: 0 })
    expect(stepFrom(tree, 'b', -1)).toEqual({ index: 0 })
  })

  it('refuses to step off either end', () => {
    expect(stepFrom(tree, 'a', -1)).toBeUndefined()
    expect(stepFrom(tree, 'b', 1)).toBeUndefined()
    expect(stepFrom(tree, 'c', -1)).toBeUndefined()
    expect(stepFrom(tree, 'd', 1)).toBeUndefined()
  })

  it('refuses a block that is not there', () => {
    expect(stepFrom(tree, 'nowhere', 1)).toBeUndefined()
  })
})
