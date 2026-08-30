/**
 * The language Studio is editing in (SPEC.md §131).
 *
 * A deployment that serves several languages holds each entry as one row per language,
 * and a read is scoped to the language of the request. So "which language am I looking
 * at" is not a preference about Studio — it decides which rows the whole screen is
 * about, which is why it lives beside the session rather than in a settings page.
 *
 * The set comes from the Schema Registry like everything else here: an application that
 * configures no locales has no switcher, and nothing about Studio changes for it.
 */
import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import { speak } from './client.ts'
import { useIntrospection } from './introspection.ts'

/** Remembered per browser, because it is where somebody left off rather than a setting. */
const STORED = 'assemora.studio.locale'

export type LocaleState = {
  /** Every language this deployment serves, in the order it declared them. */
  readonly locales: readonly string[]
  /** The one a missing translation falls back to. */
  readonly defaultLocale: string | undefined
  /** The one being edited, or `undefined` in an application that serves one language. */
  readonly locale: string | undefined
  /** Whether there is a choice to make at all. */
  readonly multilingual: boolean
  choose(locale: string): void
}

/**
 * What a component outside the provider reads: one language, which is no choice at all.
 *
 * Not `null` and a thrown error. "No provider above me" and "this deployment serves one
 * language" are the same state as far as every screen is concerned — both mean there is
 * no switcher, no fallback badge and no language in a URL — so the default is the honest
 * answer rather than a placeholder. It also means a component can be rendered on its own,
 * in a test or in isolation, without being wrapped in a provider to say nothing.
 */
const ALONE: LocaleState = {
  locales: [],
  defaultLocale: undefined,
  locale: undefined,
  multilingual: false,
  choose: () => undefined,
}

const Context = createContext<LocaleState>(ALONE)

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const introspection = useIntrospection()
  const client = useQueryClient()
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(STORED))

  const declared = introspection.data?.locales ?? []
  const locales = declared.map((entry) => entry.name)
  const defaultLocale = declared.find((entry) => entry.default)?.name ?? locales[0]

  /**
   * A remembered language this deployment no longer serves is not an error to report —
   * it is a locale that was removed from the configuration while somebody had Studio
   * open in another tab. Falling back to the default is what a person expects.
   */
  const locale = chosen !== null && locales.includes(chosen) ? chosen : defaultLocale

  // Before anything renders, so the request a screen makes on this pass already carries
  // it. Set during render rather than in an effect for the reason the storefront's
  // router does the same: a screen that learned the language one render late would have
  // fetched the previous one's answer.
  speak(locale, defaultLocale)

  const choose = useCallback(
    (next: string) => {
      localStorage.setItem(STORED, next)
      /**
       * Before the invalidation below, not after the re-render it causes.
       *
       * `invalidateQueries` starts the refetches synchronously, and the provider has not
       * re-rendered yet — so the render-time `speak` further up has not run for the new
       * language. Measured: switching Studio to Russian refetched the page listing in
       * Ukrainian and showed the Ukrainian rows under a Russian selector.
       */
      speak(next, defaultLocale)
      setChosen(next)
      /**
       * Everything, not the content screens.
       *
       * Every cached answer was fetched in the other language — a listing, an entry, a
       * page, the count in a heading. Marking the whole cache stale is one line and is
       * exactly true; picking which queries are language-dependent would be a list that
       * goes wrong the first time somebody adds a screen.
       */
      void client.invalidateQueries()
    },
    [client, defaultLocale],
  )

  /**
   * The list is rebuilt on every render from the introspection answer, so it is a new
   * array each time with the same contents. Keyed on the joined codes, the memo holds
   * across renders instead of being one.
   */
  const codes = locales.join(',')

  const state = useMemo<LocaleState>(
    () => ({
      locales: codes === '' ? [] : codes.split(','),
      defaultLocale,
      locale,
      multilingual: codes.includes(','),
      choose,
    }),
    [codes, defaultLocale, locale, choose],
  )

  return <Context.Provider value={state}>{children}</Context.Provider>
}

export const useLocales = (): LocaleState => useContext(Context)
