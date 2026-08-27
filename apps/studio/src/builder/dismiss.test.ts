import { describe, expect, it } from 'vitest'

import { type DismissKey, type DismissPointer, dismissOn } from './dismiss.ts'

type Listener = { readonly type: string; readonly listener: (event: never) => void }

/** A window and a document, as much of either as the dismissal touches. */
const editor = () => {
  const attached: Listener[] = []

  const target = {
    attached,
    addEventListener: (type: string, listener: (event: never) => void, capture: boolean) => {
      expect(capture).toBe(true)
      attached.push({ type, listener })
    },
    removeEventListener: (type: string, listener: (event: never) => void) => {
      const at = attached.findIndex((entry) => entry.type === type && entry.listener === listener)

      if (at !== -1) attached.splice(at, 1)
    },
  }

  return target
}

const inside = { name: 'the open insertion point' }

const opened = () => {
  const closed: number[] = []
  const view = editor()
  const page = editor()
  const stop = dismissOn({
    view,
    page,
    holder: () => ({ contains: (node: unknown) => node === inside }),
    close: () => closed.push(closed.length),
  })

  const press = (key: string) => {
    const stopped: string[] = []
    const event: DismissKey = { key, stopPropagation: () => stopped.push(key) }

    for (const entry of view.attached) (entry.listener as (event: DismissKey) => void)(event)

    return stopped
  }

  const click = (target: unknown) => {
    const event: DismissPointer = { target }

    for (const entry of page.attached) (entry.listener as (event: DismissPointer) => void)(event)
  }

  return { closed, view, page, stop, press, click }
}

describe('closing what floats over the canvas (SPEC.md §59)', () => {
  it('closes on a press anywhere but inside it', () => {
    const menu = opened()

    menu.click({ name: 'the Properties pane' })

    expect(menu.closed).toHaveLength(1)
  })

  /**
   * The `+` that opened the menu toggles. Closing on the way down would leave the
   * click that follows to reopen what it was meant to close.
   */
  it('leaves a press inside it alone', () => {
    const menu = opened()

    menu.click(inside)

    expect(menu.closed).toHaveLength(0)
  })

  /**
   * Finding 6: Escape deselected the block underneath while the menu floated on.
   * Studio's own Escape listens on the window in the bubble phase, so stopping the
   * press here — the returned list is what `stopPropagation` was called with — is
   * what keeps one press from meaning two things.
   */
  it('closes on Escape, and keeps the selection it was opened against', () => {
    const menu = opened()

    expect(menu.press('Escape')).toEqual(['Escape'])
    expect(menu.closed).toHaveLength(1)
  })

  it('claims no key but Escape', () => {
    const menu = opened()

    expect(menu.press('Delete')).toEqual([])
    expect(menu.press('z')).toEqual([])
    expect(menu.closed).toHaveLength(0)
  })

  it('detaches everything it attached', () => {
    const menu = opened()

    menu.stop()
    menu.press('Escape')
    menu.click({ name: 'anywhere' })

    expect(menu.closed).toHaveLength(0)
    expect(menu.view.attached).toHaveLength(0)
    expect(menu.page.attached).toHaveLength(0)
  })
})
