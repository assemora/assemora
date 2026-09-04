/**
 * A sentence the application wrote in one language or several (ADR-0031, amended).
 *
 * The registry carries a descriptor's words either as a string or as a map keyed by
 * language tag — `{ en: 'Largest file', uk: 'Найбільший файл' }`. Studio picks the
 * language it is being read in and falls back to the first the application wrote,
 * and it never translates: these are the application's words, and it is simply
 * allowed to have written them more than once (ADR-0030).
 *
 * Restated rather than imported from `@assemora/core`, the way every descriptor in
 * `api/introspection.ts` is: core is a server package.
 */
export type Said = string | Readonly<Record<string, string>>

export const said = (text: Said, language: string): string => {
  if (typeof text === 'string') return text

  return text[language] ?? Object.values(text)[0] ?? ''
}
