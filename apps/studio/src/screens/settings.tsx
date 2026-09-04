/**
 * Settings (`design_handoff_studio_redesign` §5).
 *
 * Three levels of grouping: sections in the sidebar, decision blocks, setting rows.
 * The sidebar searches across *every* group and rewrites itself to the ones that
 * answer, with a hit count; the content column is one group at a time; the save bar is
 * one form for the whole screen rather than forty autosaves.
 *
 * A mode rather than a screen in the shell, the way the page builder is: it takes the
 * whole window and puts its own chrome where Studio's bar would have been, with a way
 * back to Studio in it. The prototype draws it that way, and a settings screen nested
 * under the sidebar would have two navigations on one screen deciding the same thing.
 *
 * What the groups hold is not decided here. They are the `settings` section of the
 * Schema Registry (ADR-0031), declared by the umbrella for what only it knows and by
 * any module for its own, and this file draws whatever arrives the way the sidebar
 * draws whatever resources arrive: it has no list of groups, no idea what a group
 * contains, and no address of the server's in it. The words in a group are the
 * application's and are printed as they arrive, like a resource's label.
 *
 * One group is Studio's own: which language it speaks, a fact about the person reading
 * and not about the deployment (ADR-0030). It is the one row a reader decides on this
 * screen, and it goes through the same save bar.
 */
import { Link, useBlocker, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Building2, FileText, Server, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import {
  type SettingBlockDescriptor,
  type SettingSection,
  type SettingsGroupDescriptor,
  useIntrospection,
} from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Avatar } from '../app/shell.tsx'
import { isLanguage, LANGUAGE_NAMES } from '../i18n/languages.ts'
import { useLanguage, useT } from '../i18n/translate.tsx'
import { said } from '../settings/said.ts'
import { hitsOf, matches } from '../settings/search.ts'
import { ResourceIcon } from '../ui/icons.tsx'
import { Button, Failure, join, LinkButton, SearchField, Segmented, Spinner } from '../ui/index.tsx'
import { SaveBar } from '../ui/layout.tsx'
import { Logo } from '../ui/logo.tsx'

/** The three headings of the sidebar, in the order the prototype draws them. */
const SECTIONS: readonly SettingSection[] = ['workspace', 'content', 'platform']

const SECTION_LABELS = {
  workspace: 'settings.section.workspace',
  content: 'settings.section.content',
  platform: 'settings.section.platform',
} as const

/** What the scope pill draws beside a group's title: where in the system it lives. */
const SECTION_ICONS: Readonly<Record<SettingSection, ReactNode>> = {
  workspace: <Building2 className="size-3.5" />,
  content: <FileText className="size-3.5" />,
  platform: <Server className="size-3.5" />,
}

/** Studio's own group is addressed by this, and its one row by the key below. */
const STUDIO_GROUP = 'studio'
const STUDIO_LANGUAGE = 'studio.language'

/**
 * A row as this screen draws it: the registry's two kinds, plus the one Studio's own
 * group needs. The registry has no `segmented` on purpose — a setting somebody changes
 * is a command's input — so the kind exists here and nowhere below.
 */
type Row = { readonly key: string; readonly label: string; readonly help?: string } & (
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'link'; readonly href: string; readonly action: string }
  | {
      readonly kind: 'segmented'
      readonly value: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
    }
)

type Block = {
  readonly title: string
  readonly note?: string
  readonly locked?: boolean
  readonly rows: readonly Row[]
}

type Group = Omit<SettingsGroupDescriptor, 'label' | 'blurb' | 'blocks'> & {
  readonly label: string
  readonly blurb?: string
  readonly blocks: readonly Block[]
}

/**
 * A descriptor in the language on screen.
 *
 * Every word the application wrote is picked here, once, and the rest of the screen
 * holds strings: the search, the sidebar and the rows never see a map.
 */
const spoken = (
  { label, blurb, blocks, ...group }: SettingsGroupDescriptor,
  language: string,
): Group => ({
  ...group,
  label: said(label, language),
  ...(blurb === undefined ? {} : { blurb: said(blurb, language) }),
  blocks: blocks.map(
    (block: SettingBlockDescriptor): Block => ({
      title: said(block.title, language),
      ...(block.note === undefined ? {} : { note: said(block.note, language) }),
      ...(block.locked === undefined ? {} : { locked: block.locked }),
      rows: block.rows.map((row): Row => {
        const words = {
          key: row.key,
          label: said(row.label, language),
          ...(row.help === undefined ? {} : { help: said(row.help, language) }),
        }

        return row.kind === 'value'
          ? { ...words, kind: 'value', value: said(row.value, language) }
          : { ...words, kind: 'link', href: row.href, action: said(row.action, language) }
      }),
    }),
  ),
})

/* ---------------------------------------------------------------------------- rows */

/** Label and help on the left, the control right-aligned at the width its kind takes. */
const RowView = ({
  row,
  first,
  staged,
  onStage,
}: {
  row: Row
  first: boolean
  staged: string | undefined
  onStage(key: string, value: string): void
}) => (
  <div className={join('px-[18px] py-4', !first && 'border-t border-hairline')}>
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 text-base font-semibold">{row.label}</span>
        {row.help !== undefined && (
          <p className="mt-[3px] max-w-[56ch] text-sm leading-[1.45] text-ink-subdued">
            {row.help}
          </p>
        )}
      </div>

      <div
        className={join(
          'flex shrink-0 items-center justify-end',
          row.kind === 'value' && 'max-w-[260px]',
          row.kind === 'segmented' && 'max-w-[320px]',
        )}
      >
        {row.kind === 'value' && (
          <span className="flex items-center gap-2 font-mono text-sm text-ink-soft">
            {row.value}
          </span>
        )}
        {row.kind === 'link' && (
          <LinkButton variant="secondary" href={row.href} target="_blank" rel="noopener">
            {row.action}
          </LinkButton>
        )}
        {row.kind === 'segmented' && (
          <Segmented
            value={staged ?? row.value}
            options={row.options}
            onChange={(next) => onStage(row.key, next)}
            label={row.label}
          />
        )}
      </div>
    </div>
  </div>
)

const BlockView = ({
  block,
  rows,
  staged,
  onStage,
}: {
  block: Block
  /** The rows still standing after the search, which is why they are not `block.rows`. */
  rows: readonly Row[]
  staged: Readonly<Record<string, string>>
  onStage(key: string, value: string): void
}) => {
  const t = useT()

  return (
    <section className="pt-[26px]">
      <div className="flex items-baseline gap-2.5">
        <h3 className="text-base font-[650]">{block.title}</h3>
        {block.locked === true && (
          <span className="rounded-full bg-canvas px-2 py-px font-mono text-xs text-ink-soft">
            {t('settings.locked')}
          </span>
        )}
      </div>
      {block.note !== undefined && (
        <p className="mt-1.5 max-w-[62ch] text-sm leading-[1.45] text-ink-subdued">{block.note}</p>
      )}

      <div className="mt-3 rounded-xl border border-line">
        {rows.map((row, index) => (
          <RowView
            key={row.key}
            row={row}
            first={index === 0}
            staged={staged[row.key]}
            onStage={onStage}
          />
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------- sidebar */

const GroupButton = ({
  group,
  current,
  badge,
  onClick,
}: {
  group: Group
  current: boolean
  badge: string | undefined
  onClick(): void
}) => (
  <li>
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      className={join(
        'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left',
        current && 'bg-canvas',
      )}
    >
      <ResourceIcon name={group.icon} className="size-[17px] shrink-0 text-ink-soft" />
      <span
        className={join(
          'min-w-0 flex-1 truncate text-base',
          current ? 'font-[650] text-ink' : 'font-medium text-ink-body',
        )}
      >
        {group.label}
      </span>
      {badge !== undefined && badge !== '' && (
        <span className="shrink-0 rounded-full bg-canvas px-[7px] py-px text-xs font-[650] text-ink-soft">
          {badge}
        </span>
      )}
    </button>
  </li>
)

/* ---------------------------------------------------------------------------- screen */

/**
 * Every group on the screen: the registry's, then Studio's own.
 *
 * The registry's arrive as they are. Studio's is built here because its words are
 * Studio's and its one value is read from this browser rather than from any server.
 */
const useGroups = (): { groups: readonly Group[]; ready: boolean; failure: unknown } => {
  const introspection = useIntrospection()
  const { language, languages } = useLanguage()
  const t = useT()

  const groups = useMemo<Group[]>(() => {
    const studio: Group = {
      name: STUDIO_GROUP,
      section: 'workspace',
      label: t('settings.studio'),
      blurb: t('settings.studio.blurb'),
      icon: 'settings-2',
      blocks: [
        {
          title: t('settings.studio'),
          note: t('settings.studio.note'),
          rows: [
            {
              key: STUDIO_LANGUAGE,
              kind: 'segmented',
              label: t('account.interface'),
              help: t('settings.language.help'),
              value: language,
              options: languages.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] })),
            },
          ],
        },
      ],
    }

    return [...(introspection.data?.settings ?? []).map((group) => spoken(group, language)), studio]
  }, [introspection.data, language, languages, t])

  // A registry that could not be read is said, not shown as one lonely group: the
  // reader would otherwise take Studio's own row for the whole of the settings.
  return { groups, ready: !introspection.isPending, failure: introspection.error ?? undefined }
}

export const Settings = () => {
  const navigate = useNavigate()
  const { group: asked } = useSearch({ from: '/settings' })
  const { viewer } = useSession()
  const { choose } = useLanguage()
  const { groups, ready, failure } = useGroups()
  const t = useT()
  const [query, setQuery] = useState('')
  /** What the reader changed and has not saved, by setting key. */
  const [staged, setStaged] = useState<Readonly<Record<string, string>>>({})

  /**
   * The groups as the sidebar orders them: by section, then as the registry answered.
   * The fallback is the first of *these*, so an address naming no group opens what the
   * reader sees at the top — the registry's own order puts whichever module booted
   * last wherever it fell, and that is not a first anybody chose.
   */
  const ordered = useMemo(
    () => SECTIONS.flatMap((section) => groups.filter((one) => one.section === section)),
    [groups],
  )
  const group = ordered.find((one) => one.name === asked) ?? ordered[0]

  const spoken = useMemo(
    () =>
      groups.map((one) => ({
        key: one.name,
        label: one.label,
        rows: one.blocks.flatMap((block) =>
          block.rows.map((row) => ({ label: row.label, help: row.help ?? '' })),
        ),
      })),
    [groups],
  )

  const searching = query.trim() !== ''
  const hits = hitsOf(spoken, query)
  const dirty = Object.keys(staged)

  const stage = (key: string, value: string) =>
    setStaged((held) => {
      // Back to what it was is not a change: the bar counts differences, not touches.
      const current = groups
        .flatMap((one) => one.blocks)
        .flatMap((block) => block.rows)
        .find((row) => row.key === key)
      const { [key]: _dropped, ...rest } = held

      return current !== undefined && current.kind !== 'link' && current.value === value
        ? rest
        : { ...rest, [key]: value }
    })

  const save = () => {
    const language = staged[STUDIO_LANGUAGE]

    if (language !== undefined && isLanguage(language)) choose(language)

    setStaged({})
  }

  const leave = useCallback(() => void navigate({ to: '/' }), [navigate])

  // Leaving with staged changes loses them, so leaving asks — in the browser's own
  // words for a reload or a closed tab, and in Studio's for a link.
  const confirmLeaving = useCallback(() => !window.confirm(t('settings.confirmLeave')), [t])

  useBlocker({
    disabled: dirty.length === 0,
    enableBeforeUnload: true,
    shouldBlockFn: confirmLeaving,
  })

  /* Escape closes the screen, unless it is in the middle of a field — a search box
     clears itself on Escape, and taking somebody out of the screen for it is worse. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      leave()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leave])

  const sections = SECTIONS.map((section) => ({
    key: section,
    groups: groups.filter((one) => one.section === section && (!searching || hits.has(one.name))),
  })).filter((section) => section.groups.length > 0)

  /** The open group's rows that answer the search, block by block. */
  const blocks =
    group === undefined
      ? []
      : group.blocks
          .map((block) => ({
            block,
            rows: block.rows.filter((row) =>
              matches({ label: row.label, help: row.help ?? '' }, query),
            ),
          }))
          .filter(({ rows }) => rows.length > 0)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <header className="flex h-13 shrink-0 items-center gap-2 bg-chrome px-3 text-chrome-ink">
        <Link to="/" className="flex items-center gap-2 pl-1 text-chrome-ink hover:text-white">
          <Logo size={22} />
          <span className="text-md font-[650] tracking-[-0.02em]">assemora</span>
        </Link>
        <span aria-hidden className="px-1 opacity-30">
          /
        </span>
        <span className="text-base font-[550] opacity-90">{t('settings.title')}</span>
        {group !== undefined && (
          <>
            <span aria-hidden className="px-1 opacity-30">
              /
            </span>
            <span className="text-base font-[550] opacity-55">{group.label}</span>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={leave}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-white/[0.08] pr-3 pl-[9px] text-sm font-[650] text-chrome-ink/85 hover:bg-white/[0.16] hover:text-white"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {t('settings.back')}
          </button>
          <button
            type="button"
            aria-label={t('settings.close')}
            title={t('settings.close')}
            onClick={leave}
            className="grid size-[30px] place-items-center rounded-lg text-chrome-ink/65 hover:bg-white/[0.12] hover:text-white"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
          <span aria-hidden className="h-[22px] w-px bg-white/[0.12]" />
          <Avatar name={viewer?.name} />
        </div>
      </header>

      <main className="m-2 min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface">
        {failure !== undefined ? (
          <div className="p-8">
            <Failure error={failure} />
          </div>
        ) : !ready || group === undefined ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[244px_minmax(0,1fr)]">
            <nav
              aria-label={t('settings.groups')}
              className="flex min-h-0 flex-col border-r border-hairline"
            >
              <div className="shrink-0 px-4 pt-5 pb-3">
                <h1 className="text-[17px] font-[650] tracking-[-0.005em]">
                  {t('settings.title')}
                </h1>
                <SearchField
                  className="mt-3"
                  value={query}
                  placeholder={t('settings.find')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
                {sections.map((section) => (
                  <div key={section.key}>
                    <p className="mx-2 mt-3 mb-1.5 text-xs font-[650] tracking-[0.06em] text-ink-faint uppercase">
                      {t(SECTION_LABELS[section.key])}
                    </p>
                    <ul className="flex list-none flex-col gap-0.5 p-0">
                      {section.groups.map((one) => (
                        <GroupButton
                          key={one.name}
                          group={one}
                          current={one.name === group.name}
                          // While searching the badge is the count of rows that
                          // answered; at rest it is whatever the group counts.
                          badge={
                            searching
                              ? (hits.get(one.name) ?? 0) > 0
                                ? String(hits.get(one.name))
                                : undefined
                              : one.badge
                          }
                          onClick={() =>
                            void navigate({
                              to: '/settings',
                              search: { group: one.name },
                              replace: true,
                            })
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                {searching && sections.length === 0 && (
                  <p className="mx-2 my-4 text-sm text-ink-faint">
                    {t('settings.nothing', { query: query.trim() })}
                  </p>
                )}
              </div>
            </nav>

            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="max-w-[760px] px-8 pt-7 pb-10">
                  <header className="border-b border-hairline pb-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0">
                        <h2 className="text-title font-[650] tracking-[-0.005em]">{group.label}</h2>
                        {group.blurb !== undefined && (
                          <p className="mt-2 max-w-[60ch] text-base text-ink-soft">{group.blurb}</p>
                        )}
                      </div>
                      <span className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-sm whitespace-nowrap text-ink-soft">
                        <span aria-hidden>{SECTION_ICONS[group.section]}</span>
                        {t(SECTION_LABELS[group.section])}
                      </span>
                    </div>
                  </header>

                  {blocks.map(({ block, rows }) => (
                    <BlockView
                      key={block.title}
                      block={block}
                      rows={rows}
                      staged={staged}
                      onStage={stage}
                    />
                  ))}
                </div>
              </div>

              {/* One save bar for the whole screen: settings are a form, not forty
                  autosaves. The bar counts and names the keys that are waiting. */}
              <SaveBar
                dirty={dirty.length > 0}
                summary={
                  dirty.length === 0
                    ? t('settings.allSaved')
                    : t('settings.unsavedCount', { count: dirty.length })
                }
                {...(dirty.length > 0
                  ? {
                      detail: (
                        <span className="font-mono text-xs text-ink-faint">
                          {dirty.join(' · ')}
                        </span>
                      ),
                    }
                  : {})}
              >
                <Button
                  variant="secondary"
                  disabled={dirty.length === 0}
                  onClick={() => setStaged({})}
                >
                  {t('entry.discard')}
                </Button>
                <Button variant="accent" disabled={dirty.length === 0} onClick={save}>
                  {t('entry.saveChanges')}
                </Button>
              </SaveBar>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
