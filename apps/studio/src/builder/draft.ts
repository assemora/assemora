/**
 * What the properties panel is holding (SPEC.md §60, §66).
 *
 * A person types into that panel while commands are in flight, and the application
 * answers every one of them with the whole tree. Two things have to be true at once:
 * what is being typed survives the echo of the edit before it, and a change this panel
 * did not make — an undo, an agent's proposal applied, another editor — replaces what
 * is in the form rather than leaving text the next keystroke would commit back over
 * it.
 *
 * Both follow from what the panel keeps: every send still waiting for its answer.
 * Content matching one of them is this panel's own edit coming home and changes
 * nothing; content matching none of them came from somewhere else, and refills the
 * form.
 *
 * It has to be *every* send rather than the last one. A person types faster than a
 * round trip, so two edits are in flight whenever the network is slower than the
 * typing pause. The answer to the first then arrives while the panel is holding the
 * second, and a panel that remembered one send read its own echo as somebody else's
 * change and refilled the form with the older text — measured live, "Alpha beta!"
 * typed and "Alpha!" left on the page.
 *
 * Until the builder stopped evicting its own query key, none of this was needed — the
 * panel was destroyed and rebuilt after every command, which refilled the form by
 * accident and cost a full remount of all three panes to do it.
 */

export type Props = Readonly<Record<string, unknown>>

export type Draft = {
  /** The block the form is showing, or nothing when there is no selection. */
  readonly blockId: string | undefined
  /** What the form shows now. */
  readonly values: Props
  /** The content the application is known to hold: what the form was filled from, or
   * the last send that came home. */
  readonly sent: Props
  /**
   * Every send still waiting for its answer, oldest first.
   *
   * A command that fails never answers, so its entry stays until the selection moves.
   * The cost of that is one refill declined, in the narrow case where the block later
   * comes to hold exactly the props of a send that was refused — much cheaper than
   * the alternative, which loses what somebody is typing on every slow round trip.
   */
  readonly outstanding: readonly Props[]
}

export type DraftAction =
  /** The selected block, as the application now has it. */
  | { readonly type: 'block'; readonly blockId: string | undefined; readonly props: Props }
  /** Somebody changed a field. */
  | { readonly type: 'edit'; readonly values: Props }
  /** These values are on their way to the application. */
  | { readonly type: 'sent'; readonly values: Props }

export const emptyDraft: Draft = {
  blockId: undefined,
  values: {},
  sent: {},
  outstanding: [],
}

/**
 * Whether two prop values say the same thing.
 *
 * By value rather than by reference: what comes back has crossed JSON, so nothing in
 * it is the object that was sent. Block props are the JSON a field declaration
 * produces, so objects, arrays and primitives are the whole vocabulary.
 */
export const sameContent = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameContent(entry, right[index]))
    )
  }

  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }

  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && sameContent(a[key], b[key]))
  )
}

/** The form as the application's own content, with nothing of this panel's in flight. */
const filledFrom = (blockId: string | undefined, props: Props): Draft => ({
  blockId,
  values: { ...props },
  sent: props,
  outstanding: [],
})

export const draftReducer = (state: Draft, action: DraftAction): Draft => {
  switch (action.type) {
    case 'edit':
      return { ...state, values: action.values }

    case 'sent':
      return { ...state, outstanding: [...state.outstanding, action.values] }

    case 'block': {
      // A different block always refills.
      if (state.blockId !== action.blockId) return filledFrom(action.blockId, action.props)

      const echo = state.outstanding.findIndex((values) => sameContent(values, action.props))

      // This panel's own edit coming home: what is being typed since is left alone.
      // Every send before the one that matched is retired with it, because the builder
      // sends one command at a time and their answers therefore arrive in order — so
      // an older send that has been overtaken is never coming back to be matched.
      if (echo !== -1) {
        return { ...state, sent: action.props, outstanding: state.outstanding.slice(echo + 1) }
      }

      // Nothing this panel did not already know about: a command it did not cause
      // (a design change, a move) answers with the whole tree, and its answer must
      // not land in the middle of a sentence.
      //
      // Only while nothing is in flight. With a send outstanding the block has moved
      // on from what this panel last saw acknowledged, so content equal to *that* is
      // a change back to it — an undo of the very edit in flight, which is the one
      // case where leaving the form alone would re-commit what was just undone.
      if (state.outstanding.length === 0 && sameContent(state.sent, action.props)) return state

      // Somebody else changed the block — an undo, an agent's proposal applied,
      // another editor. What is in the form is stale, and the next keystroke would
      // otherwise commit it back over them.
      return filledFrom(action.blockId, action.props)
    }
  }
}
