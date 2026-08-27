/**
 * What a selected block says about itself (SPEC.md §59, §61).
 *
 * The Content tab is the block's own fields — the same declaration that generates a
 * resource form, so the same inputs draw it. The Design tab is the seven universal
 * controls, which every block has and no block declares.
 */
import type { BlockNode } from '@assemora/schema'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type { BlockDescriptor } from '../api/introspection.ts'
import { useThemeColors } from '../api/theme.ts'
import { FieldInput } from '../screens/fields.tsx'
import { Badge, Button, Empty } from '../ui/index.tsx'
import { DesignControls } from './design.tsx'
import { draftReducer, emptyDraft, sameContent } from './draft.ts'

export const Properties = ({
  node,
  block,
  busy,
  can,
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
  /**
   * Which moves the application's own rules leave open (SPEC.md §56).
   *
   * A control that offers what the application refuses is a red banner waiting to
   * happen, and Duplicate was the one still doing it.
   */
  can: { indent: boolean; outdent: boolean; duplicate: boolean }
  onProps(props: Record<string, unknown>): void
  onDesign(patch: Record<string, unknown>): void
  onHide(hidden: boolean): void
  onDuplicate(): void
  onRemove(): void
  onIndent(): void
  onOutdent(): void
}) => {
  const [tab, setTab] = useState<'content' | 'design'>('content')
  const [draft, dispatch] = useReducer(draftReducer, emptyDraft)
  /** The edit waiting out the typing pause, and what it will send. */
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>
    values: Readonly<Record<string, unknown>>
  }>(undefined)
  // The theme is the list of colours there are, so it is also the list of backgrounds
  // a block may be given (SPEC.md §62) — read from the served stylesheet, which needs
  // no permission of its own and exists even where the theme is not editable. A
  // person who may edit a block's design may see what colours the site has.
  const colors = useThemeColors()

  const blockId = node?.id
  const props = node?.props

  const cancel = useCallback(() => {
    if (pending.current !== undefined) clearTimeout(pending.current.timer)

    pending.current = undefined
  }, [])

  // What the application now holds, offered to the draft on every command's answer.
  // The reducer decides whether it means anything: a new selection or a change this
  // panel did not make refills the form, and this panel's own edit coming home
  // leaves what is being typed alone.
  useEffect(() => {
    dispatch({ type: 'block', blockId, props: props ?? {} })
  }, [blockId, props])

  // A refill the panel did not ask for has to take the queued edit with it. Undo
  // would otherwise be followed 400 ms later by a command putting back exactly what
  // it removed — the queued values no longer match the form, which is what says so.
  useEffect(() => {
    if (pending.current !== undefined && !sameContent(pending.current.values, draft.values)) {
      cancel()
    }
  }, [draft.values, cancel])

  useEffect(() => cancel, [cancel])

  if (node === undefined || block === undefined) {
    return (
      <aside className="w-80 shrink-0 border-l border-line bg-surface">
        <Empty title="Nothing selected">Choose a block on the page or in the outline.</Empty>
      </aside>
    )
  }

  /**
   * Typing is one command, not one per keystroke.
   *
   * Every edit is a command that writes a revision, so sending one per character
   * would fill the history with noise and put a dozen writes in flight at once
   * (SPEC.md §60, §64).
   */
  const commit = (name: string, value: unknown) => {
    const values = { ...draft.values, [name]: value }

    dispatch({ type: 'edit', values })
    cancel()
    pending.current = {
      values,
      timer: setTimeout(() => {
        pending.current = undefined
        dispatch({ type: 'sent', values })
        onProps(values)
      }, 400),
    }
  }

  /** Leaving a field sends what is in it, rather than waiting out the pause. */
  const commitNow = () => {
    const queued = pending.current

    if (queued === undefined) return

    cancel()
    dispatch({ type: 'sent', values: queued.values })
    onProps(queued.values)
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
                value={draft.values[field.name]}
                onChange={(value) => commit(field.name, value)}
              />
            ))
          )
        ) : (
          <DesignControls
            design={node.design ?? {}}
            backgrounds={colors.data ?? []}
            onChange={onDesign}
          />
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !can.indent}
          title="Move inside the block above"
          onClick={onIndent}
        >
          Nest
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !can.outdent}
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
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !can.duplicate}
          title={
            can.duplicate
              ? 'Add a copy beside this block'
              : 'What holds this block will not take another'
          }
          onClick={onDuplicate}
        >
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
