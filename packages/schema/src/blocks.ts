/**
 * The block tree (SPEC.md §54).
 *
 * A page is a tree of blocks and never an HTML blob (SPEC.md §125.14), so the shape
 * of that tree is data every layer agrees on: the page layer edits it, Studio renders
 * it, an agent reads and proposes changes to it, and `@assemora/react` draws it.
 *
 * It lives in this package for one reason: `@assemora/react` depends on `schema` and
 * on nothing else. Were these types in `@assemora/pages`, a browser bundle would drag
 * the whole server layer in behind them (docs/architecture/package-graph.md).
 */
import { array, boolean, json, number, object, string } from './composites-bridge.js'
import { type BlockDesign, blockDesign } from './design.js'
import type { Schema } from './types.js'

export type BlockNode = {
  /** Stable and immutable for the life of the block (SPEC.md §54). */
  readonly id: string
  readonly type: string
  readonly version: number
  readonly props: Readonly<Record<string, unknown>>
  readonly children: readonly BlockNode[]
  /** Hidden blocks stay in the tree and out of the rendered page (SPEC.md §60). */
  readonly hidden?: boolean
  /**
   * The seven universal controls of SPEC.md §61.
   *
   * Beside `props` rather than inside it: `props` is the block author's, and a
   * framework key in there would collide with a field somebody declared.
   */
  readonly design?: BlockDesign
}

export type BlockTree = {
  readonly blocks: readonly BlockNode[]
}

export const emptyTree = (): BlockTree => ({ blocks: [] })

/** Depth-first, parents before children. The order Studio and a renderer walk in. */
export function* walkBlocks(tree: BlockTree): Generator<BlockNode> {
  const visit = function* (nodes: readonly BlockNode[]): Generator<BlockNode> {
    for (const node of nodes) {
      yield node
      yield* visit(node.children)
    }
  }

  yield* visit(tree.blocks)
}

export const findBlock = (tree: BlockTree, id: string): BlockNode | undefined => {
  for (const node of walkBlocks(tree)) {
    if (node.id === id) return node
  }

  return undefined
}

/** Every id in the tree, in walk order. Used to prove they stay unique. */
export const blockIds = (tree: BlockTree): string[] => [...walkBlocks(tree)].map((node) => node.id)

const blockNodeSchema = (): Schema<BlockNode> => {
  const node: Schema<BlockNode> = {
    kind: 'object',
    isOptional: false,
    isNullable: false,
    description: 'A block in a page tree',
    parse: (value) => {
      const shape = object({
        id: string().min(1),
        type: string().min(1),
        version: number().integer(),
        props: json<Record<string, unknown>>(),
        children: array(node),
        hidden: boolean().optional(),
        design: blockDesign().optional(),
      })

      const result = shape.parse(value)

      return result.ok ? { ok: true, value: result.value as BlockNode } : result
    },
    toJsonSchema: () => ({
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string' },
        version: { type: 'integer' },
        props: { type: 'object' },
        children: { type: 'array', items: { $ref: '#' } },
        hidden: { type: 'boolean' },
        design: blockDesign().toJsonSchema(),
      },
      required: ['id', 'type', 'version', 'props', 'children'],
    }),
  }

  return node
}

/** Validates a stored tree. What a JSONB column is checked against on the way in. */
export const blockTree = (): Schema<BlockTree> => {
  const blocks = array(blockNodeSchema())

  return {
    kind: 'object',
    isOptional: false,
    isNullable: false,
    description: 'A page as a tree of blocks',
    parse: (value) => {
      const result = object({ blocks }).parse(value)

      return result.ok ? { ok: true, value: result.value as BlockTree } : result
    },
    toJsonSchema: () => ({
      type: 'object',
      properties: { blocks: { type: 'array' } },
      required: ['blocks'],
    }),
  }
}

export type ChangedBlock = {
  readonly id: string
  readonly type: string
  /** Which of the block's own props differ. Empty when only the design changed. */
  readonly fields: readonly string[]
  readonly design: boolean
  readonly hidden: boolean
}

export type TreeChange = {
  readonly added: readonly BlockNode[]
  readonly removed: readonly BlockNode[]
  readonly changed: readonly ChangedBlock[]
  readonly moved: readonly BlockNode[]
}

const byId = (tree: BlockTree): Map<string, BlockNode> =>
  new Map([...walkBlocks(tree)].map((node) => [node.id, node]))

const differ = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)

/**
 * Where each block sits, as its parent and the siblings before it.
 *
 * The order among *surviving* siblings is what matters: a block that shifted down
 * because something was inserted above it has not moved, and saying it did would
 * bury the one edit somebody made under a list of everything after it.
 */
const positions = (tree: BlockTree, common: ReadonlySet<string>): Map<string, string> => {
  const at = new Map<string, string>()

  const visit = (nodes: readonly BlockNode[], parent: string) => {
    const surviving = nodes.filter((node) => common.has(node.id))

    for (const node of nodes) {
      at.set(node.id, `${parent}/${surviving.findIndex((sibling) => sibling.id === node.id)}`)
      visit(node.children, node.id)
    }
  }

  visit(tree.blocks, '')

  return at
}

/**
 * What actually happened to a page (SPEC.md §65).
 *
 * A field-level diff of two pages says `draftTree` changed and hands over both
 * trees, which is true and useless. This says "the hero's title changed" — the shape
 * SPEC.md §65 shows in Studio, and the one a change set needs (SPEC.md §75).
 *
 * It lives here because it is knowledge about the tree, and the tree lives here: the
 * editor, an agent and the API all read the same answer.
 */
export const diffTrees = (before: BlockTree, after: BlockTree): TreeChange => {
  const was = byId(before)
  const is = byId(after)
  const common = new Set([...was.keys()].filter((id) => is.has(id)))
  const wasAt = positions(before, common)
  const isAt = positions(after, common)

  const added: BlockNode[] = []
  const removed: BlockNode[] = []
  const changed: ChangedBlock[] = []
  const moved: BlockNode[] = []

  for (const [id, node] of is) {
    const previous = was.get(id)

    if (previous === undefined) {
      added.push(node)
      continue
    }

    const fields = [...new Set([...Object.keys(previous.props), ...Object.keys(node.props)])]
      .filter((name) => differ(previous.props[name], node.props[name]))
      .sort()

    const design = differ(previous.design, node.design)
    const hidden = (previous.hidden ?? false) !== (node.hidden ?? false)

    if (fields.length > 0 || design || hidden) {
      changed.push({ id, type: node.type, fields, design, hidden })
    }

    if (wasAt.get(id) !== isAt.get(id)) moved.push(node)
  }

  for (const [id, node] of was) {
    if (!is.has(id)) removed.push(node)
  }

  return { added, removed, changed, moved }
}
