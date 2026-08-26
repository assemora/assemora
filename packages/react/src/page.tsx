/**
 * Drawing a page (SPEC.md §57).
 *
 * ```tsx
 * <AssemoraPage page={page} blocks={registry} />
 * ```
 *
 * This is the renderer a site ships, and it is also the one Studio's canvas loads
 * inside its iframe: the preview is accurate because it is not a second
 * implementation (SPEC.md §59).
 */
import { type BlockNode, type BlockTree, isPlainDesign } from '@assemora/schema'
import { Fragment, type ReactElement, type ReactNode } from 'react'

import { DesignWrapper } from './design.js'
import type { BlockRegistry } from './registry.js'

/** What the page endpoint hands back: one tree, already chosen as draft or published. */
export type RenderablePage = {
  readonly tree: BlockTree
}

export type AssemoraPageProps = {
  readonly page: RenderablePage | BlockTree
  readonly blocks: BlockRegistry
  /**
   * Marks every block in the DOM so an editor can find it (SPEC.md §59).
   *
   * The marker is a `display: contents` wrapper, which occupies no space and changes
   * no layout, so what the canvas shows is what a visitor will see.
   */
  readonly editing?: boolean
  /** Turns a media id into a URL, for the `backgroundImage` design control. */
  readonly mediaUrl?: (id: string) => string
}

/** The attributes Studio's canvas looks for. Part of the contract, so they are exported. */
export const BLOCK_ATTRIBUTE = 'data-assemora-block'
export const TYPE_ATTRIBUTE = 'data-assemora-type'
export const HIDDEN_ATTRIBUTE = 'data-assemora-hidden'

const treeOf = (page: RenderablePage | BlockTree): BlockTree => ('tree' in page ? page.tree : page)

const renderNode = (
  node: BlockNode,
  blocks: BlockRegistry,
  editing: boolean,
  mediaUrl: ((id: string) => string) | undefined,
): ReactElement | null => {
  // A hidden block stays in the tree and out of the page (SPEC.md §60). The editor
  // draws it anyway, faded, or there would be no way to bring it back.
  if (node.hidden === true && !editing) return null

  const View = blocks.viewFor(node.type)

  if (View === undefined) return null

  const children = node.children.map((child) => renderNode(child, blocks, editing, mediaUrl))

  const view = (
    <View block={node} props={node.props}>
      {children.length === 0 ? null : children}
    </View>
  )

  // The universal controls wrap the block; the block itself never sees them, which
  // is what keeps them universal (SPEC.md §61).
  const drawn = isPlainDesign(node.design) ? (
    view
  ) : (
    <DesignWrapper design={node.design ?? {}} {...(mediaUrl === undefined ? {} : { mediaUrl })}>
      {view}
    </DesignWrapper>
  )

  if (!editing) return <Fragment key={node.id}>{drawn}</Fragment>

  return (
    <div
      key={node.id}
      style={{ display: 'contents' }}
      {...{ [BLOCK_ATTRIBUTE]: node.id, [TYPE_ATTRIBUTE]: node.type }}
      {...(node.hidden === true ? { [HIDDEN_ATTRIBUTE]: 'true' } : {})}
    >
      {drawn}
    </div>
  )
}

export const AssemoraPage = ({
  page,
  blocks,
  editing = false,
  mediaUrl,
}: AssemoraPageProps): ReactNode => (
  <>{treeOf(page).blocks.map((node) => renderNode(node, blocks, editing, mediaUrl))}</>
)
