/**
 * The page builder (SPEC.md §59, §60).
 *
 * Blocks on the left, the real page in the middle, properties on the right. Every
 * one of the twelve operations §60 requires is a command, and the canvas redraws from
 * what that command answered — there is no second copy of a page in this browser.
 */
import type { BlockNode } from '@assemora/schema'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { accepts, blockByName, useIntrospection } from '../api/introspection.ts'
import { usePage } from '../api/pages.ts'
import { Canvas, type Insertable, VIEWPORTS, type ViewportName } from '../builder/canvas.tsx'
import { isTyping, type KeyPress, shortcutFor } from '../builder/keys.ts'
import { Palette } from '../builder/palette.tsx'
import { Properties } from '../builder/properties.tsx'
import {
  allowedMoves,
  blockAbove,
  liftOut,
  nodeIn,
  placeBeside,
  stepFrom,
  useBuilder,
} from '../builder/state.ts'
import { Badge, Button, Failure, Spinner } from '../ui/index.tsx'

export const Builder = () => {
  const { id } = useParams({ from: '/pages/$id' })
  const navigate = useNavigate()
  const introspection = useIntrospection()
  const page = usePage(id, 'draft')
  const { state, node, select, run, rewind, dismiss } = useBuilder(page.data)
  const [viewport, setViewport] = useState<ViewportName>('desktop')

  const registry = introspection.data

  /** What the application calls a block of this type, never its machine name. */
  const nameOf = (type: string): string => blockByName(registry, type)?.label ?? type

  /**
   * Whether a container will take one more block of this type, right now.
   *
   * Both halves of the application's own rule: what a block accepts, and how many it
   * accepts. The top level takes anything. Studio only reads this (SPEC.md §56) — and
   * it reads it in one place, so the badge on a palette button, where a new block
   * lands and what the `+` on the canvas offers cannot disagree with each other.
   */
  const roomIn = (container: BlockNode | null, type: string): boolean => {
    if (container === null) return true

    const descriptor = blockByName(registry, container.type)

    return (
      descriptor !== undefined &&
      accepts(descriptor, type) &&
      (descriptor.maxChildren === undefined || container.children.length < descriptor.maxChildren)
    )
  }

  const insertable = (parentId: string | null): readonly Insertable[] =>
    (registry?.blocks ?? []).filter((block) =>
      roomIn(nodeIn(state.tree, parentId) ?? null, block.name),
    )

  const add = (type: string, placement: { parentId?: string; index?: number }) => {
    void run('blocks.add', { type, ...placement }).then((result) => {
      if (result?.blockId !== undefined) select(result.blockId)
    })
  }

  /**
   * The keyboard (SPEC.md §123).
   *
   * One handler, whichever document the press landed in, and it answers whether it
   * claimed the press — only the listener that has an event to cancel cancels one.
   *
   * Declared above the screen's early returns, because a hook cannot be conditional;
   * it reads nothing that is missing while the page is still loading.
   */
  const runShortcut = useCallback(
    (press: KeyPress): boolean => {
      const shortcut = shortcutFor(press)

      if (shortcut === undefined) return false

      if (shortcut === 'undo' || shortcut === 'redo') {
        if (!state.busy) void rewind(shortcut)

        return true
      }

      if (shortcut === 'deselect') {
        select(null)

        return true
      }

      if (state.selected === null || state.busy) return false

      if (shortcut === 'remove') {
        void run('blocks.remove', { blockId: state.selected }).then(() => select(null))

        return true
      }

      const placement = stepFrom(state.tree, state.selected, shortcut === 'move-up' ? -1 : 1)

      if (placement === undefined) return false

      void run('blocks.move', { blockId: state.selected, ...placement })

      return true
    },
    [state.tree, state.selected, state.busy, run, rewind, select],
  )

  /**
   * A press the frame forwarded, because it landed in the canvas (SPEC.md §59).
   *
   * A frame ships with the application and may be any version of the protocol, so
   * what it forwards is checked here as well: a press arriving while somebody is
   * typing in Studio's own form must not remove their block. Focus inside the canvas
   * makes the iframe element itself the active one, so this refuses nothing real.
   */
  const onCanvasKey = useCallback(
    (press: KeyPress) => {
      if (isTyping(document.activeElement)) return

      runShortcut(press)
    },
    [runShortcut],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return

      if (runShortcut(event)) event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runShortcut])

  if (page.isPending || introspection.isPending) {
    return (
      <div className="grid h-dvh place-items-center">
        <Spinner />
      </div>
    )
  }

  if (page.isError) {
    return (
      <div className="p-8">
        <Failure error={page.error} />
      </div>
    )
  }

  const block = blockByName(registry, node?.type ?? '')

  /**
   * Which of the panel's moves are open to the selection.
   *
   * The application's nesting rules decide all three, and they arrive in the registry
   * — Studio only reads them (SPEC.md §56).
   */
  const above = node === undefined ? undefined : blockAbove(state.tree, node.id)
  const can = allowedMoves(state.tree, node, roomIn)

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: '/pages' })}>
          ← Pages
        </Button>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{page.data?.title}</p>
          <p className="truncate text-xs text-ink-faint">
            /{page.data?.slug} · v{state.version}
          </p>
        </div>

        {state.hasUnpublishedChanges && <Badge tone="accent">unpublished changes</Badge>}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            title="Undo (⌘Z)"
            disabled={state.busy}
            onClick={() => void rewind('undo')}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Redo (⌘⇧Z)"
            disabled={state.busy}
            onClick={() => void rewind('redo')}
          >
            Redo
          </Button>

          <div className="mx-1 flex rounded-lg border border-line p-0.5">
            {(Object.keys(VIEWPORTS) as ViewportName[]).map((name) => (
              <button
                key={name}
                type="button"
                className={[
                  'rounded-md px-2 py-1 text-xs font-medium transition',
                  viewport === name ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink',
                ].join(' ')}
                onClick={() => setViewport(name)}
              >
                {VIEWPORTS[name].label}
              </button>
            ))}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(`/preview?page=${id}&mode=draft`, '_blank', 'noopener')}
          >
            Preview
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: '/pages/$id/history', params: { id } })}
          >
            History
          </Button>

          <Button size="sm" disabled={state.busy} onClick={() => void run('pages.publish')}>
            Publish
          </Button>
        </div>
      </header>

      {/* An answer, not a refusal: it says what it says at the weight it deserves. */}
      {state.notice !== undefined && (
        <div className="flex items-center gap-3 border-b border-line bg-surface-sunken px-4 py-1.5 text-sm text-ink-soft">
          <p className="flex-1">{state.notice}</p>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}

      {state.failure !== undefined && (
        <div className="flex items-center gap-3 border-b border-danger/20 bg-danger-soft px-4 py-2 text-sm text-danger">
          <div className="flex-1 space-y-0.5">
            <p>
              {state.conflict
                ? 'Someone else has changed this page since you opened it. Reload before editing further.'
                : Object.keys(state.fields).length > 0
                  ? 'This page is not ready to be published:'
                  : state.failure}
            </p>
            {Object.entries(state.fields).map(([field, messages]) => (
              <p key={field} className="text-xs">
                <code className="font-mono">{field}</code> — {messages.join(', ')}
              </p>
            ))}
          </div>
          {state.conflict ? (
            <Button size="sm" variant="secondary" onClick={() => location.reload()}>
              Reload
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Palette
          introspection={registry}
          tree={state.tree}
          selected={state.selected}
          busy={state.busy}
          nameOf={nameOf}
          fitsInSelection={(type) => roomIn(node ?? null, type)}
          onSelect={select}
          onMove={(blockId, direction) => {
            const placement = stepFrom(state.tree, blockId, direction)

            if (placement === undefined) return

            // The row is about to move; selecting it first is what keeps its controls
            // on screen once it has.
            select(blockId)
            void run('blocks.move', { blockId, ...placement })
          }}
          onAdd={(declared, into) => {
            // Inside the selection when it will hold one, and beside the selection
            // when it will not — never silently at the bottom of the page.
            add(
              declared.name,
              into === null
                ? placeBeside(state.tree, state.selected, (container) =>
                    roomIn(container, declared.name),
                  )
                : { parentId: into },
            )
          }}
        />

        <Canvas
          pageId={id}
          tree={state.tree}
          selected={state.selected}
          viewport={viewport}
          busy={state.busy}
          nameOf={nameOf}
          insertable={insertable}
          onSelect={select}
          onKeyPress={onCanvasKey}
          onInsert={add}
        />

        <Properties
          node={node}
          block={block}
          busy={state.busy}
          can={can}
          onIndent={() => {
            if (node !== undefined && above !== undefined) {
              void run('blocks.move', { blockId: node.id, parentId: above.id })
            }
          }}
          onOutdent={() => {
            if (node === undefined) return

            const placement = liftOut(state.tree, node.id)

            if (placement === undefined) return

            void run('blocks.move', { blockId: node.id, ...placement })
          }}
          onProps={(props) => {
            if (node !== undefined) void run('blocks.update', { blockId: node.id, props })
          }}
          onDesign={(design) => {
            if (node !== undefined) void run('blocks.design', { blockId: node.id, design })
          }}
          onHide={(hidden) => {
            if (node !== undefined) void run('blocks.hide', { blockId: node.id, hidden })
          }}
          onDuplicate={() => {
            if (node === undefined) return

            // No index: a copy lands beside its original by definition, and
            // `blocks.duplicate` is the one that knows where the original is.
            void run('blocks.duplicate', { blockId: node.id }).then((result) => {
              if (result?.blockId !== undefined) select(result.blockId)
            })
          }}
          onRemove={() => {
            if (node === undefined) return

            void run('blocks.remove', { blockId: node.id }).then(() => select(null))
          }}
        />
      </div>
    </div>
  )
}
