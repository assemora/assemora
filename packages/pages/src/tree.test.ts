import { ValidationError } from '@assemora/core'
import { select, text } from '@assemora/resources'
import { type BlockTree, blockIds, emptyTree, findBlock } from '@assemora/schema'
import { beforeEach, describe, expect, it } from 'vitest'

import { block, clearBlockRegistry, registerBlock } from './block.js'
import {
  addBlock,
  duplicateBlock,
  moveBlock,
  parentOf,
  removeBlock,
  setBlockHidden,
  unfinishedBlocks,
  updateBlockProps,
} from './tree.js'

const Hero = block('hero', {
  title: text().required(),
  variant: select('centered', 'split'),
})

const Section = block('section', { title: text() }, { acceptsChildren: true, maxChildren: 2 })

const Column = block(
  'column',
  { width: text() },
  { acceptsChildren: true, allowedChildren: ['hero'] },
)

const seed = () => {
  const first = addBlock(emptyTree(), {
    type: 'hero',
    props: { title: 'One', variant: 'centered' },
  })
  const second = addBlock(first.tree, { type: 'section', props: { title: 'Two' } })

  return { tree: second.tree, heroId: first.id, sectionId: second.id }
}

beforeEach(() => {
  clearBlockRegistry()
  registerBlock(Hero)
  registerBlock(Section)
  registerBlock(Column)
})

describe('adding', () => {
  it('gives every block a stable id of its own (SPEC.md §54)', () => {
    const { tree } = seed()
    const ids = blockIds(tree)

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('validates props against the block declaration', () => {
    expect(() =>
      addBlock(emptyTree(), { type: 'hero', props: { title: 'x', variant: 'nonsense' } }),
    ).toThrowError(ValidationError)
    expect(() =>
      addBlock(emptyTree(), { type: 'hero', props: { title: 'x', variant: 'split', extra: 1 } }),
    ).toThrowError(ValidationError)
  })

  it('adds a block nobody has filled in yet, and says it is unfinished', () => {
    // An editor drops a block on the page and then writes it. Refusing the drop
    // would make a block with a required field impossible to add at all.
    const { tree } = addBlock(emptyTree(), { type: 'hero', props: { variant: 'centered' } })

    expect(tree.blocks).toHaveLength(1)
    expect(unfinishedBlocks(tree)).toEqual([
      { path: ['hero', 'title'], code: 'required', message: 'This field is required' },
    ])
  })

  it('does not ask a hidden block to be finished', () => {
    const added = addBlock(emptyTree(), { type: 'hero', props: { variant: 'centered' } })
    const hidden = setBlockHidden(added.tree, added.id, true)

    expect(unfinishedBlocks(hidden)).toEqual([])
  })

  it('refuses a block type nobody registered', () => {
    expect(() => addBlock(emptyTree(), { type: 'ghost' })).toThrowError('no block of type "ghost"')
  })

  it('inserts where it was told', () => {
    const { tree, heroId, sectionId } = seed()
    const inserted = addBlock(tree, {
      type: 'hero',
      props: { title: 'Middle', variant: 'split' },
      index: 1,
    })

    expect(inserted.tree.blocks.map((node) => node.id)).toEqual([heroId, inserted.id, sectionId])
  })

  it('nests under a block that accepts children', () => {
    const { tree, sectionId } = seed()
    const nested = addBlock(tree, {
      type: 'hero',
      props: { title: 'Inside', variant: 'split' },
      parentId: sectionId,
    })

    expect(parentOf(nested.tree, nested.id)).toBe(sectionId)
  })

  it('refuses to nest under a block that accepts none (SPEC.md §56)', () => {
    const { tree, heroId } = seed()

    expect(() =>
      addBlock(tree, { type: 'hero', props: { title: 'x', variant: 'split' }, parentId: heroId }),
    ).toThrowError('does not accept children')
  })

  it('honours allowedChildren and maxChildren', () => {
    const withColumn = addBlock(emptyTree(), { type: 'column', props: { width: 'half' } })

    expect(() =>
      addBlock(withColumn.tree, {
        type: 'section',
        props: { title: 'x' },
        parentId: withColumn.id,
      }),
    ).toThrowError('does not accept a section')

    const { tree, sectionId } = seed()
    let filled: BlockTree = tree

    for (const title of ['a', 'b']) {
      filled = addBlock(filled, {
        type: 'hero',
        props: { title, variant: 'split' },
        parentId: sectionId,
      }).tree
    }

    expect(() =>
      addBlock(filled, {
        type: 'hero',
        props: { title: 'c', variant: 'split' },
        parentId: sectionId,
      }),
    ).toThrowError('at most 2 children')
  })
})

describe('editing', () => {
  it('merges props and bumps the block version', () => {
    const { tree, heroId } = seed()
    const updated = updateBlockProps(tree, heroId, { title: 'Renamed' })
    const node = findBlock(updated, heroId)

    expect(node?.props).toEqual({ title: 'Renamed', variant: 'centered' })
    expect(node?.version).toBe(2)
  })

  it('refuses props the block does not declare', () => {
    const { tree, heroId } = seed()

    expect(() => updateBlockProps(tree, heroId, { nickname: 'x' })).toThrowError(ValidationError)
  })

  it('hides a block without removing it (SPEC.md §60)', () => {
    const { tree, heroId } = seed()
    const hidden = setBlockHidden(tree, heroId, true)

    expect(findBlock(hidden, heroId)?.hidden).toBe(true)
    expect(blockIds(hidden)).toHaveLength(2)
  })

  it('leaves the tree it was given untouched', () => {
    const { tree, heroId } = seed()

    updateBlockProps(tree, heroId, { title: 'Renamed' })

    expect(findBlock(tree, heroId)?.props.title).toBe('One')
  })
})

describe('moving', () => {
  it('takes a block and its children along', () => {
    const { tree, sectionId } = seed()
    const inner = addBlock(tree, {
      type: 'hero',
      props: { title: 'Inside', variant: 'split' },
      parentId: sectionId,
    })

    const moved = moveBlock(inner.tree, sectionId, { index: 0 })

    expect(moved.blocks[0]?.id).toBe(sectionId)
    expect(findBlock(moved, inner.id)).toBeDefined()
    expect(parentOf(moved, inner.id)).toBe(sectionId)
  })

  it('refuses to move a block inside itself', () => {
    const { tree, sectionId } = seed()

    expect(() => moveBlock(tree, sectionId, { parentId: sectionId })).toThrowError(
      'cannot be moved inside itself',
    )
  })

  it('refuses a destination that does not accept it', () => {
    const { tree, heroId, sectionId } = seed()

    expect(() => moveBlock(tree, sectionId, { parentId: heroId })).toThrowError(
      'does not accept children',
    )
  })
})

describe('duplicating and removing', () => {
  it('copies beside the original with new ids throughout', () => {
    const { tree, sectionId } = seed()
    const inner = addBlock(tree, {
      type: 'hero',
      props: { title: 'Inside', variant: 'split' },
      parentId: sectionId,
    })

    const copied = duplicateBlock(inner.tree, sectionId)
    const ids = blockIds(copied.tree)

    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(parentOf(copied.tree, copied.id)).toBeNull()
  })

  it('removes a block and everything inside it', () => {
    const { tree, sectionId } = seed()
    const inner = addBlock(tree, {
      type: 'hero',
      props: { title: 'Inside', variant: 'split' },
      parentId: sectionId,
    })

    const removed = removeBlock(inner.tree, sectionId)

    expect(blockIds(removed)).toHaveLength(1)
    expect(findBlock(removed, inner.id)).toBeUndefined()
  })

  it('refuses to touch a block that is not there', () => {
    const { tree } = seed()

    for (const act of [
      () => removeBlock(tree, 'nope'),
      () => moveBlock(tree, 'nope', {}),
      () => updateBlockProps(tree, 'nope', {}),
      () => duplicateBlock(tree, 'nope'),
    ]) {
      expect(act).toThrowError('There is no block')
    }
  })
})
