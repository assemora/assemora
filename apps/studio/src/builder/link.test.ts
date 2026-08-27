import type { BlockRect } from '@assemora/react'
import { describe, expect, it } from 'vitest'

import {
  type CanvasHandlers,
  type CanvasMessage,
  listenToCanvas,
  nothingSelected,
  reportedByCanvas,
  revealFor,
  type Selection,
} from './link.ts'

/** Studio's window, as much of it as the listener touches. */
const editorWindow = () => {
  const listeners: ((event: CanvasMessage) => void)[] = []

  return {
    listeners,
    addEventListener: (_type: 'message', listener: (event: CanvasMessage) => void) => {
      listeners.push(listener)
    },
    removeEventListener: (_type: 'message', listener: (event: CanvasMessage) => void) => {
      const at = listeners.indexOf(listener)

      if (at !== -1) listeners.splice(at, 1)
    },
    deliver: (event: CanvasMessage) => {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

const heard = () => {
  const calls: string[] = []
  const on: CanvasHandlers = {
    ready: () => calls.push('ready'),
    selected: (blockId) => calls.push(`selected:${blockId}`),
    hovered: (blockId) => calls.push(`hovered:${blockId}`),
    geometry: (blocks) => calls.push(`geometry:${blocks.length}`),
    pressed: (press) => calls.push(`pressed:${press.key}`),
  }

  return { calls, on }
}

const ORIGIN = 'https://studio.example'

const listening = () => {
  const view = editorWindow()
  const { calls, on } = heard()
  const frame = { name: 'the canvas frame' }
  const stop = listenToCanvas({ view, frame: () => frame, origin: ORIGIN, on })

  return { view, calls, frame, stop }
}

const from = (frame: unknown, data: unknown, origin: string = ORIGIN): CanvasMessage => ({
  origin,
  source: frame,
  data,
})

describe('listening to the canvas frame (SPEC.md §59)', () => {
  it('routes every message the protocol declares', () => {
    const { view, calls, frame } = listening()
    const blocks: readonly BlockRect[] = [{ id: 'a', top: 0, left: 0, width: 10, height: 10 }]

    view.deliver(from(frame, { type: 'assemora:ready' }))
    view.deliver(from(frame, { type: 'assemora:selected', blockId: 'a' }))
    view.deliver(from(frame, { type: 'assemora:hovered', blockId: null }))
    view.deliver(from(frame, { type: 'assemora:geometry', blocks }))

    expect(calls).toEqual(['ready', 'selected:a', 'hovered:null', 'geometry:1'])
  })

  /**
   * Finding 2: a key pressed inside the canvas reached nobody. The frame forwards it
   * now, and this is the end that has to be listening.
   */
  it('hands on a key pressed inside the frame', () => {
    const { view, calls, frame } = listening()

    view.deliver(
      from(frame, {
        type: 'assemora:pressed',
        press: { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
      }),
    )

    expect(calls).toEqual(['pressed:z'])
  })

  it('answers nobody but the frame it was given, from the origin it was given', () => {
    const { view, calls, frame } = listening()

    view.deliver(from({ name: 'another frame' }, { type: 'assemora:ready' }))
    view.deliver(from(frame, { type: 'assemora:ready' }, 'https://evil.example'))

    expect(calls).toEqual([])
  })

  /**
   * An iframe has no `contentWindow` until it has mounted, and a message can carry no
   * source at all. Comparing the two directly let one match the other.
   */
  it('answers nothing at all while there is no frame', () => {
    const view = editorWindow()
    const { calls, on } = heard()

    listenToCanvas({ view, frame: () => null, origin: ORIGIN, on })
    view.deliver(from(null, { type: 'assemora:ready' }))

    expect(calls).toEqual([])
  })

  it('ignores anything that is not an event of this protocol', () => {
    const { view, calls, frame } = listening()

    // The editor's own instruction, posted back at it.
    view.deliver(from(frame, { type: 'assemora:render', tree: { blocks: [] }, selected: null }))
    view.deliver(from(frame, { type: 'webpackHotUpdate' }))
    view.deliver(from(frame, 'assemora:ready'))
    view.deliver(from(frame, null))

    expect(calls).toEqual([])
  })

  it('stops listening when it is told to', () => {
    const { view, calls, frame, stop } = listening()

    stop()
    view.deliver(from(frame, { type: 'assemora:ready' }))

    expect(calls).toEqual([])
    expect(view.listeners).toHaveLength(0)
  })
})

describe('scrolling to the selection (SPEC.md §59)', () => {
  const reveal = (state: Selection, selected: string | null) => revealFor(state, selected)

  it('leaves the page alone for a block clicked on the canvas', () => {
    const clicked = reportedByCanvas(nothingSelected, 'hero')

    expect(reveal(clicked, 'hero').reveal).toBe(false)
  })

  it('scrolls to a block chosen in the outline', () => {
    expect(reveal(nothingSelected, 'hero').reveal).toBe(true)
  })

  /**
   * Finding 3, measured live on a 2210px page: a canvas click on the first hero, and
   * that block alone was never scrolled to again for the life of the page. The flag
   * described one selection and outlived it.
   */
  it('does not go on suppressing the block that was clicked once', () => {
    let state = reportedByCanvas(nothingSelected, 'hero')

    // The click itself: already on screen, so nothing scrolls.
    const click = reveal(state, 'hero')

    state = click.next

    // Away in the outline, and back again.
    const away = reveal(state, 'last')

    state = away.next

    const back = reveal(state, 'hero')

    expect([click.reveal, away.reveal, back.reveal]).toEqual([false, true, true])
  })

  it('reveals a selection once, however often it is asked', () => {
    const first = reveal(nothingSelected, 'hero')
    const again = reveal(first.next, 'hero')

    expect([first.reveal, again.reveal]).toEqual([true, false])
  })

  it('forgets everything when the selection is cleared, so the same block reveals again', () => {
    const clicked = reveal(reportedByCanvas(nothingSelected, 'hero'), 'hero')
    const cleared = reveal(clicked.next, null)

    expect(cleared.next).toEqual(nothingSelected)
    expect(reveal(cleared.next, 'hero').reveal).toBe(true)
  })
})
