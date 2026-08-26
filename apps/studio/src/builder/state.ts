/**
 * What the builder knows, and how it changes it (SPEC.md §60).
 *
 * Every operation is a command. There is no local tree editing: Studio sends the
 * intent, the application validates the nesting rules, writes the revision and
 * answers with the tree it produced. That is what makes "if Studio can do it, an
 * agent can do it" true rather than aspirational (SPEC.md §2, §58).
 */
import type { BlockNode, BlockTree } from '@assemora/schema'
import { useQueryClient } from '@tanstack/react-query'
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
  /** Field errors, when the application had something specific to say. */
  readonly fields: Readonly<Record<string, readonly string[]>>
  readonly hasUnpublishedChanges: boolean
}

const findNode = (tree: BlockTree, id: string | null): BlockNode | undefined => {
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
        setFields({})
        setConflict(false)
        setPublished(PUBLISHING.has(command))

        await client.invalidateQueries({ queryKey: ['pages'] })
        await client.invalidateQueries({ queryKey: ['revisions', 'pages', page.id] })
        // The page detail is what a return to this screen reads. Left alone it would
        // hand back the tree and version this page had when it was opened.
        client.removeQueries({ queryKey: ['page', page.id] })

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
          setFields({})
          setConflict(false)
          setPublished(false)

          await client.invalidateQueries({ queryKey: ['revisions', 'pages', page.id] })
          client.removeQueries({ queryKey: ['page', page.id] })
        } catch (error) {
          setFailure(
            error instanceof ApiError && error.code === 'NOTHING_TO_UNDO'
              ? `There is nothing to ${direction}`
              : `Could not ${direction}`,
          )
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
    fields,
    hasUnpublishedChanges: !published,
  }

  return {
    state,
    node: findNode(tree, selected),
    select: setSelected,
    run,
    rewind,
    dismiss: () => {
      setFailure(undefined)
      setFields({})
      setConflict(false)
    },
  }
}
