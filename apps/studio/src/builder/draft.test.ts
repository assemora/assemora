import { describe, expect, it } from 'vitest'

import { type Draft, draftReducer, emptyDraft, sameContent } from './draft.ts'

const filled = (blockId: string, props: Record<string, unknown>): Draft =>
  draftReducer(emptyDraft, { type: 'block', blockId, props })

describe('what the properties panel is holding', () => {
  it('fills from the block it is shown', () => {
    expect(filled('a', { title: 'Build visually' })).toEqual({
      blockId: 'a',
      values: { title: 'Build visually' },
      sent: { title: 'Build visually' },
      outstanding: [],
    })
  })

  it('refills from scratch when the selection changes', () => {
    const other = draftReducer(filled('a', { title: 'One' }), {
      type: 'block',
      blockId: 'b',
      props: { title: 'Two' },
    })

    expect(other.values).toEqual({ title: 'Two' })
  })

  /**
   * The reason the panel needed a memory at all: until the builder stopped evicting
   * its own query key, every command destroyed and rebuilt this panel, which refilled
   * the form by accident.
   */
  it('leaves what is being typed alone when its own edit comes home', () => {
    const started = filled('a', { title: '' })
    const typed = draftReducer(started, { type: 'edit', values: { title: 'B' } })
    const sent = draftReducer(typed, { type: 'sent', values: { title: 'B' } })
    // The person keeps typing while that command is in flight.
    const typedMore = draftReducer(sent, { type: 'edit', values: { title: 'Build' } })

    const answered = draftReducer(typedMore, {
      type: 'block',
      blockId: 'a',
      props: { title: 'B' },
    })

    // By reference: the answer retires the send it belongs to, and moves nothing a
    // person can see.
    expect(answered.values).toBe(typedMore.values)
    expect(answered.values).toEqual({ title: 'Build' })
    expect(answered.outstanding).toEqual([])
  })

  /**
   * The defect this file was written to catch and did not: it modelled exactly one
   * outstanding send.
   *
   * Anything slower than the typing pause puts two edits in flight. The answer to the
   * first then arrives while the panel is holding the second, and a panel that
   * remembered one send read its own echo as somebody else's change and refilled the
   * form with the older text. Typed live: "Alpha beta!". Left on the page: "Alpha!".
   */
  it('holds every send in flight, not just the last one', () => {
    let draft = filled('a', { title: '' })

    draft = draftReducer(draft, { type: 'edit', values: { title: 'Alpha' } })
    draft = draftReducer(draft, { type: 'sent', values: { title: 'Alpha' } })
    draft = draftReducer(draft, { type: 'edit', values: { title: 'Alpha beta' } })
    draft = draftReducer(draft, { type: 'sent', values: { title: 'Alpha beta' } })

    // The first command answers, two sends deep.
    draft = draftReducer(draft, { type: 'block', blockId: 'a', props: { title: 'Alpha' } })

    expect(draft.values).toEqual({ title: 'Alpha beta' })

    // And then the second, which is the last word on the block.
    draft = draftReducer(draft, { type: 'block', blockId: 'a', props: { title: 'Alpha beta' } })

    expect(draft.values).toEqual({ title: 'Alpha beta' })
    expect(draft.outstanding).toEqual([])
  })

  /**
   * An echo out of order is not a thing the builder can produce — it sends one command
   * at a time — so an answer matching an older send says the ones before it will never
   * be matched. Keeping them would leave a stale entry able to swallow a real refill.
   */
  it('retires the sends an answer overtook', () => {
    let draft = filled('a', { title: 'One' })

    draft = draftReducer(draft, { type: 'sent', values: { title: 'Two' } })
    draft = draftReducer(draft, { type: 'sent', values: { title: 'Three' } })
    draft = draftReducer(draft, { type: 'edit', values: { title: 'Four' } })
    draft = draftReducer(draft, { type: 'block', blockId: 'a', props: { title: 'Three' } })

    expect(draft.outstanding).toEqual([])
    expect(draft.values).toEqual({ title: 'Four' })
  })

  it('still refills when an undo lands between two sends', () => {
    let draft = filled('a', { title: 'Alpha' })

    draft = draftReducer(draft, { type: 'edit', values: { title: 'Alpha beta' } })
    draft = draftReducer(draft, { type: 'sent', values: { title: 'Alpha beta' } })
    // Not the echo of anything this panel sent: the block was put back as it was.
    draft = draftReducer(draft, { type: 'block', blockId: 'a', props: { title: '' } })

    expect(draft.values).toEqual({ title: '' })
    expect(draft.outstanding).toEqual([])
  })

  it('refills when the block changed under it — an undo, or another editor', () => {
    const started = filled('a', { title: 'Build visually' })
    const typed = draftReducer(started, { type: 'edit', values: { title: 'Build fast' } })
    const sent = draftReducer(typed, { type: 'sent', values: { title: 'Build fast' } })

    const undone = draftReducer(sent, {
      type: 'block',
      blockId: 'a',
      props: { title: 'Build visually' },
    })

    expect(undone.values).toEqual({ title: 'Build visually' })
    expect(undone.sent).toEqual({ title: 'Build visually' })
  })

  it('holds still while a command it did not cause is answered', () => {
    // A design change bumps the block without touching its props, and the answer to
    // it must not land in the middle of a sentence.
    const typed = draftReducer(filled('a', { title: 'One' }), {
      type: 'edit',
      values: { title: 'One more' },
    })

    expect(draftReducer(typed, { type: 'block', blockId: 'a', props: { title: 'One' } })).toBe(
      typed,
    )
  })
})

describe('whether two prop values say the same thing', () => {
  it('compares by value, because the answer has crossed JSON', () => {
    expect(sameContent({ a: 1 }, { a: 1 })).toBe(true)
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameContent({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameContent({ a: 1, b: undefined }, { a: 1 })).toBe(false)
  })

  it('goes through arrays and nested objects', () => {
    expect(sameContent({ items: [{ id: 'a' }] }, { items: [{ id: 'a' }] })).toBe(true)
    expect(sameContent({ items: [{ id: 'a' }] }, { items: [{ id: 'b' }] })).toBe(false)
    expect(sameContent({ items: [1, 2] }, { items: [2, 1] })).toBe(false)
  })

  it('does not mistake null for an object', () => {
    expect(sameContent({ image: null }, { image: {} })).toBe(false)
    expect(sameContent({ image: null }, { image: null })).toBe(true)
  })
})
