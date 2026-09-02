/**
 * Design (SPEC.md §58, §62).
 *
 * The five groups of the theme document, each editable, beside a sample drawn from
 * them. Studio holds no business logic the API does not have: this screen reads
 * `theme.get`, writes `theme.update`, and that is the whole of its relationship with
 * a theme (docs/rules/studio.md). What a token *means* is decided in one place, and
 * this is not that place — the generated stylesheet is.
 *
 * The two kinds of group are drawn differently on purpose. `spacing`, `radius` and
 * `container` are listed by their scale and have neither an "add" nor a "remove",
 * because a block addresses them by name and a theme that lost `xl` is a theme in
 * which `spacingTop: 'xl'` renders nothing. `colors` and `typography` can be added to
 * and taken from, because a site invents its own. A refused save is not how somebody
 * should learn which is which.
 */
import { useBlocker } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import type { TokenValue } from '../api/theme.ts'
import { Page } from '../app/shell.tsx'
import { namesIn, removals, type ThemeDraft, useThemeDraft } from '../design/draft.ts'
import { TokenInput } from '../design/inputs.tsx'
import { Preview } from '../design/preview.tsx'
import {
  blankValue,
  COLORS,
  CONTAINER,
  GROUPS,
  groupOfKey,
  keyOf,
  nameProblem,
  RADIUS,
  SPACING,
  type TokenGroup,
  TYPOGRAPHY,
} from '../design/tokens.ts'
import type { Translate } from '../i18n/messages.ts'
import { useDates, useT, useWoven } from '../i18n/translate.tsx'
import { Badge, Button, Card, Empty, Failure, Field, Input, Spinner } from '../ui/index.tsx'
import { SaveBar, Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'

const written = (value: TokenValue): string =>
  Array.isArray(value) ? value.join(', ') : String(value)

/** What one staged change will do, said in the words of the thing it changes. */
const describe = (draft: ThemeDraft, key: string, t: Translate): string => {
  const staged = draft.edits.get(key)

  if (staged !== null && staged !== undefined) return written(staged)

  const fallback = draft.defaults.get(key)

  if (fallback !== undefined) return t('design.backTo', { value: written(fallback) })

  return groupOfKey(key)?.keys === undefined
    ? t('design.removedFromTheme')
    : t('design.backToDefault')
}

/**
 * What the application said about this token, if it said anything.
 *
 * Two keys, because a command's input is validated twice on the way in: the HTTP
 * layer checks the body against the same schema and reports under `body.`, and a
 * handler that refuses the *resolved* document reports the path on its own.
 */
const errorsFor = (draft: ThemeDraft, key: string): readonly string[] | undefined =>
  draft.fields[key] ?? draft.fields[`body.${key}`]

const Row = ({ draft, group, name }: { draft: ThemeDraft; group: TokenGroup; name: string }) => {
  const t = useT()
  const key = keyOf(group, name)
  const staged = draft.edits.has(key)
  const overridden = draft.overridden.has(key)
  const value = draft.tokens.get(key)
  const errors = errorsFor(draft, key)

  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_5rem] items-start gap-3 py-2">
      <div className="space-y-1 pt-2">
        <code className="block break-all font-mono text-sm">{name}</code>
        {staged ? (
          <Badge tone="accent">{t('design.unsaved')}</Badge>
        ) : (
          overridden && <Badge>{t('design.changed')}</Badge>
        )}
      </div>

      <div className="space-y-1">
        {value === undefined && staged ? (
          // Staged for removal: there is nothing to edit, only something to take back.
          <p className="py-2 text-base text-ink-faint">{describe(draft, key, t)}</p>
        ) : (
          <TokenInput kind={group.kind} value={value} onChange={(next) => draft.set(key, next)} />
        )}
        {errors?.map((error) => (
          <p key={error} className="text-sm text-danger">
            {error}
          </p>
        ))}
      </div>

      <div className="pt-1 text-right">
        {staged ? (
          <Button variant="ghost" size="sm" onClick={() => draft.revert(key)}>
            {t('design.undo')}
          </Button>
        ) : (
          overridden && (
            <Button
              variant="ghost"
              size="sm"
              title={draft.defaults.has(key) ? t('design.resetTitle') : t('design.removeTitle')}
              onClick={() => draft.clear(key)}
            >
              {draft.defaults.has(key) ? t('design.reset') : t('common.remove')}
            </Button>
          )
        )}
      </div>
    </div>
  )
}

/** Only an open group has one of these: a fixed group's keys are the scale's. */
const AddToken = ({
  draft,
  group,
  taken,
}: {
  draft: ThemeDraft
  group: TokenGroup
  taken: readonly string[]
}) => {
  const [name, setName] = useState('')
  const t = useT()
  const trimmed = name.trim()
  const wrong = nameProblem(group, trimmed)
  const problem =
    wrong !== undefined ? t(wrong) : taken.includes(trimmed) ? t('design.nameTaken') : undefined

  return (
    <div className="flex items-end gap-2 border-t border-hairline pt-3">
      <Field label={t('design.newToken')} {...(problem === undefined ? {} : { errors: [problem] })}>
        <Input
          value={name}
          placeholder="brand-accent"
          spellCheck={false}
          className="font-mono text-sm"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Button
        variant="secondary"
        className="mb-0.5"
        disabled={trimmed === '' || problem !== undefined}
        onClick={() => {
          draft.set(keyOf(group, trimmed), blankValue(group.kind))
          setName('')
        }}
      >
        {t('row.add')}
      </Button>
    </div>
  )
}

const Group = ({
  draft,
  group,
  nested,
}: {
  draft: ThemeDraft
  group: TokenGroup
  /** True for the four typography maps, which sit under a heading of their own. */
  nested?: boolean
}) => {
  // Both sides, so a token staged for removal keeps its row — with the undo on it —
  // instead of disappearing the moment somebody presses Remove.
  const names =
    group.keys ??
    [...new Set([...namesIn(draft.base, group), ...namesIn(draft.tokens, group)])].sort()
  const t = useT()

  return (
    <Card className="space-y-1 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        {nested === true ? (
          <h3 className="font-medium">{t(group.title)}</h3>
        ) : (
          <h2 className="font-medium">{t(group.title)}</h2>
        )}
        {group.keys === undefined ? (
          <Badge>{t('design.openNames')}</Badge>
        ) : (
          <Badge tone="accent">{t('design.fixedNames')}</Badge>
        )}
      </div>
      <p className="pb-2 text-base text-ink-soft">
        {t(group.help)}
        {group.keys !== undefined && t('design.fixedNamesWhy')}
      </p>

      <div className="divide-y divide-hairline">
        {names.map((name) => (
          <Row key={name} draft={draft} group={group} name={name} />
        ))}
      </div>

      {names.length === 0 && (
        <p className="py-3 text-base text-ink-faint">{t('fields.nothingHereYet')}</p>
      )}

      {group.keys === undefined && <AddToken draft={draft} group={group} taken={names} />}
    </Card>
  )
}

const Pending = ({ draft }: { draft: ThemeDraft }) => {
  const t = useT()

  return (
    <Card className="space-y-2 border-accent/30 bg-accent-wash p-4">
      <p className="text-base font-medium text-accent-ink">
        {t('design.unsavedCount', { count: draft.edits.size })}
      </p>
      <ul className="space-y-1">
        {[...draft.edits.keys()].map((key) => (
          <li key={key} className="flex items-baseline gap-2 text-base">
            <code className="font-mono text-sm">{key}</code>
            <span className="text-ink-soft">→ {describe(draft, key, t)}</span>
            <button
              type="button"
              className="text-sm text-ink-faint underline transition hover:text-ink"
              onClick={() => draft.revert(key)}
            >
              {t('design.undoQuiet')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * An application without `theme()` has no tokens to edit.
 *
 * Asked of the registry rather than of a failed request, so the answer is a sentence
 * about the application rather than a 404 somebody has to interpret.
 */
const NotInstalled = () => {
  const t = useT()
  const woven = useWoven()

  return (
    <Page icon={<Palette className="size-5" />} title={t('nav.design')}>
      <Card className="p-6">
        <Empty title={t('design.noTheme')}>
          <p>{woven('design.noThemeBody', { call: <code className="font-mono">theme()</code> })}</p>
          <pre className="mt-3 rounded-lg bg-surface-sunken p-3 text-left font-mono text-sm">
            {`import { theme } from '@assemora/theme'\n\nexport default createApplication({ modules: [theme(), pages()] })`}
          </pre>
        </Empty>
      </Card>
    </Page>
  )
}

export const Design = () => {
  const draft = useThemeDraft()
  const introspection = useIntrospection()
  const { can } = useSession()
  const t = useT()
  const woven = useWoven()
  const dates = useDates()
  const editable = can('theme.update')

  // Leaving with staged edits loses them, so leaving asks. `enableBeforeUnload` puts
  // the same question in the browser's own words for a reload or a closed tab, and
  // neither is registered at all while there is nothing to lose.
  const confirmLeaving = useCallback(() => !window.confirm(t('design.confirmLeave')), [t])

  useBlocker({
    disabled: draft.edits.size === 0,
    enableBeforeUnload: true,
    shouldBlockFn: confirmLeaving,
  })

  const installed = introspection.data?.commands?.some((entry) => entry.name === 'theme.update')

  if (introspection.data !== undefined && installed !== true) return <NotInstalled />

  if (draft.state === undefined) {
    return (
      <Page icon={<Palette className="size-5" />} title={t('nav.design')}>
        {draft.isPending ? <Spinner /> : <Failure error={draft.error} />}
      </Page>
    )
  }

  const gone = removals(draft.edits, draft.defaults)

  const save = () => {
    // The one consequence a save can have that nothing on screen shows: a colour that
    // stops existing is a colour a block's background can still name (SPEC.md §61).
    if (
      gone.length > 0 &&
      !window.confirm(t('design.confirmRemoval', { names: gone.join(', ') }))
    ) {
      return
    }

    void draft.save()
  }

  const changed = [...draft.edits.keys()]

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<Palette className="size-5" />}
          title={t('nav.design')}
          description={t('design.lede')}
          badge={
            draft.state.version === 0 ? (
              <Badge>{t('design.neverEdited')}</Badge>
            ) : (
              <Badge>v{draft.state.version}</Badge>
            )
          }
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {draft.failure !== undefined && (
          <Card className="mb-4 flex items-start gap-3 border-danger/30 bg-danger-soft p-4">
            <div className="flex-1 space-y-1">
              <p className="text-base font-medium text-danger">
                {draft.conflict ? t('design.conflict') : draft.failure}
              </p>
              {Object.entries(draft.fields).map(([field, messages]) => (
                <p key={field} className="text-sm text-danger">
                  <code className="font-mono">{field}</code> — {messages.join(', ')}
                </p>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={draft.conflict ? draft.reload : draft.dismiss}
            >
              {draft.conflict ? t('builder.reload') : t('common.dismiss')}
            </Button>
          </Card>
        )}

        {!editable && (
          <Card className="mb-4 p-4">
            <p className="text-base text-ink-soft">
              {woven('design.readOnly', {
                permission: <code className="font-mono">theme.update</code>,
              })}
            </p>
          </Card>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <fieldset disabled={!editable} className="min-w-0 space-y-4">
            {draft.edits.size > 0 && <Pending draft={draft} />}

            <Group draft={draft} group={COLORS} />

            <div className="space-y-4 pt-2">
              <div className="px-1">
                <h2 className="font-medium">{t('design.typography')}</h2>
                <p className="text-base text-ink-soft">{t('design.typographyHelp')}</p>
              </div>
              {TYPOGRAPHY.map((group) => (
                <Group key={group.title} draft={draft} group={group} nested />
              ))}
            </div>

            <Group draft={draft} group={SPACING} />
            <Group draft={draft} group={RADIUS} />
            <Group draft={draft} group={CONTAINER} />
          </fieldset>

          <div className="sticky top-6 space-y-2">
            <Preview tokens={draft.tokens} cssVersion={draft.state.cssVersion} />
            <p className="text-sm text-ink-faint">
              {t('design.previewNote', {
                groups: GROUPS.length,
                tokens: draft.tokens.size,
              })}
              {draft.updatedAt !== null &&
                ` ${t('design.lastSaved', { when: dates.dateTime(draft.updatedAt) })}`}
            </p>
          </div>
        </div>
      </ScreenBody>

      {/* The theme is one form: nothing is written until this is pressed, and until then
          the bar names the tokens that are waiting. `theme.update` writes conditionally
          on the version it read, so a save that lost a race is a 409 rather than an
          overwrite (SPEC.md §66). */}
      <SaveBar
        dirty={changed.length > 0}
        summary={
          changed.length === 0
            ? t('entry.noChanges')
            : t('design.unsavedTokens', { count: changed.length })
        }
        {...(changed.length > 0 ? { detail: changed.join(' \u00b7 ') } : {})}
      >
        <Button
          variant="secondary"
          disabled={changed.length === 0 || draft.busy}
          onClick={draft.discard}
        >
          {t('entry.discard')}
        </Button>
        <Button busy={draft.busy} disabled={changed.length === 0 || !editable} onClick={save}>
          {t('entry.saveChanges')}
        </Button>
      </SaveBar>
    </Screen>
  )
}
