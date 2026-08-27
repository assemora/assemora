import { describe, expect, it } from 'vitest'

import { isTyping, type KeyPress, shortcutFor } from './keys.ts'

const press = (key: string, held: Partial<KeyPress> = {}): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...held,
})

describe('the builder keyboard (SPEC.md §123)', () => {
  it('takes ⌘ and Ctrl alike, rather than guessing at a platform', () => {
    expect(shortcutFor(press('z', { metaKey: true }))).toBe('undo')
    expect(shortcutFor(press('z', { ctrlKey: true }))).toBe('undo')
    expect(shortcutFor(press('Z', { metaKey: true, shiftKey: true }))).toBe('redo')
    expect(shortcutFor(press('z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(shortcutFor(press('y', { ctrlKey: true }))).toBe('redo')
  })

  it('removes and deselects on the bare keys', () => {
    expect(shortcutFor(press('Delete'))).toBe('remove')
    expect(shortcutFor(press('Backspace'))).toBe('remove')
    expect(shortcutFor(press('Escape'))).toBe('deselect')
  })

  it('moves the selection one place with Alt and an arrow', () => {
    expect(shortcutFor(press('ArrowUp', { altKey: true }))).toBe('move-up')
    expect(shortcutFor(press('ArrowDown', { altKey: true }))).toBe('move-down')
  })

  it('leaves the plain arrows to scroll the page', () => {
    expect(shortcutFor(press('ArrowUp'))).toBeUndefined()
    expect(shortcutFor(press('ArrowDown'))).toBeUndefined()
  })

  it('claims nothing it has no meaning for', () => {
    expect(shortcutFor(press('s', { metaKey: true }))).toBeUndefined()
    expect(shortcutFor(press('Delete', { metaKey: true }))).toBeUndefined()
    expect(shortcutFor(press('a'))).toBeUndefined()
  })
})

describe('what a person is typing into', () => {
  it('recognises the controls a headline is written in', () => {
    expect(isTyping({ tagName: 'INPUT' })).toBe(true)
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTyping({ tagName: 'SELECT' })).toBe(true)
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('leaves everything else to the shortcuts', () => {
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false)
    expect(isTyping({ tagName: 'DIV' })).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})
