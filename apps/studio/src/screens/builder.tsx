/**
 * The page builder (SPEC.md §59, §60).
 *
 * Blocks on the left, the real page in the middle, properties on the right. Every
 * one of the twelve operations §60 requires is a command, and the canvas redraws from
 * what that command answered — there is no second copy of a page in this browser.
 */
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { accepts, blockByName, useIntrospection } from '../api/introspection.ts'
import { usePage } from '../api/pages.ts'
import { Canvas, VIEWPORTS, type ViewportName } from '../builder/canvas.tsx'
import { Palette } from '../builder/palette.tsx'
import { Properties } from '../builder/properties.tsx'
import { blockAbove, parentOf, stepFrom, useBuilder } from '../builder/state.ts'
import { Badge, Button, Failure, Spinner } from '../ui/index.tsx'

export const Builder = () => {
  const { id } = useParams({ from: '/pages/$id' })
  const navigate = useNavigate()
  const introspection = useIntrospection()
  const page = usePage(id, 'draft')
  const { state, node, select, run, rewind, dismiss } = useBuilder(page.data)
  const [viewport, setViewport] = useState<ViewportName>('desktop')

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

  const block = blockByName(introspection.data, node?.type ?? '')
  const selectedType = node?.type

  /**
   * Whether the selection can move into the block above it, or out of its parent.
   *
   * The application's nesting rules decide, and they arrive in the registry — Studio
   * only reads them (SPEC.md §56).
   */
  const above = node === undefined ? undefined : blockAbove(state.tree, node.id)
  const container = above === undefined ? undefined : blockByName(introspection.data, above.type)

  const nesting = {
    canIndent:
      node !== undefined &&
      above !== undefined &&
      container !== undefined &&
      accepts(container, node.type) &&
      (container.maxChildren === undefined || above.children.length < container.maxChildren),
    canOutdent: node !== undefined && parentOf(state.tree, node.id) !== null,
  }

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
            disabled={state.busy}
            onClick={() => void rewind('undo')}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
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
          introspection={introspection.data}
          tree={state.tree}
          selected={state.selected}
          selectedType={selectedType}
          busy={state.busy}
          onSelect={select}
          onMove={(blockId, direction) => {
            const placement = stepFrom(state.tree, blockId, direction)

            if (placement !== undefined) void run('blocks.move', { blockId, ...placement })
          }}
          onAdd={(declared, into) => {
            void run('blocks.add', {
              type: declared.name,
              ...(into === null ? {} : { parentId: into }),
            }).then((result) => {
              if (result?.blockId !== undefined) select(result.blockId)
            })
          }}
        />

        <Canvas
          pageId={id}
          tree={state.tree}
          selected={state.selected}
          viewport={viewport}
          onSelect={select}
        />

        <Properties
          node={node}
          block={block}
          busy={state.busy}
          nesting={nesting}
          onIndent={() => {
            if (node !== undefined && above !== undefined) {
              void run('blocks.move', { blockId: node.id, parentId: above.id })
            }
          }}
          onOutdent={() => {
            if (node === undefined) return

            const parent = parentOf(state.tree, node.id)

            if (parent === null) return

            const grandparent = parentOf(state.tree, parent)

            void run('blocks.move', {
              blockId: node.id,
              ...(grandparent === null ? {} : { parentId: grandparent }),
            })
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
