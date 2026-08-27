/**
 * What the Design screen is holding, and how it changes it (SPEC.md §62, §66).
 *
 * Every edit is staged and nothing is sent until somebody saves, because a theme is a
 * handful of values that are read together: changing a brand colour and the type
 * scale in one act is one decision, and one revision. The save is `theme.update` and
 * nothing else — Studio has no second way to change a token, exactly as it has no
 * second way to move a block (docs/rules/studio.md).
 *
 * A document is carried flat here — `colors.brand`, `typography.sizes.2xl` — because
 * every question the screen asks is about one token: is it overridden, is it pending,
 * what would it be if it were reset. The nesting the command wants is rebuilt on the
 * way out, once, in `patchOf`.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import { type ThemeState, type TokenValue, useTheme } from '../api/theme.ts'
import { GROUPS, groupOfKey, keyOf, sameValue, type TokenGroup, valuesOf } from './tokens.ts'

/** A document, one entry per token. */
export type TokenMap = ReadonlyMap<string, TokenValue>

/** A staged change: a value to set, or `null` to stop overriding the token. */
export type Edits = ReadonlyMap<string, TokenValue | null>

export const flatten = (document: unknown): TokenMap => {
  const flat = new Map<string, TokenValue>()

  for (const group of GROUPS) {
    for (const [name, value] of Object.entries(valuesOf(document, group))) {
      flat.set(keyOf(group, name), value)
    }
  }

  return flat
}

/** The tokens of one group that a document actually holds, in the order to show them. */
export const namesIn = (tokens: TokenMap, group: TokenGroup): readonly string[] => {
  if (group.keys !== undefined) return group.keys

  const prefix = `${group.path.join('.')}.`

  return [...tokens.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort()
}

/**
 * The tokens the framework provides, as far as this session can prove it.
 *
 * A token that resolves with no override standing over it *is* its default, and that
 * is the only way to learn one: `theme.get` answers with the overrides and the
 * resolved document, not with the defaults behind them. So the answer is known for
 * every token nobody has changed, and unknown for one that is currently overridden —
 * which the screen says rather than guesses.
 */
export const defaultsOf = (state: ThemeState): TokenMap => {
  const overridden = flatten(state.overrides)
  const found = new Map<string, TokenValue>()

  for (const [key, value] of flatten(state.tokens)) {
    if (!overridden.has(key)) found.set(key, value)
  }

  return found
}

/**
 * The document as it would be, with the staged changes applied.
 *
 * A cleared token whose default this session knows resolves to it. One it does not
 * know is a guess either way, so the guess follows the group: a fixed key cannot be
 * lost — the command requires every step of the scale — so the value on screen stays
 * and the row says it is going back to the default; an open key can be lost, so it
 * goes, and the preview shows what a page would look like without it.
 */
export const previewOf = (base: TokenMap, edits: Edits, defaults: TokenMap): TokenMap => {
  const preview = new Map(base)

  for (const [key, value] of edits) {
    if (value !== null) {
      preview.set(key, value)
      continue
    }

    const fallback = defaults.get(key)

    if (fallback !== undefined) preview.set(key, fallback)
    else if (groupOfKey(key)?.keys === undefined) preview.delete(key)
  }

  return preview
}

/**
 * The staged clears that end with the token gone rather than reset.
 *
 * What the save has to say out loud: a colour that stops existing is a colour a
 * block's background can still name (SPEC.md §61), and that block will draw with no
 * background at all.
 */
export const removals = (edits: Edits, defaults: TokenMap): readonly string[] =>
  [...edits]
    .filter(([key, value]) => value === null && !defaults.has(key))
    .map(([key]) => key)
    .filter((key) => groupOfKey(key)?.keys === undefined)

/** The staged changes, as the nested shape `theme.update` accepts. */
export const patchOf = (edits: Edits): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}

  for (const [key, value] of edits) {
    const steps = key.split('.')
    const leaf = steps.pop()

    if (leaf === undefined) continue

    let node = patch

    for (const step of steps) {
      const existing = node[step]

      if (typeof existing === 'object' && existing !== null) {
        node = existing as Record<string, unknown>
      } else {
        const created: Record<string, unknown> = {}

        node[step] = created
        node = created
      }
    }

    node[leaf] = value
  }

  return patch
}

export type ThemeDraft = {
  readonly state: ThemeState | undefined
  readonly updatedAt: string | null
  /** The document the preview draws: what is saved, with what is staged on top. */
  readonly tokens: TokenMap
  /** The document as it is saved. What a staged change is a change *from*. */
  readonly base: TokenMap
  readonly edits: Edits
  readonly defaults: TokenMap
  readonly overridden: TokenMap
  readonly busy: boolean
  readonly conflict: boolean
  readonly failure: string | undefined
  readonly fields: Readonly<Record<string, readonly string[]>>
  readonly isPending: boolean
  readonly error: unknown
  set(key: string, value: TokenValue): void
  /** Stop overriding a token, or drop one that was only ever staged. */
  clear(key: string): void
  /** Take back one staged change. */
  revert(key: string): void
  discard(): void
  reload(): void
  dismiss(): void
  save(): Promise<void>
}

const EMPTY: TokenMap = new Map()

export const useThemeDraft = (): ThemeDraft => {
  const client = useQueryClient()
  const theme = useTheme()
  const [state, setState] = useState<ThemeState>()
  const [edits, setEdits] = useState<Edits>(new Map())
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [fields, setFields] = useState<Readonly<Record<string, readonly string[]>>>({})

  /**
   * Every default this session has watched resolve.
   *
   * It only ever grows, because a token seen resolving without an override does not
   * stop having that default when somebody overrides it — and that is the moment the
   * screen needs the value, to show what a reset would put back.
   */
  const learned = useRef(new Map<string, TokenValue>())

  const absorb = useCallback((answer: ThemeState) => {
    for (const [key, value] of defaultsOf(answer)) learned.current.set(key, value)

    setState(answer)
  }, [])

  useEffect(() => {
    if (theme.data !== undefined) absorb(theme.data)
  }, [theme.data, absorb])

  const base = useMemo(() => (state === undefined ? EMPTY : flatten(state.tokens)), [state])
  const overridden = useMemo(
    () => (state === undefined ? EMPTY : flatten(state.overrides)),
    [state],
  )
  const defaults = learned.current
  const tokens = useMemo(() => previewOf(base, edits, defaults), [base, edits, defaults])

  const set = useCallback(
    (key: string, value: TokenValue) => {
      setEdits((current) => {
        const next = new Map(current)

        // Typing a token's own value back is not a change, and a save that carries it
        // would write a revision saying nothing happened.
        if (sameValue(base.get(key), value)) next.delete(key)
        else next.set(key, value)

        return next
      })
    },
    [base],
  )

  const clear = useCallback(
    (key: string) => {
      setEdits((current) => {
        const next = new Map(current)

        // A token that exists only as a staged edit is removed by taking the edit
        // back. Sending `null` for one the row never held would be a patch about
        // nothing.
        if (overridden.has(key)) next.set(key, null)
        else next.delete(key)

        return next
      })
    },
    [overridden],
  )

  const revert = useCallback((key: string) => {
    setEdits((current) => {
      const next = new Map(current)

      next.delete(key)

      return next
    })
  }, [])

  const discard = useCallback(() => {
    setEdits(new Map())
    setFailure(undefined)
    setFields({})
    setConflict(false)
  }, [])

  const reload = useCallback(() => {
    discard()
    void client.invalidateQueries({ queryKey: ['theme'] })
  }, [client, discard])

  const dismiss = useCallback(() => {
    setFailure(undefined)
    setFields({})
  }, [])

  const save = useCallback(async () => {
    if (state === undefined || edits.size === 0) return

    setBusy(true)

    try {
      const answer = await api.command<ThemeState>('theme.update', {
        ...patchOf(edits),
        // Stated always, including the 0 an application that has never been edited
        // answers with: a second editor's newer theme has to come back as a conflict
        // rather than be overwritten (SPEC.md §66).
        expectedVersion: state.version,
      })

      absorb(answer)
      setEdits(new Map())
      setFailure(undefined)
      setFields({})
      setConflict(false)

      // By prefix, so it reaches the generated stylesheet under `['theme',
      // 'stylesheet']` too: a colour added here is a background the builder offers.
      // `updatedAt` is only on the read, which is the other reason.
      await client.invalidateQueries({ queryKey: ['theme'] })
    } catch (error) {
      if (error instanceof ApiError) {
        setConflict(error.status === 409)
        setFields(error.fields)
      }

      setFailure(error instanceof Error ? error.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }, [absorb, client, edits, state])

  return {
    state,
    updatedAt: theme.data?.updatedAt ?? null,
    tokens,
    base,
    edits,
    defaults,
    overridden,
    busy,
    conflict,
    failure,
    fields,
    isPending: theme.isPending,
    error: theme.error,
    set,
    clear,
    revert,
    discard,
    reload,
    dismiss,
    save,
  }
}
