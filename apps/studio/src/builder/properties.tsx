/**
 * What a selected block says about itself (SPEC.md §59, §61).
 *
 * The Content tab is the block's own fields — the same declaration that generates a
 * resource form, so the same inputs draw it. The Design tab is the seven universal
 * controls, which every block has and no block declares.
 */
import type { BlockNode } from '@assemora/schema'
import {
  ArrowDown,
  ArrowUp,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  IndentDecrease,
  IndentIncrease,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { type BlockDescriptor, valueAt } from '../api/introspection.ts'
import { useThemeColors } from '../api/theme.ts'
import { useT } from '../i18n/translate.tsx'
import { FieldInput } from '../screens/fields.tsx'
import { ResourceIcon } from '../ui/icons.tsx'

import { Badge, IconButton, join } from '../ui/index.tsx'
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
  onMoveUp,
  onMoveDown,
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
  can: { indent: boolean; outdent: boolean; duplicate: boolean; up: boolean; down: boolean }
  onProps(props: Record<string, unknown>): void
  onDesign(patch: Record<string, unknown>): void
  onHide(hidden: boolean): void
  onDuplicate(): void
  onRemove(): void
  onIndent(): void
  onOutdent(): void
  onMoveUp(): void
  onMoveDown(): void
}) => {
  const t = useT()
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

  /*
   * Nothing selected: the panel collapses to a pill and the canvas takes the space back.
   * A 344px column of "Nothing selected" is the widest possible way to say nothing, and
   * on a laptop it is the difference between judging a page at its real width and not.
   */
  if (node === undefined || block === undefined) {
    return (
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-start p-4">
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-sm text-ink-soft shadow-pill">
          <ChevronsRight aria-hidden className="size-4" />
          {t('properties.nothingSelected')}
        </span>
      </div>
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
    <aside className="absolute inset-y-4 right-4 flex w-86 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-panel">
      <header className="shrink-0 border-b border-hairline px-4 pt-3">
        <div className="flex items-center gap-2">
          <ResourceIcon name={block.icon} className="size-4 shrink-0 text-ink-soft" />
          <h2 className="min-w-0 flex-1 truncate text-base font-[650]">{block.label}</h2>
          {node.hidden === true && <Badge tone="quiet">{t('properties.hidden')}</Badge>}
        </div>
        {/* The machine's own names, in the machine's own type: what a bug report needs
            and what an agent addresses the block by. */}
        <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">
          {node.type} · {node.id}
        </p>

        <div role="tablist" aria-label={t('properties.inspector')} className="mt-2 flex gap-6">
          {(['content', 'design'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={join(
                'h-9 border-b-2 px-0.5 text-base',
                tab === name
                  ? 'border-ink text-ink font-[650]'
                  : 'border-transparent text-ink-soft font-[550] hover:text-ink',
              )}
              onClick={() => setTab(name)}
            >
              {name === 'content' ? t('properties.content') : t('properties.design')}
            </button>
          ))}
        </div>
      </header>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: a blur anywhere inside flushes the pending edit */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" onBlur={commitNow}>
        {tab === 'content' ? (
          block.fields.length === 0 ? (
            <p className="py-8 text-center text-base text-ink-soft">{t('properties.noFields')}</p>
          ) : (
            block.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={valueAt(draft.values, field.name)}
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

      {/* Six moves as icons and one destruction in words: the handoff's footer. A
          destructive action never shares a shape with the five beside it. */}
      <footer className="flex shrink-0 items-center gap-1 border-t border-hairline px-3 py-2.5">
        <IconButton
          label={t('properties.duplicate')}
          size={30}
          disabled={busy || !can.duplicate}
          onClick={onDuplicate}
        >
          <Copy aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={t('properties.indent')}
          size={30}
          disabled={busy || !can.indent}
          onClick={onIndent}
        >
          <IndentIncrease aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={t('properties.outdent')}
          size={30}
          disabled={busy || !can.outdent}
          onClick={onOutdent}
        >
          <IndentDecrease aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={node.hidden === true ? t('properties.show') : t('properties.hide')}
          size={30}
          disabled={busy}
          onClick={() => onHide(node.hidden !== true)}
        >
          {node.hidden === true ? (
            <Eye aria-hidden className="size-4" />
          ) : (
            <EyeOff aria-hidden className="size-4" />
          )}
        </IconButton>
        {/* Moving is one of the six actions the handoff puts in this footer, and it was
            reachable only from the outline: a person working in the inspector had to
            cross the window to move the block they already had selected. */}
        <IconButton
          label={t('properties.moveUp')}
          size={30}
          disabled={busy || !can.up}
          onClick={onMoveUp}
        >
          <ArrowUp aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={t('properties.moveDown')}
          size={30}
          disabled={busy || !can.down}
          onClick={onMoveDown}
        >
          <ArrowDown aria-hidden className="size-4" />
        </IconButton>

        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-base font-[650] text-danger hover:bg-danger-soft disabled:opacity-50"
        >
          <Trash2 aria-hidden className="size-4" />
          {t('common.remove')}
        </button>
      </footer>
    </aside>
  )
}
