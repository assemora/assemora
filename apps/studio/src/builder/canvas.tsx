/**
 * The canvas (SPEC.md §59).
 *
 * An iframe running the application's own frontend. CSS is isolated, the components
 * that draw are the ones a visitor gets, and a responsive preview is a real viewport
 * rather than a simulation.
 *
 * Studio never reaches inside it. It sends instructions in and gets geometry, clicks
 * and crossings back — the protocol in `@assemora/react`'s `canvas.ts` — and draws its
 * own chrome on a layer above, so nothing Studio does changes what the page looks
 * like (ADR-0018).
 */
import { type BlockRect, type KeyPress, sendToCanvas } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { type Ref, useCallback, useEffect, useRef, useState } from 'react'

import { useIntrospection } from '../api/introspection.ts'

import { dismissOn } from './dismiss.ts'
import { type InsertionPoint, insertionPoints } from './insertion.ts'
import {
  listenToCanvas,
  nothingSelected,
  reportedByCanvas,
  revealFor,
  type Selection,
} from './link.ts'
import { nodeIn, parentOf, siblingsOf } from './state.ts'

export const VIEWPORTS = {
  desktop: { label: 'Desktop', width: 0 },
  tablet: { label: 'Tablet', width: 834 },
  mobile: { label: 'Mobile', width: 390 },
} as const

export type ViewportName = keyof typeof VIEWPORTS

/** A block a `+` on the canvas can put in. */
export type Insertable = {
  readonly name: string
  readonly label: string
}

const Chip = ({ box, tone, children }: { box: BlockRect; tone: string; children: string }) => (
  <span
    className={`pointer-events-none absolute rounded-br-md px-1.5 py-0.5 text-[11px] font-medium leading-none text-white ${tone}`}
    style={{ top: box.top, left: box.left }}
  >
    {children}
  </span>
)

/** How far past the line the band a person aims at reaches, in the frame's pixels. */
const REACH = 10

/**
 * One place a block can be put in (SPEC.md §59, §60).
 *
 * The band is deliberately far larger than the line it draws, because a 2px line is
 * not a target. It was drawn that size and could not be aimed at: the whole overlay
 * is `pointer-events: none` so Studio's chrome never swallows a click meant for the
 * page, this inherited that and never took it back, and only the 20px circle
 * answered. The padding bought nothing and the hover highlight fired from the very
 * control it was there to make findable. So the button *is* the band, and everything
 * drawn inside it is drawn by it.
 */
export const InsertionGap = ({
  point,
  open,
  busy,
  options,
  reason,
  holder,
  onOpen,
  onPick,
}: {
  point: InsertionPoint
  open: boolean
  busy: boolean
  /** What may go in here — empty when the container will take nothing more. */
  options: readonly Insertable[]
  /** What this place is: an invitation, or why there is none. */
  reason: string
  /** Held by the open menu, so a press inside it is not a press outside it. */
  holder: Ref<HTMLDivElement> | null
  onOpen(): void
  onPick(type: string): void
}) => {
  const full = options.length === 0

  return (
    <div
      ref={holder}
      className="absolute"
      style={{
        top: point.top - REACH,
        left: point.left - REACH,
        width: point.width + REACH * 2,
        height: point.height + REACH * 2,
      }}
    >
      <button
        type="button"
        aria-label={reason}
        title={reason}
        disabled={busy}
        className="group pointer-events-auto absolute inset-0 disabled:cursor-not-allowed"
        onClick={onOpen}
      >
        {/* The line is there at rest, faintly: an insertion point nobody can see
            until they happen to hover it is not an affordance. */}
        <span
          className={[
            'absolute rounded-full transition',
            full
              ? 'bg-line'
              : open
                ? 'bg-accent'
                : 'bg-accent/25 group-hover:bg-accent group-focus-visible:bg-accent',
          ].join(' ')}
          style={{ top: REACH, left: REACH, width: point.width, height: point.height }}
        />
        <span
          className={[
            'absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center',
            'rounded-full border bg-surface text-sm leading-none shadow-sm transition',
            full
              ? 'border-line text-ink-faint'
              : open
                ? 'border-accent bg-accent text-white'
                : 'border-accent/40 text-accent opacity-70 group-hover:border-accent group-hover:bg-accent group-hover:text-white group-hover:opacity-100 group-focus-visible:opacity-100',
          ].join(' ')}
          style={{ top: REACH + point.height / 2, left: REACH + point.width / 2 }}
        >
          +
        </span>
      </button>

      {open && (
        <div
          className="pointer-events-auto absolute z-10 w-44 -translate-x-1/2 space-y-0.5 rounded-lg border border-line bg-surface p-1 shadow-lg"
          style={{ top: REACH + point.height / 2 + 14, left: REACH + point.width / 2 }}
        >
          {/* A place that will take nothing still says so. Every `+` disappearing
              from the page the moment a container filled up left nothing on screen
              to explain where they had gone. */}
          {full ? (
            <p className="px-2 py-1.5 text-base text-ink-soft">{reason}</p>
          ) : (
            options.map((option) => (
              <button
                key={option.name}
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-base text-ink transition hover:bg-surface-sunken"
                onClick={() => onPick(option.name)}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A page nobody has put anything on, over the frame that is drawing nothing.
 *
 * Two states, and the second is the one a fresh install lands in: an application whose
 * source declares no `block()` has nothing that could go on a page, and "put the first
 * one in" over a row of no buttons reads as software that has lost its palette. It
 * points left rather than repeating the instructions — the Blocks panel is where they
 * belong, because it is also where somebody looks on a page that already has blocks.
 */
export const EmptyPage = ({
  options,
  busy,
  onInsert,
}: {
  /** What may go at the top level. Empty when the application declares no blocks. */
  options: readonly Insertable[]
  busy: boolean
  onInsert(type: string): void
}) => (
  <div className="absolute inset-0 grid place-items-center p-8">
    <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-line bg-surface px-6 py-7 text-center">
      {options.length === 0 ? (
        <>
          <p className="text-base font-medium text-ink">Nothing can go on this page yet</p>
          <p className="mt-1 text-base text-ink-soft">
            This application declares no block types. A block is a TypeScript declaration, so Studio
            cannot make one — the Blocks panel on the left has the command that can.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium text-ink">This page has nothing on it yet</p>
          <p className="mt-1 text-base text-ink-soft">
            Every page is a tree of blocks. Put the first one in.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {options.map((option) => (
              <button
                key={option.name}
                type="button"
                disabled={busy}
                className="rounded-lg border border-line px-2.5 py-1 text-base text-ink transition hover:border-accent hover:text-accent disabled:opacity-60"
                onClick={() => onInsert(option.name)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  </div>
)

export const Canvas = ({
  pageId,
  tree,
  selected,
  viewport,
  busy,
  nameOf,
  insertable,
  onSelect,
  onKeyPress,
  onInsert,
}: {
  pageId: string
  tree: BlockTree
  selected: string | null
  viewport: ViewportName
  busy: boolean
  /** What the application calls a block of this type (SPEC.md §56). */
  nameOf(type: string): string
  /** What may go inside this parent right now — the top level when null. */
  insertable(parentId: string | null): readonly Insertable[]
  onSelect(blockId: string | null): void
  /** A key pressed inside the frame, where Studio's own listener cannot hear it. */
  onKeyPress(press: KeyPress): void
  onInsert(type: string, placement: { parentId?: string; index: number }): void
}) => {
  /**
   * Where this application serves its own frontend, from the registry.
   *
   * `/preview` was hard-coded here, and it is only the default: an application whose
   * site *is* the frontend serves it at the origin root, and then `/preview` is a 404
   * in an iframe with nothing saying why.
   */
  const introspection = useIntrospection()
  const frontend = introspection.data?.frontend?.[0]?.name ?? '/preview'

  const frame = useRef<HTMLIFrameElement>(null)
  const [rects, setRects] = useState<readonly BlockRect[]>([])
  const [ready, setReady] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  /**
   * The gap whose menu is open, and the group it belongs to.
   *
   * A gap is a position among one particular set of siblings, so an index on its own
   * would go on meaning something after the selection moved to another group.
   */
  const [opened, setOpened] = useState<{ group: string | null; index: number } | null>(null)
  /** The insertion point whose menu is open, so a press inside it is not outside it. */
  const menu = useRef<HTMLDivElement>(null)
  /** Which selection is on screen, and whether the frame is the one that chose it. */
  const selection = useRef<Selection>(nothingSelected)

  // The frame is served from this origin, so it is the only one either end speaks to.
  const send = useCallback((instruction: Parameters<typeof sendToCanvas>[1]) => {
    sendToCanvas(frame.current?.contentWindow, instruction, location.origin)
  }, [])

  useEffect(
    () =>
      listenToCanvas({
        view: window,
        frame: () => frame.current?.contentWindow,
        origin: location.origin,
        on: {
          ready: () => setReady(true),
          hovered: setHovered,
          geometry: setRects,
          selected: (blockId) => {
            // A click in the page is also a click outside anything Studio is floating
            // over it — and Studio's own document never hears that one.
            setOpened(null)
            selection.current = reportedByCanvas(selection.current, blockId)
            onSelect(blockId)
          },
          pressed: (press) => {
            // Escape dismisses the thing on top wherever the press landed, exactly as
            // it does when Studio has the focus.
            if (press.key === 'Escape' && opened !== null) {
              setOpened(null)

              return
            }

            onKeyPress(press)
          },
        },
      }),
    [onSelect, onKeyPress, opened],
  )

  // Every edit is drawn by handing the frame the tree the command answered with.
  useEffect(() => {
    if (ready) send({ type: 'assemora:render', tree, selected })
  }, [ready, tree, selected, send])

  // After the render that created it, never before: a block added a moment ago is not
  // in the frame's DOM until it has drawn. Declared after the render effect so the two
  // leave in that order.
  useEffect(() => {
    if (!ready) return

    const { reveal, next } = revealFor(selection.current, selected)

    selection.current = next

    if (reveal && selected !== null) send({ type: 'assemora:reveal', blockId: selected })
  }, [ready, selected, send])

  useEffect(() => {
    if (opened === null) return

    return dismissOn({
      view: window,
      page: document,
      holder: () => menu.current,
      close: () => setOpened(null),
    })
  }, [opened])

  const width = VIEWPORTS[viewport].width
  const box = rects.find((rect) => rect.id === selected)
  const under = hovered === null || hovered === selected ? undefined : hovered
  const underBox = rects.find((rect) => rect.id === under)

  /**
   * The gaps drawn are the ones around what a person is working on.
   *
   * One group at a time: every gap on a nested page at once is a mesh of lines over
   * the page it is supposed to be showing.
   */
  const group = selected === null ? null : parentOf(tree, selected)
  const siblings = selected === null ? tree.blocks : siblingsOf(tree, selected)
  const gaps = insertionPoints(
    siblings,
    rects,
    group === null ? undefined : rects.find((rect) => rect.id === group),
  )
  const options = insertable(group)
  const placement = (index: number) => ({ ...(group === null ? {} : { parentId: group }), index })
  const openGap = opened !== null && opened.group === group ? opened.index : null
  const container = group === null ? undefined : nodeIn(tree, group)

  /**
   * What an insertion point offers, or why it offers nothing.
   *
   * Every `+` used to disappear from the page the moment the container filled up,
   * which reads as a bug rather than as a rule: the block is selected, the page looks
   * the same, and the way to add anything has gone with nothing in its place.
   */
  const reason =
    options.length > 0
      ? 'Add a block here'
      : container === undefined
        ? 'This application declares no blocks'
        : `The ${nameOf(container.type)} block will not take anything more`

  return (
    <div className="relative flex-1 overflow-auto bg-canvas p-6">
      {/* The page as a sheet on the canvas: 14px radius, a hairline and one soft drop,
          so the edge of the site is visible and a full-width block reads as full width
          rather than as the panel it happens to be inside. */}
      <div
        className="relative mx-auto min-h-full rounded-[14px] bg-surface shadow-[0_12px_40px_-18px_rgb(24_24_27/0.28),0_0_0_1px_rgb(0_0_0/0.06)] transition-[width]"
        style={{ width: width === 0 ? '100%' : `${width}px`, height: '100%' }}
      >
        <iframe
          ref={frame}
          title="Page preview"
          className="size-full border-0"
          src={`${frontend}${frontend.includes('?') ? '&' : '?'}page=${pageId}&mode=draft&editing=1&editor=${encodeURIComponent(location.origin)}`}
        />

        {/* Studio's own chrome, on a layer of its own: it never touches the page. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {underBox !== undefined && under !== undefined && (
            <>
              <div
                className="absolute rounded-sm outline-1 outline-dashed outline-offset-1 outline-accent/60"
                style={{
                  top: underBox.top,
                  left: underBox.left,
                  width: underBox.width,
                  height: underBox.height,
                }}
              />
              <Chip box={underBox} tone="bg-accent/60">
                {nameOf(nodeIn(tree, under)?.type ?? '')}
              </Chip>
            </>
          )}

          {box !== undefined && selected !== null && (
            <>
              <div
                className="absolute rounded-sm outline-2 outline-offset-1 outline-accent"
                style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
              />
              <Chip box={box} tone="bg-accent">
                {nameOf(nodeIn(tree, selected)?.type ?? '')}
              </Chip>
            </>
          )}

          {gaps.map((gap) => (
            <InsertionGap
              key={`${group ?? 'root'}-${gap.index}`}
              point={gap}
              open={openGap === gap.index}
              busy={busy}
              options={options}
              reason={reason}
              holder={openGap === gap.index ? menu : null}
              onOpen={() => setOpened(openGap === gap.index ? null : { group, index: gap.index })}
              onPick={(type) => {
                setOpened(null)
                onInsert(type, placement(gap.index))
              }}
            />
          ))}

          {tree.blocks.length === 0 && (
            <EmptyPage
              options={insertable(null)}
              busy={busy}
              onInsert={(type) => onInsert(type, { index: 0 })}
            />
          )}
        </div>
      </div>
    </div>
  )
}
