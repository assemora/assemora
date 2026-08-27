/**
 * What the builder knows, and how it changes it (SPEC.md §60).
 *
 * Every operation is a command. There is no local tree editing: Studio sends the
 * intent, the application validates the nesting rules, writes the revision and
 * answers with the tree it produced. That is what makes "if Studio can do it, an
 * agent can do it" true rather than aspirational (SPEC.md §2, §58).
 */
import type { BlockNode, BlockTree } from '@assemora/schema'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import type { PageDetail, TreeResult } from '../api/pages.ts'

export type BuilderState = {
  readonly tree: BlockTree
  readonly version: number
  readonly selected: string | null
  readonly busy: boolean
  readonly conflict: boolean
  readonly failure: string | undefined
  /**
   * Something worth saying that is not a failure.
   *
   * Redo with nothing left to redo is the application answering the question, not
   * refusing the request — a red bar the width of the screen says the wrong thing
   * about it.
   */
  readonly notice: string | undefined
  /** Field errors, when the application had something specific to say. */
  readonly fields: Readonly<Record<string, readonly string[]>>
  readonly hasUnpublishedChanges: boolean
}

/** Where a block goes: which parent, and where among its children. */
export type Placement = {
  readonly parentId?: string
  readonly index?: number
}

/** One block out of the tree, by id. */
export const nodeIn = (tree: BlockTree, id: string | null): BlockNode | undefined => {
  if (id === null) return undefined

  const visit = (nodes: readonly BlockNode[]): BlockNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node

      const found = visit(node.children)

      if (found !== undefined) return found
    }

    return undefined
  }

  return visit(tree.blocks)
}

/** The id of the block that holds this one, or null at the top level. */
export const parentOf = (tree: BlockTree, id: string): string | null => {
  const visit = (nodes: readonly BlockNode[], parent: string | null): string | null | undefined => {
    for (const node of nodes) {
      if (node.id === id) return parent

      const found = visit(node.children, node.id)

      if (found !== undefined) return found
    }

    return undefined
  }

  return visit(tree.blocks, null) ?? null
}

/** The blocks that share a parent with this one, in order. */
export const siblingsOf = (tree: BlockTree, id: string): readonly BlockNode[] => {
  const parent = parentOf(tree, id)

  if (parent === null) return tree.blocks

  const visit = (nodes: readonly BlockNode[]): readonly BlockNode[] | undefined => {
    for (const node of nodes) {
      if (node.id === parent) return node.children

      const found = visit(node.children)

      if (found !== undefined) return found
    }

    return undefined
  }

  return visit(tree.blocks) ?? []
}

/** The block just before this one under the same parent, if there is one. */
export const blockAbove = (tree: BlockTree, id: string): BlockNode | undefined => {
  const siblings = siblingsOf(tree, id)
  const at = siblings.findIndex((node) => node.id === id)

  return at > 0 ? siblings[at - 1] : undefined
}

/**
 * Where a block would land if it moved by one place among its siblings.
 *
 * `blocks.move` takes a placement, not a direction, and omitting the parent means the
 * top level rather than "wherever it is now" — so the caller states both.
 */
export const stepFrom = (
  tree: BlockTree,
  id: string,
  direction: -1 | 1,
): { parentId?: string; index: number } | undefined => {
  const siblings = siblingsOf(tree, id)
  const at = siblings.findIndex((node) => node.id === id)
  const to = at + direction

  if (at === -1 || to < 0 || to >= siblings.length) return undefined

  const parent = parentOf(tree, id)

  return { ...(parent === null ? {} : { parentId: parent }), index: to }
}

/**
 * Where a new block should land, given what is selected.
 *
 * Beside the selection rather than at the bottom: somebody who selected the third of
 * twenty-one blocks and then clicked Hero meant "here". `blocks.add` has always taken
 * an index; nothing ever sent one, so every block that arrived arrived at the end and
 * the only way back up was nineteen presses of an arrow, each its own revision.
 *
 * When the selection's own parent will not hold the type, the block lands after
 * whichever ancestor a parent *will* hold. Walking out is the only answer that is both
 * legal and near where the person clicked — the nesting rules are the application's,
 * and Studio only reads them (SPEC.md §56). With nothing selected there is no "here",
 * so it appends.
 */
export const placeBeside = (
  tree: BlockTree,
  selected: string | null,
  holds: (container: BlockNode | null) => boolean,
): Placement => {
  let child = selected

  while (child !== null) {
    const parentId = parentOf(tree, child)
    const parent = parentId === null ? null : nodeIn(tree, parentId)

    // A parent named by the tree that is not in the tree is not a question to ask.
    if (parent === undefined) return {}

    if (holds(parent)) {
      const siblings = siblingsOf(tree, child)
      const at = siblings.findIndex((node) => node.id === child)

      // A block nobody can find has no neighbours to land beside.
      if (at === -1) return {}

      return { ...(parentId === null ? {} : { parentId }), index: at + 1 }
    }

    child = parentId
  }

  return {}
}

/**
 * Which of the moves the Properties panel offers are open to the selection.
 *
 * One rule, asked three times, so the panel cannot offer what the application will
 * refuse. `holds` is the application's own nesting rule as the registry states it —
 * Studio only reads it (SPEC.md §56).
 *
 * Duplicate is here because it was the one that got away. `blocks.duplicate` checks
 * the placement like everything else, so duplicating the last child a container would
 * take answered with a 422 and a full-width red banner, while the palette badge and
 * the canvas `+` had already learned to say no quietly.
 */
export const allowedMoves = (
  tree: BlockTree,
  node: BlockNode | undefined,
  holds: (container: BlockNode | null, type: string) => boolean,
): { readonly indent: boolean; readonly outdent: boolean; readonly duplicate: boolean } => {
  if (node === undefined) return { indent: false, outdent: false, duplicate: false }

  const above = blockAbove(tree, node.id)
  const parentId = parentOf(tree, node.id)

  return {
    indent: above !== undefined && holds(above, node.type),
    outdent: parentId !== null,
    // A copy lands beside its original, so the container that has to have room for it
    // is the one the original is already in — and it counts one more child, not the
    // same one moved.
    duplicate: holds(nodeIn(tree, parentId) ?? null, node.type),
  }
}

/**
 * Where a block goes when it is lifted out of its container.
 *
 * Directly after the container, rather than at the bottom of the level above: the
 * block was inside that thing a moment ago, and that is where a person looks for it.
 */
export const liftOut = (tree: BlockTree, id: string): Placement | undefined => {
  const parentId = parentOf(tree, id)

  if (parentId === null) return undefined

  const grandparent = parentOf(tree, parentId)
  const siblings = siblingsOf(tree, parentId)
  const at = siblings.findIndex((node) => node.id === parentId)

  return {
    ...(grandparent === null ? {} : { parentId: grandparent }),
    index: at + 1,
  }
}

/**
 * Writes what a command answered into the cache the builder is mounted on.
 *
 * Evicting the key instead is correct and catastrophic: React Query has no data for
 * it, the screen falls back to its spinner, and all three panes — the canvas iframe
 * with them — unmount and load again from the network. Every keystroke pause did
 * that: a white flash, a lost canvas scroll and the Design tab snapping back to
 * Content, 400 ms after somebody stopped typing.
 *
 * Every tree command answers with the tree it produced, which is why they were written
 * that way (SPEC.md §60). So the cache is told rather than asked.
 */
export const rememberPage = (
  client: QueryClient,
  page: PageDetail,
  answer: {
    readonly tree?: BlockTree | undefined
    readonly version?: number | undefined
    readonly hasUnpublishedChanges: boolean
  },
): void => {
  client.setQueryData<PageDetail>(['page', page.id, page.mode], (cached) =>
    cached === undefined
      ? undefined
      : {
          ...cached,
          ...(answer.tree === undefined ? {} : { tree: answer.tree }),
          ...(answer.version === undefined ? {} : { version: answer.version }),
          hasUnpublishedChanges: answer.hasUnpublishedChanges,
        },
  )
}

/** Commands that leave the page published as it stands. */
const PUBLISHING = new Set(['pages.publish'])

export const useBuilder = (page: PageDetail | undefined) => {
  const client = useQueryClient()
  const [tree, setTree] = useState<BlockTree>({ blocks: [] })
  const [version, setVersion] = useState(0)
  const [published, setPublished] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [fields, setFields] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [conflict, setConflict] = useState(false)

  /**
   * The version to state next, kept outside React state.
   *
   * Two commands can be in flight within one render — a keystroke and the click that
   * follows it — and the second must carry the version the first produced. Reading it
   * out of a render closure would send the older one and turn an ordinary edit into a
   * conflict (SPEC.md §66).
   */
  const current = useRef(0)

  /** Commands are sent one at a time, in the order they were asked for. */
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (page === undefined) return

    setTree(page.tree)
    setVersion(page.version)
    current.current = page.version
    setPublished(!page.hasUnpublishedChanges)
  }, [page])

  const send = useCallback(
    async (command: string, input: Record<string, unknown>): Promise<TreeResult | undefined> => {
      if (page === undefined) return undefined

      setBusy(true)

      try {
        const result = await api.command<TreeResult>(command, {
          id: page.id,
          expectedVersion: current.current,
          ...input,
        })

        if (result.tree !== undefined) setTree(result.tree)

        if (typeof result.version === 'number') {
          current.current = result.version
          setVersion(result.version)
        }

        setFailure(undefined)
        setNotice(undefined)
        setFields({})
        setConflict(false)
        setPublished(PUBLISHING.has(command))

        await client.invalidateQueries({ queryKey: ['pages'] })
        await client.invalidateQueries({ queryKey: ['revisions', 'pages', page.id] })
        // The page detail is what a return to this screen reads, and what this screen
        // is mounted on. It is told what the command produced, never evicted.
        rememberPage(client, page, {
          tree: result.tree,
          version: result.version,
          hasUnpublishedChanges: !PUBLISHING.has(command),
        })

        return result
      } catch (error) {
        if (error instanceof ApiError) {
          setConflict(error.status === 409)
          setFields(error.fields)
        }

        setFailure(error instanceof Error ? error.message : 'That did not work')

        return undefined
      } finally {
        setBusy(false)
      }
    },
    [client, page],
  )

  const run = useCallback(
    (command: string, input: Record<string, unknown> = {}): Promise<TreeResult | undefined> => {
      const next = queue.current.then(() => send(command, input))

      // The queue must survive a failure, or one refused command stops every later one.
      queue.current = next.catch(() => undefined)

      return next
    },
    [send],
  )

  /** Undo and redo do not carry a version: they *are* the answer to what changed. */
  const rewind = useCallback(
    (direction: 'undo' | 'redo') => {
      const work = async () => {
        if (page === undefined) return

        setBusy(true)

        try {
          const result = await api.command<{ version?: number; tree?: BlockTree }>(
            `revisions.${direction}`,
            { entityType: 'pages', entityId: page.id },
          )

          if (result.tree !== undefined) setTree(result.tree)

          if (typeof result.version === 'number') {
            current.current = result.version
            setVersion(result.version)
          }

          setFailure(undefined)
          setNotice(undefined)
          setFields({})
          setConflict(false)
          setPublished(false)

          await client.invalidateQueries({ queryKey: ['revisions', 'pages', page.id] })
          rememberPage(client, page, {
            tree: result.tree,
            version: result.version,
            hasUnpublishedChanges: true,
          })
        } catch (error) {
          // Reaching the end of the history is an answer, not a refusal: the person
          // asked whether there was anything left and there was not.
          if (error instanceof ApiError && error.code === 'NOTHING_TO_UNDO') {
            setNotice(`There is nothing left to ${direction}`)

            return
          }

          setFailure(`Could not ${direction}`)
        } finally {
          setBusy(false)
        }
      }

      const next = queue.current.then(work)

      queue.current = next.catch(() => undefined)

      return next
    },
    [client, page],
  )

  const state: BuilderState = {
    tree,
    version,
    selected,
    busy,
    conflict,
    failure,
    notice,
    fields,
    hasUnpublishedChanges: !published,
  }

  return {
    state,
    node: nodeIn(tree, selected),
    select: setSelected,
    run,
    rewind,
    dismiss: () => {
      setFailure(undefined)
      setNotice(undefined)
      setFields({})
      setConflict(false)
    },
  }
}
