/**
 * What can be added, and what is already there (SPEC.md §59).
 *
 * The list of blocks is not written here. It is whatever the application declared,
 * read from the Schema Registry — so a `block()` added to an application appears in
 * this panel with no Studio change at all.
 */
import type { BlockNode, BlockTree } from '@assemora/schema'

import { accepts, type BlockDescriptor, type Introspection } from '../api/introspection.ts'
import { Badge, Button, Empty } from '../ui/index.tsx'

const Outline = ({
  nodes,
  depth,
  selected,
  busy,
  onSelect,
  onMove,
}: {
  nodes: readonly BlockNode[]
  depth: number
  selected: string | null
  busy: boolean
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
            <span className="truncate">{node.type}</span>
            {node.hidden === true && <span className="text-xs text-ink-faint">hidden</span>}
          </button>

          {/* Reordering is one command, so it is one click (SPEC.md §60, §123). */}
          <span className="flex opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              aria-label="Move up"
              title="Move up"
              className="px-1 text-xs text-ink-faint hover:text-ink disabled:opacity-30"
              disabled={busy || index === 0}
              onClick={() => onMove(node.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move down"
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
  selectedType,
  busy,
  onAdd,
  onSelect,
  onMove,
}: {
  introspection: Introspection | undefined
  tree: BlockTree
  selected: string | null
  selectedType: string | undefined
  busy: boolean
  onAdd(block: BlockDescriptor, into: string | null): void
  onSelect(id: string): void
  onMove(id: string, direction: -1 | 1): void
}) => {
  const blocks = introspection?.blocks ?? []
  const parent = introspection?.blocks?.find((entry) => entry.name === selectedType)

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3 py-4">
      <section className="space-y-1.5">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Blocks</p>

        {blocks.length === 0 && <Empty title="No blocks declared" />}

        {blocks.map((block) => {
          // A block goes inside the selection when the selection can hold it, and at
          // the top level otherwise — the nesting rules are the application's
          // (SPEC.md §56).
          const into = parent !== undefined && accepts(parent, block.name) ? selected : null

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

      <section className="space-y-1.5">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          This page
        </p>

        {tree.blocks.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">Nothing yet.</p>
        ) : (
          <Outline
            nodes={tree.blocks}
            depth={0}
            selected={selected}
            busy={busy}
            onSelect={onSelect}
            onMove={onMove}
          />
        )}
      </section>
    </aside>
  )
}
