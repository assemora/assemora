/**
 * Editing a block tree (SPEC.md §54, §56, §60).
 *
 * Every operation is a pure function from one tree to the next, which is what lets
 * the same code serve a click in Studio, a REST call and an agent's proposal — and
 * what lets a dry run compute a diff without touching anything (SPEC.md §73).
 *
 * An invalid tree is never produced: the nesting rules a block declares are checked
 * here, before anything is stored.
 */
import { randomUUID } from 'node:crypto'

import { AssemoraError, ValidationError } from '@assemora/core'
import {
  type BlockDesign,
  type BlockDesignPatch,
  type BlockNode,
  type BlockTree,
  blockDesign,
  findBlock,
  type Issue,
} from '@assemora/schema'

import { blockFor, validateProps } from './block.js'

export type Placement = {
  /** The block to nest under. Omitted means the top level. */
  readonly parentId?: string
  /** Where among the siblings. Appended when omitted. */
  readonly index?: number
}

// Annotated on the variable, not just on the arrow: that is what lets TypeScript
// narrow after a call to it.
const invalid: (message: string) => never = (message) => {
  throw new AssemoraError('INVALID_BLOCK_TREE', message, { status: 422 })
}

/** Refuses a placement the parent's own declaration forbids (SPEC.md §56). */
const checkPlacement = (
  tree: BlockTree,
  type: string,
  placement: Placement,
  moving?: string,
): void => {
  if (placement.parentId === undefined) return

  const parent = findBlock(tree, placement.parentId)

  if (parent === undefined) invalid(`There is no block "${placement.parentId}" to nest under`)

  const definition = blockFor(parent.type)

  if (!definition.acceptsChildren) {
    invalid(`The ${parent.type} block does not accept children`)
  }

  if (definition.allowedChildren.length > 0 && !definition.allowedChildren.includes(type)) {
    invalid(`The ${parent.type} block does not accept a ${type} inside it`)
  }

  const siblings = parent.children.filter((child: BlockNode) => child.id !== moving).length

  if (definition.maxChildren !== undefined && siblings >= definition.maxChildren) {
    invalid(`The ${parent.type} block holds at most ${definition.maxChildren} children`)
  }
}

const insert = (
  nodes: readonly BlockNode[],
  node: BlockNode,
  index: number | undefined,
): BlockNode[] => {
  const at = index === undefined ? nodes.length : Math.max(0, Math.min(index, nodes.length))

  return [...nodes.slice(0, at), node, ...nodes.slice(at)]
}

const mapNodes = (
  nodes: readonly BlockNode[],
  transform: (node: BlockNode) => BlockNode | undefined,
): BlockNode[] =>
  nodes.flatMap((node) => {
    const mapped = transform(node)

    if (mapped === undefined) return []

    return [{ ...mapped, children: mapNodes(mapped.children, transform) }]
  })

const withPlacement = (tree: BlockTree, node: BlockNode, placement: Placement): BlockTree => {
  if (placement.parentId === undefined) {
    return { blocks: insert(tree.blocks, node, placement.index) }
  }

  return {
    blocks: mapNodes(tree.blocks, (candidate) =>
      candidate.id === placement.parentId
        ? { ...candidate, children: insert(candidate.children, node, placement.index) }
        : candidate,
    ),
  }
}

const detach = (tree: BlockTree, id: string): BlockTree => ({
  blocks: mapNodes(tree.blocks, (node) => (node.id === id ? undefined : node)),
})

const contains = (node: BlockNode, id: string): boolean =>
  node.id === id || node.children.some((child: BlockNode) => contains(child, id))

export type AddBlock = Placement & {
  readonly type: string
  readonly props?: Readonly<Record<string, unknown>>
}

export const addBlock = (tree: BlockTree, request: AddBlock): { tree: BlockTree; id: string } => {
  const definition = blockFor(request.type)
  // A block is added before it is written. Publishing is what insists (SPEC.md §60).
  const props = validateProps(definition, request.props ?? {}, 'editing')

  if (!props.ok) throw new ValidationError(props.issues)

  checkPlacement(tree, request.type, request)

  const node: BlockNode = {
    id: randomUUID(),
    type: request.type,
    version: 1,
    props: props.value,
    children: [],
  }

  return { tree: withPlacement(tree, node, request), id: node.id }
}

export const updateBlockProps = (
  tree: BlockTree,
  id: string,
  props: Readonly<Record<string, unknown>>,
): BlockTree => {
  const existing = findBlock(tree, id) ?? invalid(`There is no block "${id}"`)
  const definition = blockFor(existing.type)
  const merged = validateProps(definition, { ...existing.props, ...props }, 'editing')

  if (!merged.ok) throw new ValidationError(merged.issues)

  return {
    blocks: mapNodes(tree.blocks, (node) =>
      node.id === id ? { ...node, props: merged.value, version: node.version + 1 } : node,
    ),
  }
}

/**
 * Sets the universal design controls of SPEC.md §61.
 *
 * They are merged, not replaced: a properties panel sends the one control that
 * changed, not the whole set. `null` for a control clears it, because "no spacing"
 * and "the theme decides" are different answers.
 */
export const setBlockDesign = (
  tree: BlockTree,
  id: string,
  design: BlockDesignPatch,
): BlockTree => {
  const existing = findBlock(tree, id) ?? invalid(`There is no block "${id}"`)
  const merged: Record<string, unknown> = { ...existing.design }

  for (const [key, value] of Object.entries(design)) {
    if (value === null || value === undefined) delete merged[key]
    else merged[key] = value
  }

  const checked = blockDesign().parse(merged)

  if (!checked.ok) throw new ValidationError(checked.issues)

  const settings = checked.value as BlockDesign

  return {
    blocks: mapNodes(tree.blocks, (node) =>
      node.id === id ? { ...node, design: settings, version: node.version + 1 } : node,
    ),
  }
}

export const setBlockHidden = (tree: BlockTree, id: string, hidden: boolean): BlockTree => {
  findBlock(tree, id) ?? invalid(`There is no block "${id}"`)

  return {
    blocks: mapNodes(tree.blocks, (node) => (node.id === id ? { ...node, hidden } : node)),
  }
}

export const removeBlock = (tree: BlockTree, id: string): BlockTree => {
  findBlock(tree, id) ?? invalid(`There is no block "${id}"`)

  return detach(tree, id)
}

export const moveBlock = (tree: BlockTree, id: string, placement: Placement): BlockTree => {
  const node = findBlock(tree, id) ?? invalid(`There is no block "${id}"`)

  if (placement.parentId !== undefined && contains(node, placement.parentId)) {
    invalid('A block cannot be moved inside itself')
  }

  checkPlacement(tree, node.type, placement, id)

  return withPlacement(detach(tree, id), node, placement)
}

/** A copy with new ids all the way down: an id is never shared (SPEC.md §54). */
const reidentify = (node: BlockNode): BlockNode => ({
  ...node,
  id: randomUUID(),
  children: node.children.map(reidentify),
})

export const duplicateBlock = (tree: BlockTree, id: string): { tree: BlockTree; id: string } => {
  const node = findBlock(tree, id) ?? invalid(`There is no block "${id}"`)
  const copy = reidentify(node)
  const parentId = parentOf(tree, id)

  // A copy lands beside its original, under the same parent.
  const placement: Placement = parentId === null ? {} : { parentId }

  return { tree: withPlacement(tree, copy, placement), id: copy.id }
}

/**
 * Every block that is not yet fit to be seen (SPEC.md §55, §60).
 *
 * A draft may hold an unfinished block; a published page may not. This is what
 * publishing checks, and it names the block so an editor can go and fix it.
 */
export const unfinishedBlocks = (tree: BlockTree): Issue[] => {
  const issues: Issue[] = []

  const visit = (nodes: readonly BlockNode[]): void => {
    for (const node of nodes) {
      // A hidden block is not rendered, so it is not asked to be complete.
      if (node.hidden !== true) {
        const checked = validateProps(blockFor(node.type), node.props, 'complete')

        if (!checked.ok) {
          issues.push(
            ...checked.issues.map((issue) => ({
              ...issue,
              path: [node.type, ...issue.path],
            })),
          )
        }
      }

      visit(node.children)
    }
  }

  visit(tree.blocks)

  return issues
}

/** The id of the block that holds this one, or `null` at the top level. */
export const parentOf = (tree: BlockTree, id: string): string | null => {
  const search = (
    nodes: readonly BlockNode[],
    parent: string | null,
  ): string | null | undefined => {
    for (const node of nodes) {
      if (node.id === id) return parent

      const found = search(node.children, node.id)

      if (found !== undefined) return found
    }

    return undefined
  }

  return search(tree.blocks, null) ?? null
}
