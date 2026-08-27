import type { BlockTree } from '@assemora/schema'
import { describe, expect, it, vi } from 'vitest'

import {
  type CanvasEvent,
  type CanvasInstruction,
  isCanvasEvent,
  isCanvasInstruction,
  sendToCanvas,
} from './canvas.js'

const tree: BlockTree = { blocks: [] }

/**
 * The names, written out.
 *
 * Both ends of a `postMessage` match on a string, so a rename is a silent breaking
 * change: the sender goes on sending, the receiver goes on dropping, and every type
 * still checks because the union changed on both sides at once. `assemora:select`
 * became `assemora:reveal` with nothing guarding either direction. These two lists
 * are what a rename now has to be deliberate about.
 */
const EVENT_NAMES = [
  'assemora:ready',
  'assemora:selected',
  'assemora:hovered',
  'assemora:pressed',
  'assemora:geometry',
] as const

const INSTRUCTION_NAMES = ['assemora:render', 'assemora:reveal', 'assemora:measure'] as const

const events: readonly CanvasEvent[] = [
  { type: 'assemora:ready' },
  { type: 'assemora:selected', blockId: 'a' },
  { type: 'assemora:hovered', blockId: null },
  {
    type: 'assemora:pressed',
    press: { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
  },
  { type: 'assemora:geometry', blocks: [{ id: 'a', top: 0, left: 0, width: 10, height: 10 }] },
]

const instructions: readonly CanvasInstruction[] = [
  { type: 'assemora:render', tree, selected: null },
  { type: 'assemora:reveal', blockId: 'a' },
  { type: 'assemora:measure' },
]

describe('the canvas protocol', () => {
  it('names exactly the events the frame may send', () => {
    expect(events.map((event) => event.type)).toEqual([...EVENT_NAMES])

    for (const type of EVENT_NAMES) expect(isCanvasEvent({ type })).toBe(true)
  })

  it('names exactly the instructions the editor may send', () => {
    expect(instructions.map((instruction) => instruction.type)).toEqual([...INSTRUCTION_NAMES])

    for (const type of INSTRUCTION_NAMES) expect(isCanvasInstruction({ type })).toBe(true)
  })

  it('recognises every event it declares', () => {
    for (const event of events) expect(isCanvasEvent(event)).toBe(true)
  })

  it('recognises every instruction it declares', () => {
    for (const instruction of instructions) expect(isCanvasInstruction(instruction)).toBe(true)
  })

  it('will not read an instruction as an event, nor an event as an instruction', () => {
    // A window receives whatever anyone sends it, this frame's own messages included.
    // "Starts with assemora:" would let the editor answer itself.
    for (const instruction of instructions) expect(isCanvasEvent(instruction)).toBe(false)
    for (const event of events) expect(isCanvasInstruction(event)).toBe(false)
  })

  it('knows nothing called assemora:select', () => {
    // The rename, from the other side: `select` said "this is selected", which
    // `assemora:render` already carries. Two statements of one fact may disagree.
    expect(isCanvasInstruction({ type: 'assemora:select', blockId: 'a' })).toBe(false)
    expect(isCanvasEvent({ type: 'assemora:select', blockId: 'a' })).toBe(false)
  })

  it('refuses anything that is not one of its messages', () => {
    for (const value of [null, undefined, 'assemora:ready', 42, [], {}, { type: 7 }]) {
      expect(isCanvasEvent(value)).toBe(false)
      expect(isCanvasInstruction(value)).toBe(false)
    }
  })
})

describe('sending an instruction into a frame', () => {
  const frameOf = (postMessage: (message: unknown, origin: string) => void) =>
    ({ postMessage }) as unknown as Window

  it('posts it to the origin it was given', () => {
    const postMessage = vi.fn()
    const instruction: CanvasInstruction = { type: 'assemora:reveal', blockId: 'a' }

    sendToCanvas(frameOf(postMessage), instruction, 'https://studio.example')

    expect(postMessage).toHaveBeenCalledWith(instruction, 'https://studio.example')
  })

  it('never posts to every origin at once', () => {
    // A canvas holds a logged-in page, and a frame may be somewhere other than where
    // the editor thinks it is: `'*'` hands the tree to whoever is actually there
    // (SPEC.md §85).
    const postMessage = vi.fn()

    sendToCanvas(frameOf(postMessage), { type: 'assemora:measure' }, 'https://studio.example')

    expect(postMessage.mock.calls.map((call) => call[1])).not.toContain('*')
  })

  it('says nothing to a frame that is not there', () => {
    expect(() =>
      sendToCanvas(null, { type: 'assemora:measure' }, 'https://studio.example'),
    ).not.toThrow()
    expect(() =>
      sendToCanvas(undefined, { type: 'assemora:measure' }, 'https://studio.example'),
    ).not.toThrow()
  })
})
