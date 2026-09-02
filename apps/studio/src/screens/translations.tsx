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
import { useT } from '../i18n/translate.tsx'
import { Button } from '../ui/index.tsx'

type Translation = {
  readonly id: string
  readonly locale: string
  readonly isOriginal: boolean
  readonly updatedAt: string | null
  /** `null` where the model stamps no time, and so cannot be asked. */
  readonly stale: boolean | null
}

/**
 * The two things that have languages, and what they are called.
 *
 * A page is not a resource — it has its own commands and its own screens — so the bar
 * is told which of the two it is drawing rather than being given four names. There are
 * exactly two, and there is no third coming: a collection cannot be translatable at all
 * (ADR-0028).
 */
const NAMES = {
  entry: { read: 'entries.translations', write: 'entries.translate', to: '/content/$resource/$id' },
  page: { read: 'pages.translations', write: 'pages.translate', to: '/pages/$id' },
} as const

export const Translations = ({
  subject = 'entry',
  resource,
  id,
  entryLocale,
}: {
  subject?: keyof typeof NAMES
  /** The resource an entry belongs to. Absent for a page. */
  resource?: string
  id: string
  /** The language of the row on screen, which the read projects beside its id. */
  entryLocale: unknown
}) => {
  const { locales, locale, multilingual } = useLocales()
  const navigate = useNavigate()
  const client = useQueryClient()
  const t = useT()

  const names = NAMES[subject]
  const of = resource === undefined ? { id } : { resource, id }

  const known = useQuery({
    queryKey: ['translations', subject, resource, id],
    queryFn: ({ signal }) =>
      api.query<{ translations: readonly Translation[] }>(names.read, of, signal),
    enabled: multilingual,
  })

  const goTo = async (to: string) =>
    resource === undefined
      ? navigate({ to: '/pages/$id', params: { id: to } })
      : navigate({ to: '/content/$resource/$id', params: { resource, id: to } })

  const translate = useMutation({
    mutationFn: (into: string) => api.command<{ id: string }>(names.write, { ...of, locale: into }),
    onSuccess: async (made) => {
      await client.invalidateQueries({ queryKey: ['translations', subject, resource, id] })
      await client.invalidateQueries({
        queryKey: [resource === undefined ? 'pages' : 'collection'],
      })
      await goTo(made.id)
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
          {t('translations.languages')}
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
                  ? t('translations.translating', { locale: code })
                  : t('translations.translateInto', { locale: code })}
              </Button>
            )
          }

          return (
            <button
              key={code}
              type="button"
              disabled={here}
              onClick={() => void goTo(row.id)}
              className={
                here
                  ? 'rounded-lg bg-accent-wash px-2.5 py-1 text-base font-medium text-accent-ink'
                  : 'rounded-lg px-2.5 py-1 text-base text-ink-soft transition hover:bg-surface-sunken'
              }
            >
              {code}
              {/* Out of date is a claim, so it is only made where it can be: `stale` is
                  null on a model that stamps no time, and "I cannot tell" must not be
                  printed as "current". */}
              {row.stale === true && (
                <span className="ml-1.5 text-sm font-semibold text-danger">
                  {t('translations.stale')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isFallback && (
        <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-base">
          <p className="font-medium">{t('translations.isOriginal', { origin: showing, locale })}</p>
          <p className="mt-0.5 text-ink-soft">{t('translations.fallbackWarning', { locale })}</p>
          <p className="mt-2 text-sm text-ink-faint">
            {t('translations.written', {
              written: translations.length,
              count: locales.length,
            })}
          </p>
        </div>
      )}
    </div>
  )
}
