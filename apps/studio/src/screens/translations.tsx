/**
 * Which languages an entry is written in, and what to do about the ones it is not
 * (SPEC.md §131).
 *
 * §131 asks for three things of this bar and each is a separate refusal to mislead:
 * it shows which translations exist, which are out of date, and it **never presents a
 * fallback as though it were a translation**. The last is the one that matters — a form
 * showing Ukrainian text under a Russian language selector, with a Save button, is an
 * invitation to overwrite the original while believing you are translating it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { api } from '../api/client.ts'
import { useLocales } from '../api/locale.tsx'
import { Button } from '../ui/index.tsx'

type Translation = {
  readonly id: string
  readonly locale: string
  readonly isOriginal: boolean
  readonly updatedAt: string | null
  /** `null` where the model stamps no time, and so cannot be asked. */
  readonly stale: boolean | null
}

export const Translations = ({
  resource,
  id,
  entryLocale,
}: {
  resource: string
  id: string
  /** The language of the row on screen, which the read projects beside its id. */
  entryLocale: unknown
}) => {
  const { locales, locale, multilingual } = useLocales()
  const navigate = useNavigate()
  const client = useQueryClient()

  const known = useQuery({
    queryKey: ['translations', resource, id],
    queryFn: ({ signal }) =>
      api.query<{ translations: readonly Translation[] }>(
        'entries.translations',
        { resource, id },
        signal,
      ),
    enabled: multilingual,
  })

  const translate = useMutation({
    mutationFn: (into: string) =>
      api.command<{ id: string }>('entries.translate', { resource, id, locale: into }),
    onSuccess: async (made) => {
      await client.invalidateQueries({ queryKey: ['translations', resource, id] })
      await client.invalidateQueries({ queryKey: ['collection', resource] })
      await navigate({ to: '/content/$resource/$id', params: { resource, id: made.id } })
    },
  })

  const translations = known.data?.translations ?? []

  // A resource whose model is not translatable answers with nothing, and there is
  // nothing to draw: the bar exists per entry rather than per screen for exactly this
  // reason — Studio does not have to be told which resources are translatable.
  if (!multilingual || translations.length === 0) return null

  const at = (code: string) => translations.find((one) => one.locale === code)
  /**
   * Whether the row on screen is in a different language from the one being edited.
   *
   * This is the fallback case, and it is reached honestly: a listing in Russian answers
   * with the Ukrainian row for an entry nobody has translated, and opening it opens that
   * row. Saying so is the whole point — the alternative is a Russian-looking form full
   * of Ukrainian text.
   */
  const showing = typeof entryLocale === 'string' ? entryLocale : undefined
  const isFallback = showing !== undefined && locale !== undefined && showing !== locale

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Languages
        </span>

        {locales.map((code) => {
          const row = at(code)
          const here = row?.id === id

          if (row === undefined) {
            return (
              <Button
                key={code}
                variant="secondary"
                size="sm"
                disabled={translate.isPending}
                onClick={() => translate.mutate(code)}
              >
                {translate.isPending && translate.variables === code
                  ? `Translating into ${code}…`
                  : `Translate into ${code}`}
              </Button>
            )
          }

          return (
            <button
              key={code}
              type="button"
              disabled={here}
              onClick={() =>
                void navigate({ to: '/content/$resource/$id', params: { resource, id: row.id } })
              }
              className={
                here
                  ? 'rounded-lg bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent'
                  : 'rounded-lg px-2.5 py-1 text-sm text-ink-soft transition hover:bg-surface-sunken'
              }
            >
              {code}
              {/* Out of date is a claim, so it is only made where it can be: `stale` is
                  null on a model that stamps no time, and "I cannot tell" must not be
                  printed as "current". */}
              {row.stale === true && (
                <span className="ml-1.5 text-xs font-semibold text-danger">out of date</span>
              )}
            </button>
          )
        })}
      </div>

      {isFallback && (
        <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm">
          <p className="font-medium">
            This is the {showing} original, not a {locale} translation.
          </p>
          <p className="mt-0.5 text-ink-soft">
            Editing here changes what every language falls back to. To write it in {locale},
            translate it — the translation starts as a copy of this.
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            {translations.length} of {locales.length} languages written
          </p>
        </div>
      )}
    </div>
  )
}
