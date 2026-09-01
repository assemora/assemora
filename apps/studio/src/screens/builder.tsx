/**
 * The page builder (SPEC.md §59, §60).
 *
 * Blocks on the left, the real page in the middle, properties on the right. Every
 * one of the twelve operations §60 requires is a command, and the canvas redraws from
 * what that command answered — there is no second copy of a page in this browser.
 */
import type { BlockNode } from '@assemora/schema'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  ExternalLink,
  History as HistoryIcon,
  Monitor,
  Redo2,
  Smartphone,
  Tablet,
  Undo2,
} from 'lucide-react'
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
import { Banner, Button, Spinner } from '../ui/index.tsx'
import { Logo } from '../ui/logo.tsx'
import { Translations } from './translations.tsx'

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
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner />
      </div>
    )
  }

  if (page.isError) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas p-8">
        <div className="w-full max-w-md">
          <Banner tone="danger" title="This page could not be opened">
            {page.error instanceof Error ? page.error.message : 'The application did not answer.'}
          </Banner>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => void navigate({ to: '/pages' })}
          >
            Back to Pages
          </Button>
        </div>
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

  const VIEWPORT_ICONS = {
    desktop: <Monitor className="size-4" />,
    tablet: <Tablet className="size-4" />,
    mobile: <Smartphone className="size-4" />,
  } as const

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/*
       * The editor's own chrome, 52px and chrome-coloured, in place of Studio's — the
       * builder is a mode rather than a screen, so it takes the whole window and puts
       * what a page needs where the shell's bar would have been.
       */}
      <header className="flex h-13 shrink-0 items-center gap-2 bg-chrome px-3 text-chrome-ink">
        <button
          type="button"
          onClick={() => void navigate({ to: '/pages' })}
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-base opacity-80 hover:bg-white/10 hover:opacity-100"
        >
          <ArrowLeft aria-hidden className="size-[18px]" />
          Pages
        </button>

        <span aria-hidden className="px-1 opacity-30">
          /
        </span>
        <Logo size={20} />

        <div className="ml-1 flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-[550]">{page.data?.title}</span>
          <span className="shrink-0 font-mono text-xs opacity-55">
            /{page.data?.slug} · v{state.version}
          </span>
        </div>

        {state.hasUnpublishedChanges && (
          <span className="ml-2 shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-semibold">
            unpublished changes
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Undo (⌘Z)"
            title="Undo (⌘Z)"
            disabled={state.busy}
            onClick={() => void rewind('undo')}
            className="grid size-8 place-items-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-30"
          >
            <Undo2 aria-hidden className="size-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Redo (⌘⇧Z)"
            title="Redo (⌘⇧Z)"
            disabled={state.busy}
            onClick={() => void rewind('redo')}
            className="grid size-8 place-items-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-30"
          >
            <Redo2 aria-hidden className="size-[18px]" />
          </button>

          <div className="mx-1 rounded-[9px] bg-white/10 p-0.5">
            {(Object.keys(VIEWPORTS) as ViewportName[]).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={VIEWPORTS[name].label}
                title={VIEWPORTS[name].label}
                onClick={() => setViewport(name)}
                className={[
                  'inline-grid h-[26px] w-8 place-items-center rounded-[7px]',
                  viewport === name
                    ? 'bg-white/90 text-ink'
                    : 'text-chrome-ink/70 hover:text-white',
                ].join(' ')}
              >
                {VIEWPORT_ICONS[name]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => window.open(`/preview?page=${id}&mode=draft`, '_blank', 'noopener')}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-base opacity-80 hover:bg-white/10 hover:opacity-100"
          >
            <ExternalLink aria-hidden className="size-4" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: '/pages/$id/history', params: { id } })}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-base opacity-80 hover:bg-white/10 hover:opacity-100"
          >
            <HistoryIcon aria-hidden className="size-4" />
            History
          </button>

          {/* Accent while there is something to publish, neutral once there is not:
              the one control on the bar whose colour is a fact about the page. */}
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void run('pages.publish')}
            className={[
              'relief-primary ml-1 h-8 rounded-lg px-4 font-[650] text-white disabled:opacity-60',
              state.hasUnpublishedChanges
                ? 'bg-accent hover:brightness-[0.9]'
                : 'bg-white/15 hover:bg-white/25',
            ].join(' ')}
          >
            Publish
          </button>
        </div>
      </header>

      {/* Under the bar rather than in it: which language this page is decides what every
          block on the canvas *is*, and the answer is a sentence — "out of date", "this is
          the original everything falls back to" — not a menu item (SPEC.md §131). */}
      {page.data !== undefined && (
        <div className="shrink-0 border-b border-hairline bg-surface px-4 py-2">
          <Translations subject="page" id={id} entryLocale={page.data.locale} />
        </div>
      )}

      {/* Banners under the bar, in the palette of what they are about. */}
      {(state.notice !== undefined || state.failure !== undefined) && (
        <div className="shrink-0 space-y-2 border-b border-line bg-surface px-4 py-2.5">
          {state.notice !== undefined && (
            <Banner tone="info" title={state.notice} onDismiss={dismiss} />
          )}

          {state.failure !== undefined &&
            (state.conflict ? (
              <Banner
                tone="danger"
                title="Someone else has changed this page since you opened it"
                actions={
                  <Button variant="secondary" size="sm" onClick={() => location.reload()}>
                    Reload
                  </Button>
                }
              >
                Reloading takes their version. Nothing here has been written over.
              </Banner>
            ) : Object.keys(state.fields).length > 0 ? (
              <Banner
                tone="warning"
                title="This page is not ready to be published"
                onDismiss={dismiss}
              >
                {/* A chip per offending block, which selects it — the shortest route
                    from "what is wrong" to the field that is wrong. */}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(state.fields).map(([field, messages]) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => select(field.split('.')[0] ?? null)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-warning-line bg-surface px-2.5 py-0.5 text-sm font-semibold text-warning-ink hover:bg-warning-wash"
                    >
                      <span className="font-mono">{field}</span>
                      <span className="font-normal opacity-80">{messages.join(', ')}</span>
                    </button>
                  ))}
                </div>
              </Banner>
            ) : (
              <Banner tone="danger" title={state.failure} onDismiss={dismiss} />
            ))}
        </div>
      )}

      {/* Three zones: the rail, the canvas, and an inspector floating over its right
          edge. The canvas gives the panel room only while it is open — `relative` is
          what the inspector is positioned against. */}
      <div className="relative flex min-h-0 flex-1">
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

        <div
          className={
            node === undefined
              ? 'relative flex min-w-0 flex-1'
              : 'relative flex min-w-0 flex-1 pr-94'
          }
        >
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

          {/*
           * What the page is, bottom-left, out of the way of everything.
           *
           * A page has no Save: every edit is already a command that wrote a revision, so
           * the only thing left to say is whether what is written is *published*. Saying
           * nothing leaves a person hunting for a Save button that will never exist.
           */}
          <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2">
            <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-sm text-ink-soft shadow-pill">
              <span
                aria-hidden
                className={[
                  'size-1.5 rounded-full',
                  state.busy
                    ? 'bg-warning'
                    : state.hasUnpublishedChanges
                      ? 'bg-warning'
                      : 'bg-accent',
                ].join(' ')}
              />
              {state.busy
                ? 'Saving…'
                : state.hasUnpublishedChanges
                  ? 'Draft saved · not published'
                  : `Published · v${state.version}`}
            </span>
          </div>
        </div>

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
