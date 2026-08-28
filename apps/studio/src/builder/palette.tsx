/**
 * What can be added, and what is already there (SPEC.md §59).
 *
 * The list of blocks is not written here. It is whatever the application declared,
 * read from the Schema Registry — so a `block()` added to an application appears in
 * this panel with no Studio change at all.
 */
import type { BlockNode, BlockTree } from '@assemora/schema'

import type { BlockDescriptor, Introspection } from '../api/introspection.ts'
import { NoBlocks } from '../ui/blank.tsx'
import { Badge, Button } from '../ui/index.tsx'

const Outline = ({
  nodes,
  depth,
  selected,
  busy,
  nameOf,
  onSelect,
  onMove,
}: {
  nodes: readonly BlockNode[]
  depth: number
  selected: string | null
  busy: boolean
  nameOf(type: string): string
  onSelect(id: string): void
  onMove(id: string, direction: -1 | 1): void
}) => (
  <>
    {nodes.map((node, index) => (
      <div key={node.id}>
        <div
          className={[
            'group flex items-center gap-1 rounded-md pr-1 transition',
            node.id === selected ? 'bg-accent-soft' : 'hover:bg-surface-sunken',
          ].join(' ')}
        >
          <button
            type="button"
            className={[
              'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm',
              node.id === selected ? 'font-medium text-accent' : 'text-ink-soft',
            ].join(' ')}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            onClick={() => onSelect(node.id)}
          >
            {/* The name the application gave the block, not its machine name — the
                palette three inches above says "Hero", so this cannot say "hero". */}
            <span className="truncate">{nameOf(node.type)}</span>
            {node.hidden === true && <span className="text-xs text-ink-faint">hidden</span>}
          </button>

          {/* Reordering is one command, so it is one click (SPEC.md §60, §123).
              These used to be `opacity-0` until the row was hovered, which meant the
              control slid out from under the pointer that had just used it, keyboard
              focus landed on something invisible, and nothing on screen said the
              outline could be reordered at all. They are always here now: full
              strength on the row being worked on, faint elsewhere. Faint rather than
              hidden is also what makes this robust — the hover and focus variants
              below are an improvement on a control that can already be seen and
              pressed, not the only thing that reveals it. */}
          <span
            className={[
              'flex transition group-hover:opacity-100 group-focus-within:opacity-100',
              node.id === selected ? 'opacity-100' : 'opacity-50',
            ].join(' ')}
          >
            <button
              type="button"
              aria-label={`Move ${nameOf(node.type)} up`}
              title="Move up"
              className="px-1 text-xs text-ink-faint hover:text-ink disabled:opacity-30"
              disabled={busy || index === 0}
              onClick={() => onMove(node.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${nameOf(node.type)} down`}
              title="Move down"
              className="px-1 text-xs text-ink-faint hover:text-ink disabled:opacity-30"
              disabled={busy || index === nodes.length - 1}
              onClick={() => onMove(node.id, 1)}
            >
              ↓
            </button>
          </span>
        </div>

        {node.children.length > 0 && (
          <Outline
            nodes={node.children}
            depth={depth + 1}
            selected={selected}
            busy={busy}
            nameOf={nameOf}
            onSelect={onSelect}
            onMove={onMove}
          />
        )}
      </div>
    ))}
  </>
)

export const Palette = ({
  introspection,
  tree,
  selected,
  busy,
  nameOf,
  fitsInSelection,
  onAdd,
  onSelect,
  onMove,
}: {
  introspection: Introspection | undefined
  tree: BlockTree
  selected: string | null
  busy: boolean
  nameOf(type: string): string
  /** Whether the selected block could hold one of these right now (SPEC.md §56). */
  fitsInSelection(type: string): boolean
  onAdd(block: BlockDescriptor, into: string | null): void
  onSelect(id: string): void
  onMove(id: string, direction: -1 | 1): void
}) => {
  const blocks = introspection?.blocks ?? []

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3 py-4">
      <section className="space-y-1.5">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Blocks</p>

        {blocks.length === 0 && <NoBlocks />}

        {blocks.map((block) => {
          // A block goes inside the selection when the selection can still hold it,
          // and beside it otherwise — the nesting rules are the application's, and
          // that includes how many children a container will take (SPEC.md §56).
          const into = selected !== null && fitsInSelection(block.name) ? selected : null

          return (
            <Button
              key={block.name}
              variant="secondary"
              size="sm"
              className="w-full justify-between"
              disabled={busy}
              onClick={() => onAdd(block, into)}
              title={block.description}
            >
              <span className="truncate">{block.label}</span>
              {into !== null && <Badge tone="accent">inside</Badge>}
            </Button>
          )
        })}
      </section>

      {/* Nothing declared means nothing can be on the page either, and an outline of
          an empty page under an empty palette is the second half of one fact. The
          panel above has already said it, and said what to do about it. */}
      {blocks.length > 0 && (
        <section className="space-y-1.5">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            This page
          </p>

          {tree.blocks.length === 0 ? (
            <p className="px-1 text-sm text-ink-faint">
              No blocks yet. Choose one above, or use a + on the page.
            </p>
          ) : (
            <Outline
              nodes={tree.blocks}
              depth={0}
              selected={selected}
              busy={busy}
              nameOf={nameOf}
              onSelect={onSelect}
              onMove={onMove}
            />
          )}
        </section>
      )}
    </aside>
  )
}
