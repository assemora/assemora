/**
 * The form screen: how a resource's entry form is arranged (ADR-0033).
 *
 * Two columns, the way the collection builder is drawn: what is being decided on the
 * left — tabs, sections, which field sits where and how wide — and what it becomes on
 * the right, the entry form itself, drawn by the same component the entry screen uses.
 * Every click is one pure step in `layout/edit.ts`; the screen holds the layout and the
 * version it read, and one save sends both through `resources.arrange`.
 *
 * Nothing here knows the resource: the fields come from the registry, the starting
 * arrangement from the registry's `layouts` section or, absent one, from the same
 * derivation the entry screen falls back to. A field can be moved and never removed —
 * taking it out of a section leaves it in the "not placed" list and at the end of the
 * form, because a layout cannot hide a field.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, LayoutPanelLeft, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import {
  type Condition,
  type FieldDescriptor,
  type Layout,
  type LayoutSection,
  labelOf,
  shownFields,
  useIntrospection,
} from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { useLanguage, useT } from '../i18n/translate.tsx'
import {
  addSection,
  addTab,
  allSections,
  moveField,
  moveSection,
  moveTab,
  placedNames,
  placeField,
  relabelTab,
  removeSection,
  removeTab,
  retitleSection,
  setColumns,
  setCondition,
  setWidth,
  startingLayout,
  unplaceField,
  withTabs,
} from '../layout/edit.ts'
import { EntryFields } from '../layout/form.tsx'
import { arrange } from '../layout/resolve.ts'
import { said } from '../settings/said.ts'
import {
  Badge,
  Button,
  Card,
  Empty,
  Failure,
  IconButton,
  Input,
  Segmented,
  Select,
  Spinner,
} from '../ui/index.tsx'
import { SaveBar, Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'

/**
 * What the screen starts from when nothing was declared or arranged: the two columns
 * the entry screen derives, written out as a layout so the editor has sections to
 * move fields between.
 */
const derivedLayout = (fields: readonly FieldDescriptor[]): Layout => {
  const drawn = arrange(fields, undefined)
  const main = drawn.sections?.[0]?.fields.map((one) => one.field.name) ?? []
  const aside = drawn.aside[0]?.fields.map((one) => one.field.name) ?? []

  return {
    ...startingLayout(main),
    ...(aside.length === 0 ? {} : { aside: [{ key: 'aside', fields: aside }] }),
  }
}

const nameOf = (entry: LayoutSection['fields'][number]): string =>
  typeof entry === 'string' ? entry : entry.field

const widthOf = (entry: LayoutSection['fields'][number]): 'full' | 'half' =>
  typeof entry === 'string' ? 'full' : (entry.width ?? 'full')

/** The arrows and the cross every movable row carries. */
const RowTools = ({
  onUp,
  onDown,
  onRemove,
  removeLabel,
}: {
  onUp(): void
  onDown(): void
  onRemove?: () => void
  removeLabel: string
}) => {
  const t = useT()

  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <IconButton label={t('form.up')} size={28} onClick={onUp}>
        <ArrowUp className="size-4" />
      </IconButton>
      <IconButton label={t('form.down')} size={28} onClick={onDown}>
        <ArrowDown className="size-4" />
      </IconButton>
      {onRemove !== undefined && (
        <IconButton label={removeLabel} size={28} onClick={onRemove}>
          <X className="size-4" />
        </IconButton>
      )}
    </span>
  )
}

/**
 * When a section is shown. A boolean or a select field is asked for a value; any other
 * field can only be asked whether it is filled in — there is no box to type a value a
 * form does not constrain.
 */
const ConditionEditor = ({
  section,
  fields,
  onChange,
}: {
  section: LayoutSection
  fields: readonly FieldDescriptor[]
  onChange(when: Condition | undefined): void
}) => {
  const t = useT()
  const when = section.visibleWhen
  const on = when === undefined ? undefined : fields.find((field) => field.name === when.field)
  const candidates = fields.filter((field) => !field.hidden)

  const choose = (name: string) => {
    if (name === '') return onChange(undefined)

    const field = fields.find((one) => one.name === name)

    if (field === undefined) return

    onChange(
      field.kind === 'boolean'
        ? { field: name, equals: true }
        : field.kind === 'select'
          ? { field: name, equals: field.options?.[0]?.value ?? '' }
          : { field: name, present: true },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2">
      <span className="text-sm text-ink-subdued">{t('form.shownWhen')}</span>
      <Select
        size="small"
        value={when?.field ?? ''}
        onChange={(event) => choose(event.target.value)}
        className="w-[180px]"
      >
        <option value="">{t('form.always')}</option>
        {candidates.map((field) => (
          <option key={field.name} value={field.name}>
            {labelOf(field)}
          </option>
        ))}
      </Select>
      {when !== undefined && on?.kind === 'boolean' && (
        <Segmented<'yes' | 'no'>
          value={when.equals === false ? 'no' : 'yes'}
          options={[
            { value: 'yes', label: t('form.yes') },
            { value: 'no', label: t('form.no') },
          ]}
          onChange={(next) => onChange({ field: when.field, equals: next === 'yes' })}
          label={t('form.equals')}
        />
      )}
      {when !== undefined && on?.kind === 'select' && (
        <Select
          size="small"
          value={String(when.equals ?? '')}
          onChange={(event) => onChange({ field: when.field, equals: event.target.value })}
          className="w-[160px]"
        >
          {(on.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
      {when !== undefined && on !== undefined && on.kind !== 'boolean' && on.kind !== 'select' && (
        <span className="text-sm text-ink-soft">{t('form.isPresent')}</span>
      )}
    </div>
  )
}

const SectionEditor = ({
  section,
  byName,
  fields,
  layout,
  onChange,
}: {
  section: LayoutSection
  byName: ReadonlyMap<string, FieldDescriptor>
  fields: readonly FieldDescriptor[]
  layout: Layout
  onChange(next: Layout): void
}) => {
  const t = useT()
  const { language } = useLanguage()

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Input
          size="small"
          value={section.title === undefined ? '' : said(section.title, language)}
          placeholder={t('form.titlePlaceholder')}
          onChange={(event) => onChange(retitleSection(layout, section.key, event.target.value))}
          className="max-w-[240px]"
        />
        <Segmented<'1' | '2'>
          value={String(section.columns ?? 1) as '1' | '2'}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
          ]}
          onChange={(next) => onChange(setColumns(layout, section.key, next === '2' ? 2 : 1))}
          label={t('form.columns')}
        />
        <RowTools
          onUp={() => onChange(moveSection(layout, section.key, -1))}
          onDown={() => onChange(moveSection(layout, section.key, 1))}
          onRemove={() => onChange(removeSection(layout, section.key))}
          removeLabel={t('form.removeSection')}
        />
      </div>
      <ul className="flex list-none flex-col p-1">
        {section.fields.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-ink-faint">{t('form.emptySection')}</li>
        )}
        {section.fields.map((entry) => {
          const name = nameOf(entry)
          const field = byName.get(name)
          const width = widthOf(entry)

          return (
            <li
              key={name}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1 truncate text-base">
                {field === undefined ? name : labelOf(field)}
                <span className="ml-2 font-mono text-xs text-ink-faint">{name}</span>
              </span>
              <button
                type="button"
                title={width === 'half' ? t('form.half') : t('form.full')}
                onClick={() => onChange(setWidth(layout, name, width === 'half' ? 'full' : 'half'))}
                className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink-soft hover:text-ink"
              >
                {width === 'half' ? '½' : '1'}
              </button>
              <RowTools
                onUp={() => onChange(moveField(layout, name, -1))}
                onDown={() => onChange(moveField(layout, name, 1))}
                onRemove={() => onChange(unplaceField(layout, name))}
                removeLabel={t('form.unplace')}
              />
            </li>
          )
        })}
      </ul>
      <ConditionEditor
        section={section}
        fields={fields}
        onChange={(when) => onChange(setCondition(layout, section.key, when))}
      />
    </div>
  )
}

export const LayoutEditor = () => {
  const params = useParams({ from: '/shell/content/$resource/form' })
  const navigate = useNavigate()
  const client = useQueryClient()
  const introspection = useIntrospection()
  const { can } = useSession()
  const t = useT()
  const { language } = useLanguage()

  const resource = introspection.data?.resources?.find((one) => one.name === params.resource)
  const described = introspection.data?.layouts?.find((one) => one.name === params.resource)
  const fields = resource === undefined ? [] : shownFields(resource)
  const byName = new Map(fields.map((field) => [field.name, field]))

  const [layout, setLayout] = useState<Layout>()
  const [saved, setSaved] = useState<Layout>()
  const [refusal, setRefusal] = useState<ApiError>()

  // The registry's layout the first time it is known, and not again: a refetch under
  // an open editor would throw away what somebody has arranged.
  useEffect(() => {
    if (resource === undefined || layout !== undefined) return

    const starting = described?.layout ?? derivedLayout(shownFields(resource))

    setLayout(starting)
    setSaved(starting)
  }, [resource, described, layout])

  const dirty = layout !== undefined && JSON.stringify(layout) !== JSON.stringify(saved)

  const confirmLeaving = useCallback(() => !window.confirm(t('form.confirmLeave')), [t])

  useBlocker({ disabled: !dirty, enableBeforeUnload: true, shouldBlockFn: confirmLeaving })

  const arranging = useMutation({
    mutationFn: (next: Layout | null) =>
      api.command<{ layout: Layout | null; version: number }>('resources.arrange', {
        resource: params.resource,
        layout: next,
        expectedVersion: described?.version ?? 0,
      }),
    onSuccess: async (answer) => {
      setRefusal(undefined)
      // Back to the declaration answers null; the registry now says what is drawn.
      await client.invalidateQueries({ queryKey: ['introspection'] })
      setLayout(undefined)
      setSaved(undefined)
      if (answer.layout === null) {
        // Re-read from the registry on the next render, through the effect above.
      }
    },
    onError: (error) => setRefusal(error instanceof ApiError ? error : undefined),
  })

  if (introspection.isPending || (resource !== undefined && layout === undefined)) {
    return (
      <Page icon={<LayoutPanelLeft className="size-5" />} title={t('form.title')}>
        <Spinner />
      </Page>
    )
  }

  if (resource === undefined || layout === undefined) {
    return (
      <Page icon={<LayoutPanelLeft className="size-5" />} title={t('form.title')}>
        <Empty title={t('entry.noResource', { name: params.resource })} />
      </Page>
    )
  }

  const editable = can('resources.arrange')
  const placed = new Set(placedNames(layout))
  const unplaced = fields.filter((field) => !placed.has(field.name))
  const sectionOptions = allSections(layout).map((section) => ({
    key: section.key,
    label: section.title === undefined ? section.key : said(section.title, language),
  }))
  const source = described?.source ?? 'derived'

  const change = (next: Layout) => {
    setLayout(next)
    setRefusal(undefined)
  }

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<LayoutPanelLeft className="size-5" />}
          title={t('form.title')}
          count={resource.label}
          description={t('form.lede')}
          badge={
            <Badge tone={source === 'stored' ? 'accent' : 'neutral'}>
              {t(`form.source.${source}`)}
            </Badge>
          }
          actions={
            <Button
              variant="secondary"
              onClick={() => void navigate({ to: '/content/$resource', params })}
            >
              {resource.label}
            </Button>
          }
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {!editable && (
          <Card className="mb-4 p-4">
            <p className="text-base text-ink-soft">{t('form.cannot')}</p>
          </Card>
        )}
        {refusal !== undefined && (
          <div className="mb-4">
            <Failure error={refusal.status === 409 ? new Error(t('form.conflict')) : refusal} />
          </div>
        )}

        <fieldset
          disabled={!editable}
          className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
          {/* What is being decided. */}
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold">{t('form.shape')}</span>
              <Segmented<'page' | 'tabs'>
                value={layout.tabs === undefined ? 'page' : 'tabs'}
                options={[
                  { value: 'page', label: t('form.onePage') },
                  { value: 'tabs', label: t('form.withTabs') },
                ]}
                onChange={(next) => change(withTabs(layout, next === 'tabs', t('form.newTab')))}
                label={t('form.shape')}
              />
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-base font-[650]">{t('form.main')}</h2>
              {layout.tabs === undefined ? (
                <>
                  {layout.sections.map((section) => (
                    <SectionEditor
                      key={section.key}
                      section={section}
                      byName={byName}
                      fields={fields}
                      layout={layout}
                      onChange={change}
                    />
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => change(addSection(layout, {}))}
                  >
                    <Plus className="size-4" />
                    {t('form.addSection')}
                  </Button>
                </>
              ) : (
                <>
                  {layout.tabs.map((tab) => (
                    <div
                      key={tab.key}
                      className="rounded-xl border border-line-strong bg-surface-sunken p-3"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-xs font-[650] tracking-[0.06em] text-ink-faint uppercase">
                          {t('form.tab')}
                        </span>
                        <Input
                          size="small"
                          value={said(tab.label, language)}
                          placeholder={t('form.labelPlaceholder')}
                          onChange={(event) =>
                            change(relabelTab(layout, tab.key, event.target.value))
                          }
                          className="max-w-[240px]"
                        />
                        <RowTools
                          onUp={() => change(moveTab(layout, tab.key, -1))}
                          onDown={() => change(moveTab(layout, tab.key, 1))}
                          {...(layout.tabs !== undefined && layout.tabs.length > 1
                            ? { onRemove: () => change(removeTab(layout, tab.key)) }
                            : {})}
                          removeLabel={t('form.removeTab')}
                        />
                      </div>
                      <div className="flex flex-col gap-3">
                        {tab.sections.map((section) => (
                          <SectionEditor
                            key={section.key}
                            section={section}
                            byName={byName}
                            fields={fields}
                            layout={layout}
                            onChange={change}
                          />
                        ))}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => change(addSection(layout, { tab: tab.key }))}
                        >
                          <Plus className="size-4" />
                          {t('form.addSection')}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => change(addTab(layout, t('form.newTab')))}
                  >
                    <Plus className="size-4" />
                    {t('form.addTab')}
                  </Button>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-base font-[650]">{t('form.aside')}</h2>
              {(layout.aside ?? []).map((section) => (
                <SectionEditor
                  key={section.key}
                  section={section}
                  byName={byName}
                  fields={fields}
                  layout={layout}
                  onChange={change}
                />
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => change(addSection(layout, { aside: true }))}
              >
                <Plus className="size-4" />
                {t('form.addSection')}
              </Button>
            </div>

            {unplaced.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-[650]">{t('form.unplaced')}</h2>
                <p className="text-sm text-ink-subdued">{t('form.unplacedHelp')}</p>
                <ul className="flex list-none flex-col gap-1 p-0">
                  {unplaced.map((field) => (
                    <li
                      key={field.name}
                      className="flex items-center gap-2 rounded-lg border border-hairline px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate text-base">
                        {labelOf(field)}
                        <span className="ml-2 font-mono text-xs text-ink-faint">{field.name}</span>
                      </span>
                      <Select
                        size="small"
                        value=""
                        onChange={(event) => {
                          if (event.target.value !== '')
                            change(placeField(layout, field.name, event.target.value))
                        }}
                        className="w-[180px]"
                      >
                        <option value="">{t('form.placeIn')}</option>
                        {sectionOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* What it becomes. */}
          <div className="min-w-0">
            <h2 className="mb-3 text-base font-[650]">{t('form.preview')}</h2>
            <div className="pointer-events-none select-none opacity-90">
              <EntryFields
                arranged={arrange(fields, layout)}
                draft={{}}
                onChange={() => undefined}
              />
            </div>
          </div>
        </fieldset>
      </ScreenBody>

      <SaveBar dirty={dirty} summary={dirty ? t('entry.unsaved') : t('entry.noChanges')}>
        {source === 'stored' && (
          <Button
            variant="ghost"
            disabled={!editable || arranging.isPending}
            onClick={() => arranging.mutate(null)}
          >
            {t('form.reset')}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!dirty || arranging.isPending}
          onClick={() => {
            if (saved !== undefined) setLayout(saved)
            setRefusal(undefined)
          }}
        >
          {t('entry.discard')}
        </Button>
        <Button
          busy={arranging.isPending}
          disabled={!dirty || !editable}
          onClick={() => arranging.mutate(layout)}
        >
          {t('entry.saveChanges')}
        </Button>
      </SaveBar>
    </Screen>
  )
}
