/**
 * The language Studio is speaking, and how a screen asks for a sentence in it.
 *
 * Beside `api/locale.tsx` and deliberately not part of it. That file holds the language
 * the *content* is in — a fact about the deployment, read from the Schema Registry, and
 * the thing every listing and every form on the screen is *about*. This holds the
 * language the *interface* is in, which is a fact about the person reading it. They are
 * routinely different: the shop is Ukrainian and its developer reads English; the shop
 * is English and the person filling the menu in reads Ukrainian. One control for two
 * questions would be wrong for both.
 *
 * It follows that changing this sends no request. Nothing on the screen is re-fetched,
 * because nothing the application holds depends on it — which is exactly why this is a
 * React context and the content locale is not: switching the interface re-renders, and
 * switching the content language invalidates every answer in the cache.
 */
import {
  createContext,
  createElement,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { HOLE, reading } from './catalogue.ts'
import { isLanguage, LANGUAGES, type Language, preferred, SOURCE } from './languages.ts'
import { MESSAGES, type MessageKey, type Translate, translator, type Woven } from './messages.ts'

/**
 * Remembered per browser, because it is a preference rather than a fact anybody else
 * needs. Named `language` and not `locale`: `assemora.studio.locale` is the other
 * question and is already taken (see `api/locale.tsx`).
 */
const STORED = 'assemora.studio.language'

export type LanguageState = {
  /** Every language this build of Studio was written in. */
  readonly languages: readonly Language[]
  /** The one being read. */
  readonly language: Language
  choose(language: Language): void
}

const Context = createContext<LanguageState>({
  languages: LANGUAGES,
  language: SOURCE,
  choose: () => undefined,
})

/**
 * What a first visit opens in.
 *
 * Read once, at mount, rather than watched: a person who changes their browser's
 * language list mid-session has not asked Studio to change, and a chosen language must
 * outlive the guess that preceded it.
 */
const opening = (): Language => {
  const stored = localStorage.getItem(STORED)

  if (stored !== null && isLanguage(stored)) return stored

  return preferred(navigator.languages)
}

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(opening)

  /**
   * The document says which language it is in.
   *
   * Not decoration: a screen reader chooses a voice from it, a browser decides whether
   * to offer a translation from it, and `lang` is what CSS hyphenation and quotation
   * marks are selected by. It is one line and it is wrong on every page until it is
   * written.
   */
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const choose = useCallback((next: Language) => {
    localStorage.setItem(STORED, next)
    setLanguage(next)
  }, [])

  const state = useMemo<LanguageState>(
    () => ({ languages: LANGUAGES, language, choose }),
    [language, choose],
  )

  return <Context.Provider value={state}>{children}</Context.Provider>
}

export const useLanguage = (): LanguageState => useContext(Context)

/**
 * One sentence, in the language being read.
 *
 * A hook rather than the module-level function a storefront can afford, because Studio
 * changes language without navigating: a component holding a `t` from the render before
 * the switch would go on saying the previous language until something else re-rendered
 * it, and which components those are is not a list anybody can keep.
 */
export const useT = (): Translate => {
  const { language } = useContext(Context)

  return useMemo(() => translator(language), [language])
}

/**
 * A sentence with something drawn into the middle of it.
 *
 * `useT` answers with a string and is what almost every call wants. This is for the few
 * that put a node inside a sentence — the name to type in a confirmation, a path in
 * mono, a link — and it exists so that such a sentence stays *one* message. Split into
 * a prefix and a suffix it stops being translatable: the hole sits mid-sentence in one
 * language and at the end in another, and no pair of fragments can be both.
 */
export const useWoven = (): Woven => {
  const { language } = useContext(Context)

  return useMemo(
    () =>
      ((key: MessageKey, values: Readonly<Record<string, ReactNode>> = {}) => {
        const text = reading(language, MESSAGES[key], values.count)
        const parts: ReactNode[] = []
        let seen = 0

        // `split` on a capturing group hands back the pieces and the hole names
        // alternately, so an odd index is a name and an even one is the text around it.
        for (const [index, piece] of text.split(HOLE).entries()) {
          if (index % 2 === 0) {
            if (piece !== '') parts.push(piece)
            continue
          }

          const value = values[piece]

          // A key that names the hole rather than its position, so React is not asked
          // to keep an index. A message repeating one hole gets `word`, `word2`.
          seen += 1
          parts.push(createElement(Fragment, { key: `${piece}${seen}` }, value ?? `{${piece}}`))
        }

        return createElement(Fragment, null, ...parts)
      }) as Woven,
    [language],
  )
}

/**
 * A date, written the way the language being read writes one.
 *
 * `toLocaleDateString()` with no argument follows the *browser*, so an interface set to
 * Ukrainian printed `12/31/2025` for anybody whose machine is American. The language on
 * the screen is the one that decides.
 *
 * `date` and `day` differ by what the value *is*, not by how it looks. An instant —
 * `updatedAt`, `createdAt` — is read on the reader's clock, which is what `date` does. A
 * calendar day is not an instant: it is stored as midnight UTC, and read on a clock
 * behind UTC that is the evening before, so `day` reads it where it was written.
 * Formatting a birthday locally moves it a day for every reader in the Americas.
 */
export const useDates = (): {
  date(value: string): string
  day(value: string): string
  dateTime(value: string): string
  time(value: string): string
} => {
  const { language } = useContext(Context)

  return useMemo(
    () => ({
      date: (value) => new Date(value).toLocaleDateString(language),
      day: (value) => new Date(value).toLocaleDateString(language, { timeZone: 'UTC' }),
      dateTime: (value) => new Date(value).toLocaleString(language),
      time: (value) => new Date(value).toLocaleTimeString(language),
    }),
    [language],
  )
}

export type { MessageKey }
