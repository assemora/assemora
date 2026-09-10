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
 * It follows that changing this sends no request to the *application*. Nothing on the
 * screen is re-fetched, because nothing the application holds depends on it — which is
 * exactly why this is a React context and the content locale is not: switching the
 * interface re-renders, and switching the content language invalidates every answer in
 * the cache. What it does fetch is the pack, a static file beside the bundle (ADR-0034).
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

import type { Readings } from './catalogue.ts'
import { HOLE, reading } from './catalogue.ts'
import type { Language, Offered } from './languages.ts'
import { preferred, SOURCE } from './languages.ts'
import { ENGLISH, NO_READINGS, offered, readingsOf } from './load.ts'
import { MESSAGES, type MessageKey, type Translate, translator, type Woven } from './messages.ts'

/**
 * Remembered per browser, because it is a preference rather than a fact anybody else
 * needs. Named `language` and not `locale`: `assemora.studio.locale` is the other
 * question and is already taken (see `api/locale.tsx`).
 */
const STORED = 'assemora.studio.language'

/**
 * How long to wait for the manifest before drawing in English anyway.
 *
 * The manifest and the packs are static files on the same origin as the bundle that is
 * already running, so in every ordinary case they answer in a few milliseconds and this
 * timer is never reached. It is here for the case that is not ordinary — a proxy that
 * swallows the request, a deployment serving the asset path as the index document — and
 * what it buys is that the failure is a Studio in English rather than no Studio at all.
 */
const PATIENCE = 1500

export type LanguageState = {
  /** Every language this deployment offers, English first. */
  readonly languages: readonly Offered[]
  /** The one being read. */
  readonly language: Language
  /** Its pack, or nothing where the language is English or the pack has not arrived. */
  readonly readings: Readings
  choose(language: Language): void
}

const ALONE: LanguageState = {
  languages: [ENGLISH],
  language: SOURCE,
  readings: NO_READINGS,
  choose: () => undefined,
}

/**
 * Exported so a screen can be drawn in a language that was decided rather than fetched.
 *
 * `LanguageProvider` reads the manifest and the pack over the network, which a test
 * rendering one screen has no business doing — and the default below is a deployment
 * offering English alone, which is a real state now (ADR-0034) and therefore the wrong
 * thing for a test about something else to fall into silently.
 */
export const LanguageContext = createContext<LanguageState>(ALONE)

type Settled = {
  readonly languages: readonly Offered[]
  readonly language: Language
  readonly readings: Readings
}

const SETTLED_ENGLISH: Settled = {
  languages: [ENGLISH],
  language: SOURCE,
  readings: NO_READINGS,
}

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [settled, setSettled] = useState<Settled>()

  /**
   * What a first visit opens in.
   *
   * A language chosen before is honoured only while it is still on offer: a deployment
   * that stopped offering Ukrainian must not leave the one person who picked it looking
   * at a screen whose switcher cannot get them back. Otherwise the browser's own
   * ordering decides, which is the one honest guess available before anybody has said.
   *
   * Read once, at mount, rather than watched: a person who changes their browser's
   * language list mid-session has not asked Studio to change, and a chosen language must
   * outlive the guess that preceded it.
   */
  useEffect(() => {
    let live = true

    void (async () => {
      const languages = await offered()
      const stored = localStorage.getItem(STORED)
      const language =
        stored !== null && languages.some((candidate) => candidate.tag === stored)
          ? stored
          : preferred(languages, navigator.languages)

      const readings = await readingsOf(language)

      if (live) setSettled({ languages, language, readings })
    })()

    const patience = setTimeout(() => {
      setSettled((held) => held ?? SETTLED_ENGLISH)
    }, PATIENCE)

    return () => {
      live = false
      clearTimeout(patience)
    }
  }, [])

  const language = settled?.language ?? SOURCE

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

  /**
   * The pack is fetched before the language changes, not after.
   *
   * So a switch is one repaint in the new language, rather than a repaint into English
   * followed by a second one when the file lands. A pack that cannot be fetched answers
   * with nothing, and the switch still happens: the person asked for Ukrainian and got
   * an English screen with a Ukrainian switcher, which is visibly wrong and recoverable.
   * Refusing to switch would be neither.
   */
  const choose = useCallback((next: Language) => {
    localStorage.setItem(STORED, next)

    void readingsOf(next).then((readings) => {
      setSettled((held) => (held === undefined ? held : { ...held, language: next, readings }))
    })
  }, [])

  const state = useMemo<LanguageState>(
    () => ({
      languages: settled?.languages ?? ALONE.languages,
      language,
      readings: settled?.readings ?? NO_READINGS,
      choose,
    }),
    [settled, language, choose],
  )

  // Nothing until the language is known, which is a paint rather than a wait: the
  // alternative is a screen that draws in English and changes under the reader.
  if (settled === undefined) return null

  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>
}

export const useLanguage = (): LanguageState => useContext(LanguageContext)

/**
 * One sentence, in the language being read.
 *
 * A hook rather than the module-level function a storefront can afford, because Studio
 * changes language without navigating: a component holding a `t` from the render before
 * the switch would go on saying the previous language until something else re-rendered
 * it, and which components those are is not a list anybody can keep.
 */
export const useT = (): Translate => {
  const { language, readings } = useContext(LanguageContext)

  return useMemo(() => translator(language, readings), [language, readings])
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
  const { language, readings } = useContext(LanguageContext)

  return useMemo(
    () =>
      ((key: MessageKey, values: Readonly<Record<string, ReactNode>> = {}) => {
        const text = reading(language, MESSAGES[key], readings[key], values.count)
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
    [language, readings],
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
  const { language } = useContext(LanguageContext)

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
