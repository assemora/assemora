/**
 * What a selected block says about itself (SPEC.md §59, §61).
 *
 * The Content tab is the block's own fields — the same declaration that generates a
 * resource form, so the same inputs draw it. The Design tab is the seven universal
 * controls, which every block has and no block declares.
 */
import type { BlockNode } from '@assemora/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { BlockDescriptor } from '../api/introspection.ts'
import { FieldInput } from '../screens/fields.tsx'
import { Badge, Button, Empty } from '../ui/index.tsx'
import { DesignControls } from './design.tsx'

/** The colour tokens this application's theme offers. */
const BACKGROUNDS = ['surface', 'surface-sunken', 'brand'] as const

export const Properties = ({
  node,
  block,
  busy,
  nesting,
  onProps,
  onDesign,
  onHide,
  onDuplicate,
  onRemove,
  onIndent,
  onOutdent,
}: {
  node: BlockNode | undefined
  block: BlockDescriptor | undefined
  busy: boolean
  /** Whether this block could move into the one above it, or out of its parent. */
  nesting: { canIndent: boolean; canOutdent: boolean }
  onProps(props: Record<string, unknown>): void
  onDesign(patch: Record<string, unknown>): void
  onHide(hidden: boolean): void
  onDuplicate(): void
  onRemove(): void
  onIndent(): void
  onOutdent(): void
}) => {
  const [tab, setTab] = useState<'content' | 'design'>('content')
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)

  const blockId = node?.id

  // Only a change of selection refills the form. Refilling it from every command
  // response would overwrite what is being typed while the last keystroke is in
  // flight — the props are read here deliberately without depending on them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger, not the props
  useEffect(() => {
    setDraft({ ...(node?.props ?? {}) })
  }, [blockId])

  useEffect(() => () => clearTimeout(pending.current), [])

  /**
   * Typing is one command, not one per keystroke.
   *
   * Every edit is a command that writes a revision, so sending one per character
   * would fill the history with noise and put a dozen writes in flight at once
   * (SPEC.md §60, §64).
   */
  const commitLater = useCallback(
    (values: Record<string, unknown>) => {
      clearTimeout(pending.current)
      pending.current = setTimeout(() => onProps(values), 400)
    },
    [onProps],
  )

  if (node === undefined || block === undefined) {
    return (
      <aside className="w-80 shrink-0 border-l border-line bg-surface">
        <Empty title="Nothing selected">Choose a block on the page or in the outline.</Empty>
      </aside>
    )
  }

  const commit = (name: string, value: unknown) => {
    const next = { ...draft, [name]: value }

    setDraft(next)
    commitLater(next)
  }

  /** Leaving a field sends what is in it, rather than waiting out the pause. */
  const commitNow = () => {
    if (pending.current === undefined) return

    clearTimeout(pending.current)
    pending.current = undefined
    onProps(draft)
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <header className="space-y-2 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{block.label}</h2>
          {node.hidden === true && <Badge>hidden</Badge>}
        </div>

        <div className="flex gap-1">
          {(['content', 'design'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={[
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition',
                tab === name
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-soft hover:bg-surface-sunken',
              ].join(' ')}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </header>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: a blur anywhere inside flushes the pending edit */}
      <div className="flex-1 space-y-4 px-4 py-4" onBlur={commitNow}>
        {tab === 'content' ? (
          block.fields.length === 0 ? (
            <Empty title="This block has no fields" />
          ) : (
            block.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={draft[field.name]}
                onChange={(value) => commit(field.name, value)}
              />
            ))
          )
        ) : (
          <DesignControls
            design={node.design ?? {}}
            backgrounds={BACKGROUNDS}
            onChange={onDesign}
          />
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !nesting.canIndent}
          title="Move inside the block above"
          onClick={onIndent}
        >
          Nest
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !nesting.canOutdent}
          title="Move out of its container"
          onClick={onOutdent}
        >
          Lift out
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => onHide(node.hidden !== true)}
        >
          {node.hidden === true ? 'Show' : 'Hide'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </Button>
      </footer>
    </aside>
  )
}
