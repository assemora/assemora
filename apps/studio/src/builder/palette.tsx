/**
 * What can be added, and what is already there (SPEC.md §59).
 *
 * The list of blocks is not written here. It is whatever the application declared,
 * read from the Schema Registry — so a `block()` added to an application appears in
 * this panel with no Studio change at all.
 */
import type { BlockNode, BlockTree } from '@assemora/schema'
import { ChevronDown, ChevronUp, Eye, Layers, Plus, Square } from 'lucide-react'
import { useState } from 'react'

import type { BlockDescriptor, Introspection } from '../api/introspection.ts'
import { NoBlocks } from '../ui/blank.tsx'
import { join } from '../ui/index.tsx'

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
          className={join(
            'group flex h-8 items-center gap-1 rounded-lg pr-1',
            node.id === selected ? 'bg-canvas' : 'hover:bg-surface-sunken',
          )}
        >
          <button
            type="button"
            className={join(
              'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-base',
              node.id === selected ? 'font-[650] text-ink' : 'text-ink-body',
            )}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            onClick={() => onSelect(node.id)}
          >
            <Square aria-hidden className="size-3.5 shrink-0 text-ink-subdued" />
            {/* The name the application gave the block, not its machine name — the
                palette one tab across says "Hero", so this cannot say "hero". */}
            <span className="truncate">{nameOf(node.type)}</span>
            {node.hidden === true && (
              <Eye aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
            )}
            {node.children.length > 0 && (
              <span className="ml-auto shrink-0 pr-1 font-mono text-xs text-ink-faint tabular-nums">
                {node.children.length}
              </span>
            )}
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
            className={join(
              'flex shrink-0 group-hover:opacity-100 group-focus-within:opacity-100',
              node.id === selected ? 'opacity-100' : 'opacity-50',
            )}
          >
            <button
              type="button"
              aria-label={`Move ${nameOf(node.type)} up`}
              title="Move up"
              className="grid size-6 place-items-center rounded-md text-ink-faint hover:bg-canvas hover:text-ink disabled:opacity-30"
              disabled={busy || index === 0}
              onClick={() => onMove(node.id, -1)}
            >
              <ChevronUp aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${nameOf(node.type)} down`}
              title="Move down"
              className="grid size-6 place-items-center rounded-md text-ink-faint hover:bg-canvas hover:text-ink disabled:opacity-30"
              disabled={busy || index === nodes.length - 1}
              onClick={() => onMove(node.id, 1)}
            >
              <ChevronDown aria-hidden className="size-3.5" />
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
  const [tab, setTab] = useState<'outline' | 'blocks'>('outline')

  return (
    <aside className="flex w-70 shrink-0 flex-col overflow-hidden border-r border-line bg-surface">
      <div
        role="tablist"
        aria-label="Rail"
        className="flex shrink-0 gap-6 border-b border-line px-4"
      >
        {(['outline', 'blocks'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={join(
              'h-11 border-b-2 px-0.5 text-base capitalize',
              tab === name
                ? 'border-ink text-ink font-[650]'
                : 'border-transparent text-ink-soft font-[550] hover:text-ink',
            )}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {tab === 'blocks' &&
          (blocks.length === 0 ? (
            <NoBlocks />
          ) : (
            blocks.map((block) => {
              // A block goes inside the selection when the selection can still hold it,
              // and beside it otherwise — the nesting rules are the application's, and
              // that includes how many children a container will take (SPEC.md §56).
              const into = selected !== null && fitsInSelection(block.name) ? selected : null

              return (
                <button
                  key={block.name}
                  type="button"
                  disabled={busy}
                  onClick={() => onAdd(block, into)}
                  className="flex w-full items-start gap-2.5 rounded-[10px] border border-line bg-surface p-2.5 text-left hover:border-line-strong hover:bg-surface-sunken disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-canvas text-ink-soft"
                  >
                    <Plus className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-base font-[650]">{block.label}</span>
                      {/* Where it will land relative to the selection — the one thing a
                          person cannot see before pressing it. */}
                      <span className="ml-auto shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-soft">
                        {into === null ? 'beside' : 'inside'}
                      </span>
                    </span>
                    {block.description !== undefined && (
                      <span className="mt-0.5 block text-sm text-ink-subdued">
                        {block.description}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          ))}

        {tab === 'outline' &&
          /* Nothing declared means nothing can be on the page either, and an outline of
             an empty page under an empty palette is the second half of one fact. */
          (blocks.length === 0 ? (
            <NoBlocks />
          ) : tree.blocks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Layers aria-hidden className="size-5 text-ink-subdued" />
              <p className="text-base font-[650]">This page is empty</p>
              <p className="text-sm text-ink-soft">
                Open Blocks and choose one, or use a + on the page.
              </p>
            </div>
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
          ))}
      </div>
    </aside>
  )
}
