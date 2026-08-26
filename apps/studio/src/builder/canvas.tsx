/**
 * The canvas (SPEC.md §59).
 *
 * An iframe running the application's own frontend. CSS is isolated, the components
 * that draw are the ones a visitor gets, and a responsive preview is a real viewport
 * rather than a simulation.
 *
 * Studio never reaches inside it. It sends the tree in and gets geometry and clicks
 * back, and draws its own selection outline on top — so nothing Studio does changes
 * what the page looks like.
 */
import { type BlockRect, type CanvasEvent, isCanvasEvent } from '@assemora/react'
import type { BlockTree } from '@assemora/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

export const VIEWPORTS = {
  desktop: { label: 'Desktop', width: 0 },
  tablet: { label: 'Tablet', width: 834 },
  mobile: { label: 'Mobile', width: 390 },
} as const

export type ViewportName = keyof typeof VIEWPORTS

export const Canvas = ({
  pageId,
  tree,
  selected,
  viewport,
  onSelect,
}: {
  pageId: string
  tree: BlockTree
  selected: string | null
  viewport: ViewportName
  onSelect(blockId: string | null): void
}) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const [rects, setRects] = useState<readonly BlockRect[]>([])
  const [ready, setReady] = useState(false)

  // The frame is served from this origin, so it is the only one either end speaks to.
  const send = useCallback((instruction: unknown) => {
    frame.current?.contentWindow?.postMessage(instruction, location.origin)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) return
      if (event.source !== frame.current?.contentWindow) return
      if (!isCanvasEvent(event.data)) return

      const message = event.data as CanvasEvent

      if (message.type === 'assemora:ready') setReady(true)
      if (message.type === 'assemora:selected') onSelect(message.blockId)
      if (message.type === 'assemora:geometry') setRects(message.blocks)
    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)
  }, [onSelect])

  // Every edit is drawn by handing the frame the tree the command answered with.
  useEffect(() => {
    if (ready) send({ type: 'assemora:render', tree, selected })
  }, [ready, tree, selected, send])

  const width = VIEWPORTS[viewport].width
  const box = rects.find((rect) => rect.id === selected)

  return (
    <div className="relative flex-1 overflow-auto bg-surface-sunken p-6">
      <div
        className="relative mx-auto h-full bg-surface shadow-sm transition-[width]"
        style={{ width: width === 0 ? '100%' : `${width}px` }}
      >
        <iframe
          ref={frame}
          title="Page preview"
          className="size-full border-0"
          src={`/preview?page=${pageId}&mode=draft&editing=1&editor=${encodeURIComponent(location.origin)}`}
        />

        {box !== undefined && (
          <div
            className="pointer-events-none absolute rounded-sm outline-2 outline-offset-1 outline-accent"
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
            }}
          />
        )}
      </div>
    </div>
  )
}
