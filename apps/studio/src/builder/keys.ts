/**
 * The builder's keyboard (SPEC.md §60, §123).
 *
 * Every shortcut here runs a command a button already runs. The keyboard is a second
 * way to *ask*, never a second way to do — nothing in this file knows what undo means.
 */

export type Shortcut = 'undo' | 'redo' | 'remove' | 'deselect' | 'move-up' | 'move-down'

/** The parts of a key event a shortcut is decided by. */
export type KeyPress = {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Whether the keypress belongs to something a person is typing into.
 *
 * A half-written headline is work, and Delete must never be the key that loses it.
 * Structural rather than `instanceof HTMLElement`: an element inside the canvas frame
 * belongs to another document, where that check is false.
 */
export const isTyping = (target: unknown): boolean => {
  if (typeof target !== 'object' || target === null) return false

  const element = target as { tagName?: unknown; isContentEditable?: unknown }

  return (
    element.isContentEditable === true ||
    (typeof element.tagName === 'string' && TYPING.has(element.tagName))
  )
}

/**
 * Which builder shortcut a keypress is, if any.
 *
 * ⌘ and Ctrl are both accepted on every platform rather than one being picked by
 * sniffing for a Mac. A browser reports both modifiers plainly, the wrong guess fails
 * silently — the person presses the chord they have pressed for twenty years and
 * nothing happens — and nothing else in Studio binds either one. Redo is that chord
 * with Shift on both platforms, and Ctrl+Y as well, because that is what Windows calls
 * it and a habit should not have to be unlearned to use a page builder.
 *
 * Alt with an arrow moves the selected block one place. Plain arrows are left alone:
 * they scroll, and taking that away from a page three screens tall to save one
 * modifier is a bad trade.
 */
export const shortcutFor = (event: KeyPress): Shortcut | undefined => {
  const key = event.key.toLowerCase()

  if (event.metaKey || event.ctrlKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'

    return undefined
  }

  if (event.altKey) {
    if (key === 'arrowup') return 'move-up'
    if (key === 'arrowdown') return 'move-down'

    return undefined
  }

  if (key === 'escape') return 'deselect'
  if (key === 'delete' || key === 'backspace') return 'remove'

  return undefined
}
