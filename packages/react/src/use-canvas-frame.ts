/**
 * The React wrapper around `connectCanvas` (SPEC.md §59, ADR-0018).
 *
 * It is a separate module because of one word at the top of it. A frame is a client
 * component by nature — it listens for messages and holds state — but the barrel that
 * exports it also exports `AssemoraPage`, which a Next.js *server* component renders
 * so that a visitor is sent HTML and no renderer. A hook in the same module as the
 * renderer makes the whole barrel a client boundary, and the server build refuses it:
 * "You're importing a module that depends on useEffect into a React Server
 * Component". Keeping `connectCanvas` plain and the hook over here is what lets one
 * package serve both halves.
 */
'use client'

import { useEffect, useRef } from 'react'

import { type CanvasFrame, connectCanvas, type UseCanvasFrameOptions } from './frame.js'

/**
 * `connectCanvas` for the frames that are React, which is all of them.
 *
 * ```tsx
 * const [tree, setTree] = useState(emptyTree())
 *
 * useCanvasFrame({ editing, editor, tree, render: setTree })
 * ```
 */
export const useCanvasFrame = ({ editing, editor, tree, render }: UseCanvasFrameOptions): void => {
  const frame = useRef<CanvasFrame | null>(null)
  const draw = useRef(render)

  useEffect(() => {
    draw.current = render
  }, [render])

  useEffect(() => {
    if (!editing) return

    // The callback is reached through a ref, so a frame that passes a new function on
    // every render does not tear the connection down and build it again — which would
    // cost the editor a fresh `assemora:ready` and a fresh geometry report each time.
    const canvas = connectCanvas({ editor, render: (next) => draw.current(next) })

    frame.current = canvas

    return () => {
      frame.current = null
      canvas.stop()
    }
  }, [editing, editor])

  // A timeout of zero rather than a layout effect: the boxes wanted are the ones the
  // browser has laid out, and that has not happened yet when React is done rendering.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measuring follows the render
  useEffect(() => {
    const timer = setTimeout(() => frame.current?.measure(), 0)

    return () => clearTimeout(timer)
  }, [tree])
}
