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
import { type CSSProperties, Fragment, type ReactElement, type ReactNode } from 'react'

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
   * no layout, so what the canvas shows is what a visitor will see. It becomes a real
   * box only for a block that needs editor chrome hung on it — see `chromeFor`.
   */
  readonly editing?: boolean
  /** Turns a media id into a URL, for the `backgroundImage` design control. */
  readonly mediaUrl?: (id: string) => string
}

/** The attributes Studio's canvas looks for. Part of the contract, so they are exported. */
export const BLOCK_ATTRIBUTE = 'data-assemora-block'
export const TYPE_ATTRIBUTE = 'data-assemora-type'
export const HIDDEN_ATTRIBUTE = 'data-assemora-hidden'
export const EMPTY_ATTRIBUTE = 'data-assemora-empty'

const CONTENTS: CSSProperties = { display: 'contents' }

/**
 * A marker with something to draw on it.
 *
 * `display: contents` generates no box, and a box is what every piece of editor
 * chrome needs: the theme's `[data-assemora-hidden] { opacity: 0.4 }` was landing on
 * a wrapper that could not be faded, so clicking Hide changed nothing a person could
 * see, and an absolutely-positioned label has nothing to be positioned against. The
 * marker therefore becomes a box exactly when there is chrome — for a hidden block
 * and for one nobody has filled in — and stays out of the layout for every other.
 */
const MARKED: CSSProperties = { position: 'relative' }

/**
 * And the same box, outlined, for a block nobody has written yet.
 *
 * The label says what it is; the outline says how much of the page it is. Without it
 * a block that draws no background of its own — an empty FAQ, an empty section — is
 * still the blank space it was, with a caption on top.
 */
const UNWRITTEN: CSSProperties = {
  ...MARKED,
  outline: '1px dashed #94a3b8',
  outlineOffset: '-1px',
}

/**
 * The label on a block with nothing in it, styled here rather than in the theme.
 *
 * Editor chrome carries text, and text cannot come out of a stylesheet — so this
 * element is the renderer's to build whatever else happens. Once it is, its handful
 * of declarations belong beside it, and they are then the same in an application
 * that serves no Assemora stylesheet at all. What the theme still owns is the look of
 * boxes that already exist, which is why the fade on a hidden block stays there.
 */
const LABEL: CSSProperties = {
  position: 'absolute',
  top: 0,
  // The right-hand corner, because the left one is taken. Studio anchors its own
  // selection and hover chips to a block's top-left, over the frame, and those name
  // the *selection* — a chip on an outline belongs where the outline starts. This one
  // is a caption on the block's own content and has a free corner to go to, so it is
  // the one that moves: a selected empty Hero was reading `Hero` and `hero — empty`
  // on top of each other.
  right: 0,
  padding: '0.2rem 0.4rem',
  background: '#475569',
  color: '#f8fafc',
  font: '500 11px/1.2 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderRadius: '0 0 0 3px',
  // The label is a caption, never a target: a click on it still selects the block
  // underneath, and a drag across it never selects its text.
  pointerEvents: 'none',
}

/**
 * A block whose type this registry cannot draw still needs somewhere to be clicked.
 *
 * Its children go inside it: the parent's view is what is missing, not theirs, and
 * leaving them out would make every block under an unknown one unreachable too.
 */
const NOTHING: CSSProperties = { minHeight: '4rem' }

const styleFor = (labelled: boolean, hidden: boolean): CSSProperties => {
  if (labelled) return UNWRITTEN

  return hidden ? MARKED : CONTENTS
}

const treeOf = (page: RenderablePage | BlockTree): BlockTree => ('tree' in page ? page.tree : page)

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/**
 * Whether a person would see anything of this block on the page yet.
 *
 * A guess, and it has to be: the block's declaration lives on the server, in
 * `@assemora/pages`, and reading it here would drag the server layer into every
 * browser bundle (ADR-0016). So the test is the values themselves — nothing filled
 * in, and nothing nested inside. What that costs is a block which declares no fields
 * at all, a divider or a spacer: it is indistinguishable from one nobody has written
 * yet, and gets labelled too. The label sits in a corner and the block still draws,
 * so the cost is a word in the canvas, never a hole in it.
 */
const isUnwritten = (node: BlockNode): boolean =>
  node.children.length === 0 && Object.values(node.props).every(isEmptyValue)

/** What the canvas calls a block with nothing to look at, or nothing when there is. */
const labelFor = (node: BlockNode, blocks: BlockRegistry, drew: boolean): string | undefined => {
  // Nothing was drawn at all, so there is not even a box to click: the label and the
  // space it sits in are the only reason the block is reachable.
  if (!drew) return `${node.type} — no view`

  // A registry with a fallback draws its own explanation for a type it does not know,
  // and that explanation is already a box with words in it.
  if (!blocks.has(node.type)) return undefined

  return isUnwritten(node) ? `${node.type} — empty` : undefined
}

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

  // A visitor should never be shown a gap where a block used to be. An editor has the
  // opposite problem: a block that draws nothing is a block that cannot be clicked,
  // and one that cannot be clicked cannot be removed either — so the canvas draws the
  // empty space and says what it is.
  if (View === undefined && !editing) return null

  const children = node.children.map((child) => renderNode(child, blocks, editing, mediaUrl))

  const view =
    View === undefined ? null : (
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

  const hidden = node.hidden === true
  const label = labelFor(node, blocks, View !== undefined)

  return (
    <div
      key={node.id}
      style={styleFor(label !== undefined, hidden)}
      {...{ [BLOCK_ATTRIBUTE]: node.id, [TYPE_ATTRIBUTE]: node.type }}
      {...(hidden ? { [HIDDEN_ATTRIBUTE]: 'true' } : {})}
      {...(label === undefined ? {} : { [EMPTY_ATTRIBUTE]: 'true' })}
    >
      {View === undefined ? <div style={NOTHING}>{children}</div> : drawn}
      {label !== undefined && <span style={LABEL}>{label}</span>}
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
