import type { BlockNode, BlockTree } from '@assemora/schema'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { PageDetail } from '../api/pages.ts'
import {
  allowedMoves,
  blockAbove,
  liftOut,
  parentOf,
  placeBeside,
  rememberPage,
  siblingsOf,
  stepFrom,
} from './state.ts'

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

describe('where a new block lands (SPEC.md §60)', () => {
  const anywhere = () => true

  it('appends when nothing is selected, because there is no "here"', () => {
    expect(placeBeside(tree, null, anywhere)).toEqual({})
  })

  it('lands after the selection rather than at the bottom of the page', () => {
    expect(placeBeside(tree, 'a', anywhere)).toEqual({ index: 1 })
  })

  it('stays inside the container the selection is in', () => {
    expect(placeBeside(tree, 'c', anywhere)).toEqual({ parentId: 'b', index: 1 })
  })

  /**
   * The nesting rules are the application's (SPEC.md §56). A parent that will not
   * hold the type is not argued with — the block goes after the ancestor that will.
   */
  it('walks out to the nearest parent that will hold the type', () => {
    expect(placeBeside(tree, 'd', (container) => container === null)).toEqual({ index: 2 })
  })

  it('appends when the selection is not in this tree', () => {
    expect(placeBeside(tree, 'nowhere', anywhere)).toEqual({})
  })
})

describe('lifting a block out of its container', () => {
  it('puts it directly after the container it came out of', () => {
    expect(liftOut(tree, 'c')).toEqual({ index: 2 })
  })

  it('has nowhere to lift a block that is already at the top', () => {
    expect(liftOut(tree, 'a')).toBeUndefined()
  })

  it('stays under the grandparent when there is one', () => {
    const deep: BlockTree = { blocks: [node('a'), node('b', [node('c', [node('e')])])] }

    expect(liftOut(deep, 'e')).toEqual({ parentId: 'b', index: 1 })
  })
})

describe('what the Properties panel may offer (SPEC.md §56, §60)', () => {
  const anywhere = () => true
  const nowhere = () => false

  it('offers nothing at all with no selection', () => {
    expect(allowedMoves(tree, undefined, anywhere)).toEqual({
      indent: false,
      outdent: false,
      duplicate: false,
    })
  })

  it('nests into the block above, when that block will hold it', () => {
    expect(allowedMoves(tree, node('b', [node('c')]), anywhere).indent).toBe(true)
    expect(allowedMoves(tree, node('b', [node('c')]), nowhere).indent).toBe(false)
    // Nothing above the first block to nest into.
    expect(allowedMoves(tree, node('a'), anywhere).indent).toBe(false)
  })

  it('lifts out only what is inside something', () => {
    expect(allowedMoves(tree, node('c'), anywhere).outdent).toBe(true)
    expect(allowedMoves(tree, node('a'), anywhere).outdent).toBe(false)
  })

  /**
   * Finding 5. `blocks.duplicate` counts the copy as a new child, so duplicating the
   * last child a container will take is refused with a 422 — and Duplicate was the
   * one control that went on offering it, in a UI where the palette badge and the
   * canvas `+` had both learned to say no.
   */
  it('refuses to duplicate a block whose container will take no more', () => {
    const full = (container: BlockNode | null) => container === null

    expect(allowedMoves(tree, node('c'), full).duplicate).toBe(false)
    expect(allowedMoves(tree, node('c'), anywhere).duplicate).toBe(true)
  })

  it('duplicates a top-level block whatever any container says', () => {
    // The top level is nobody's child, so there is no `maxChildren` to reach.
    expect(allowedMoves(tree, node('a'), (container) => container === null).duplicate).toBe(true)
  })

  it('asks about the container the copy lands in, not about the block itself', () => {
    const asked: (string | null)[] = []

    allowedMoves(tree, node('c'), (container) => {
      asked.push(container?.id ?? null)

      return true
    })

    expect(asked).toContain('b')
    expect(asked).not.toContain('c')
  })
})

describe('what a command answers with goes into the cache (SPEC.md §60)', () => {
  const page = (): PageDetail => ({
    id: 'p1',
    slug: 'home',
    title: 'Home',
    status: 'draft',
    mode: 'draft',
    tree: { blocks: [node('a')] },
    meta: {},
    version: 3,
    hasUnpublishedChanges: true,
    publishedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const seeded = () => {
    const client = new QueryClient()

    client.setQueryData<PageDetail>(['page', 'p1', 'draft'], page())

    return client
  }

  /**
   * The whole point. Evicting this key put React Query back into pending, which
   * returned the screen's spinner and unmounted all three panes — so every keystroke
   * pause reloaded the canvas iframe from the network.
   */
  it('leaves the query the builder is mounted on loaded, never pending', () => {
    const client = seeded()

    rememberPage(client, page(), { tree, version: 4, hasUnpublishedChanges: true })

    expect(client.getQueryState(['page', 'p1', 'draft'])).toMatchObject({
      status: 'success',
      fetchStatus: 'idle',
    })
    expect(client.getQueryData<PageDetail>(['page', 'p1', 'draft'])?.tree).toEqual(tree)
    expect(client.getQueryData<PageDetail>(['page', 'p1', 'draft'])?.version).toBe(4)
  })

  it('keeps everything the command did not answer about', () => {
    const client = seeded()

    rememberPage(client, page(), { hasUnpublishedChanges: false })

    expect(client.getQueryData<PageDetail>(['page', 'p1', 'draft'])).toMatchObject({
      title: 'Home',
      version: 3,
      hasUnpublishedChanges: false,
    })
  })

  it('does not invent a page nobody has read', () => {
    const client = new QueryClient()

    rememberPage(client, page(), { tree, version: 4, hasUnpublishedChanges: true })

    expect(client.getQueryData(['page', 'p1', 'draft'])).toBeUndefined()
  })
})
