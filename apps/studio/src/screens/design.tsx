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
import { Badge, Button, Card, Empty, Failure, Field, Input, Spinner } from '../ui/index.tsx'

const written = (value: TokenValue): string =>
  Array.isArray(value) ? value.join(', ') : String(value)

/** What one staged change will do, said in the words of the thing it changes. */
const describe = (draft: ThemeDraft, key: string): string => {
  const staged = draft.edits.get(key)

  if (staged !== null && staged !== undefined) return written(staged)

  const fallback = draft.defaults.get(key)

  if (fallback !== undefined) return `back to ${written(fallback)}`

  return groupOfKey(key)?.keys === undefined ? 'removed from the theme' : 'back to the default'
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
  const key = keyOf(group, name)
  const staged = draft.edits.has(key)
  const overridden = draft.overridden.has(key)
  const value = draft.tokens.get(key)
  const errors = errorsFor(draft, key)

  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_5rem] items-start gap-3 py-2">
      <div className="space-y-1 pt-2">
        <code className="block break-all font-mono text-xs">{name}</code>
        {staged ? <Badge tone="accent">unsaved</Badge> : overridden && <Badge>changed</Badge>}
      </div>

      <div className="space-y-1">
        {value === undefined && staged ? (
          // Staged for removal: there is nothing to edit, only something to take back.
          <p className="py-2 text-sm text-ink-faint">{describe(draft, key)}</p>
        ) : (
          <TokenInput kind={group.kind} value={value} onChange={(next) => draft.set(key, next)} />
        )}
        {errors?.map((error) => (
          <p key={error} className="text-xs text-danger">
            {error}
          </p>
        ))}
      </div>

      <div className="pt-1 text-right">
        {staged ? (
          <Button variant="ghost" size="sm" onClick={() => draft.revert(key)}>
            Undo
          </Button>
        ) : (
          overridden && (
            <Button
              variant="ghost"
              size="sm"
              title={
                draft.defaults.has(key)
                  ? 'Stop overriding it and take the default back'
                  : 'Take this token out of the theme'
              }
              onClick={() => draft.clear(key)}
            >
              {draft.defaults.has(key) ? 'Reset' : 'Remove'}
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
  const trimmed = name.trim()
  const problem =
    nameProblem(group, trimmed) ??
    (taken.includes(trimmed) ? 'The theme already has a token by that name' : undefined)

  return (
    <div className="flex items-end gap-2 border-t border-line-soft pt-3">
      <Field label="New token" {...(problem === undefined ? {} : { errors: [problem] })}>
        <Input
          value={name}
          placeholder="brand-accent"
          spellCheck={false}
          className="font-mono text-xs"
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
        Add
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

  return (
    <Card className="space-y-1 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        {nested === true ? (
          <h3 className="font-medium">{group.title}</h3>
        ) : (
          <h2 className="font-medium">{group.title}</h2>
        )}
        {group.keys === undefined ? (
          <Badge>your own names</Badge>
        ) : (
          <Badge tone="accent">fixed names</Badge>
        )}
      </div>
      <p className="pb-2 text-sm text-ink-soft">
        {group.help}
        {group.keys !== undefined && ' — a block names these, so none can be added or removed'}
      </p>

      <div className="divide-y divide-line-soft">
        {names.map((name) => (
          <Row key={name} draft={draft} group={group} name={name} />
        ))}
      </div>

      {names.length === 0 && <p className="py-3 text-sm text-ink-faint">Nothing here yet.</p>}

      {group.keys === undefined && <AddToken draft={draft} group={group} taken={names} />}
    </Card>
  )
}

const Pending = ({ draft }: { draft: ThemeDraft }) => (
  <Card className="space-y-2 border-accent/30 bg-accent-soft p-4">
    <p className="text-sm font-medium text-accent">
      {draft.edits.size} unsaved {draft.edits.size === 1 ? 'change' : 'changes'}
    </p>
    <ul className="space-y-1">
      {[...draft.edits.keys()].map((key) => (
        <li key={key} className="flex items-baseline gap-2 text-sm">
          <code className="font-mono text-xs">{key}</code>
          <span className="text-ink-soft">→ {describe(draft, key)}</span>
          <button
            type="button"
            className="text-xs text-ink-faint underline transition hover:text-ink"
            onClick={() => draft.revert(key)}
          >
            undo
          </button>
        </li>
      ))}
    </ul>
  </Card>
)

/**
 * An application without `theme()` has no tokens to edit.
 *
 * Asked of the registry rather than of a failed request, so the answer is a sentence
 * about the application rather than a 404 somebody has to interpret.
 */
const NotInstalled = () => (
  <Page title="Design">
    <Card className="p-6">
      <Empty title="This application has no theme">
        <p>
          Add <code className="font-mono">theme()</code> to its modules and the five groups of
          tokens appear here.
        </p>
        <pre className="mt-3 rounded-lg bg-surface-sunken p-3 text-left font-mono text-xs">
          {`import { theme } from '@assemora/theme'\n\nexport default createApplication({ modules: [theme(), pages()] })`}
        </pre>
      </Empty>
    </Card>
  </Page>
)

export const Design = () => {
  const draft = useThemeDraft()
  const introspection = useIntrospection()
  const { can } = useSession()
  const editable = can('theme.update')

  // Leaving with staged edits loses them, so leaving asks. `enableBeforeUnload` puts
  // the same question in the browser's own words for a reload or a closed tab, and
  // neither is registered at all while there is nothing to lose.
  const confirmLeaving = useCallback(
    () => !window.confirm('Your theme changes have not been saved. Leave the screen anyway?'),
    [],
  )

  useBlocker({
    disabled: draft.edits.size === 0,
    enableBeforeUnload: true,
    shouldBlockFn: confirmLeaving,
  })

  const installed = introspection.data?.commands?.some((entry) => entry.name === 'theme.update')

  if (introspection.data !== undefined && installed !== true) return <NotInstalled />

  if (draft.state === undefined) {
    return (
      <Page title="Design">{draft.isPending ? <Spinner /> : <Failure error={draft.error} />}</Page>
    )
  }

  const gone = removals(draft.edits, draft.defaults)

  const save = () => {
    // The one consequence a save can have that nothing on screen shows: a colour that
    // stops existing is a colour a block's background can still name (SPEC.md §61).
    if (
      gone.length > 0 &&
      !window.confirm(
        `Saving takes ${gone.join(', ')} out of the theme. A block whose background names one is drawn with no background at all. The change is a revision, so undo puts it back.`,
      )
    ) {
      return
    }

    void draft.save()
  }

  return (
    <Page
      title="Design"
      description="The tokens every page is drawn from. A block picks a name; this decides what it looks like"
      actions={
        <>
          {draft.state.version === 0 ? (
            <Badge>never edited</Badge>
          ) : (
            <Badge>v{draft.state.version}</Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={draft.edits.size === 0 || draft.busy}
            onClick={draft.discard}
          >
            Discard
          </Button>
          <Button
            size="sm"
            disabled={draft.edits.size === 0 || draft.busy || !editable}
            onClick={save}
          >
            {draft.busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {draft.failure !== undefined && (
        <Card className="mb-4 flex items-start gap-3 border-danger/30 bg-danger-soft p-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-danger">
              {draft.conflict
                ? 'Somebody else has changed the theme since this screen read it. Reloading takes their version and drops the changes listed below.'
                : draft.failure}
            </p>
            {Object.entries(draft.fields).map(([field, messages]) => (
              <p key={field} className="text-xs text-danger">
                <code className="font-mono">{field}</code> — {messages.join(', ')}
              </p>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={draft.conflict ? draft.reload : draft.dismiss}
          >
            {draft.conflict ? 'Reload' : 'Dismiss'}
          </Button>
        </Card>
      )}

      {!editable && (
        <Card className="mb-4 p-4">
          <p className="text-sm text-ink-soft">
            You can read the theme but not change it. Editing needs the{' '}
            <code className="font-mono">theme.update</code> permission.
          </p>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          {draft.edits.size > 0 && <Pending draft={draft} />}

          <Group draft={draft} group={COLORS} />

          <div className="space-y-4 pt-2">
            <div className="px-1">
              <h2 className="font-medium">Typography</h2>
              <p className="text-sm text-ink-soft">
                Four maps rather than one, so every entry holds a single kind of value and is
                checked as that kind
              </p>
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
          <p className="text-xs text-ink-faint">
            Drawn from the tokens above, under the names the generated stylesheet declares —{' '}
            {GROUPS.length} groups, {draft.tokens.size} tokens.
            {draft.updatedAt !== null &&
              ` Last saved ${new Date(draft.updatedAt).toLocaleString()}.`}
          </p>
        </div>
      </div>
    </Page>
  )
}
