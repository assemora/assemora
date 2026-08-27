/**
 * Closing what is floating over the canvas (SPEC.md §59, §123).
 *
 * The insertion menu closed on re-clicking the same `+`, on choosing something from
 * it, and when the selection moved to another group of siblings — and on nothing
 * else. Clicking another block, clicking in the Properties pane and Escape all left
 * it floating over the page; Escape even cleared the selection *underneath* it while
 * it stayed. A menu a person cannot put away is a menu they have to work around.
 *
 * A plain function rather than a hook, like the frame's own `connectCanvas`: the
 * window and the document are arguments, so what closes the menu can be tested
 * against a window that does not exist.
 */

/** The parts of a key press this reads. */
export type DismissKey = {
  readonly key: string
  stopPropagation(): void
}

/** The parts of a pointer press this reads. */
export type DismissPointer = {
  readonly target: unknown
}

export type Dismissal = {
  /** Studio's window, where its keyboard shortcuts are heard. */
  readonly view: {
    addEventListener(type: 'keydown', listener: (event: DismissKey) => void, capture: boolean): void
    removeEventListener(
      type: 'keydown',
      listener: (event: DismissKey) => void,
      capture: boolean,
    ): void
  }
  /** Studio's document, where a press anywhere in the editor is heard. */
  readonly page: {
    addEventListener(
      type: 'pointerdown',
      listener: (event: DismissPointer) => void,
      capture: boolean,
    ): void
    removeEventListener(
      type: 'pointerdown',
      listener: (event: DismissPointer) => void,
      capture: boolean,
    ): void
  }
  /**
   * What is floating, so a press inside it is not a press outside.
   *
   * The whole insertion point rather than the menu alone: the `+` that opened it
   * toggles, so closing on the way down would let the click that follows reopen it.
   */
  readonly holder: () => { contains(node: unknown): boolean } | null
  readonly close: () => void
}

export const dismissOn = ({ view, page, holder, close }: Dismissal): (() => void) => {
  const onPointerDown = (event: DismissPointer): void => {
    if (holder()?.contains(event.target) === true) return

    close()
  }

  const onKeyDown = (event: DismissKey): void => {
    if (event.key !== 'Escape') return

    // Escape dismisses the thing on top, and stops there. Studio's own Escape clears
    // the selection, and it listens on the window in the bubble phase — so stopping
    // the press here is what keeps one press from doing two things, and what keeps
    // the selection the menu was opened against.
    event.stopPropagation()
    close()
  }

  // Capture on both, so this runs before whatever the press was aimed at.
  view.addEventListener('keydown', onKeyDown, true)
  page.addEventListener('pointerdown', onPointerDown, true)

  return () => {
    view.removeEventListener('keydown', onKeyDown, true)
    page.removeEventListener('pointerdown', onPointerDown, true)
  }
}
