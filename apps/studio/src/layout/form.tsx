/**
 * A form, drawn from its arrangement (ADR-0033).
 *
 * Used twice: by the entry screen, with the reader's draft and the application's
 * refusals, and by the form screen's preview, with nothing typed in. Tabs are a state of
 * this component and nothing else — which tab is open is not something a URL or a draft
 * needs to know.
 */
import { type ReactNode, useState } from 'react'

import { useLanguage, useT } from '../i18n/translate.tsx'
import { FieldInput, type FieldIssues } from '../screens/fields.tsx'
import { said } from '../settings/said.ts'
import { Card, join } from '../ui/index.tsx'
import { Tabs } from '../ui/layout.tsx'
import { type Arranged, LEFT_OUT, type Placed, type Section } from './resolve.ts'
import { holds } from './visible.ts'

export type FormProps = {
  readonly arranged: Arranged
  readonly draft: Readonly<Record<string, unknown>>
  /** What the application said about each field, by field name. */
  readonly issuesFor?: (name: string) => FieldIssues | undefined
  onChange(name: string, value: unknown): void
  /** Below the column beside the form — where the entry screen puts "saved at". */
  readonly asideFooter?: ReactNode
  /**
   * Draw a section its condition hides, faded and named, rather than leaving it out:
   * the form screen's preview has nothing typed in, and a section that only appears
   * when something is would otherwise be invisible to the person arranging it.
   */
  readonly preview?: boolean
}

const valueAt = (draft: Readonly<Record<string, unknown>>, name: string): unknown =>
  Object.hasOwn(draft, name) ? draft[name] : undefined

const FieldCell = ({
  placed,
  props,
}: {
  placed: Placed
  props: Pick<FormProps, 'draft' | 'issuesFor' | 'onChange'>
}) => {
  const issues = props.issuesFor?.(placed.field.name)

  return (
    <div className={join('min-w-0', placed.width === 'half' ? 'col-span-1' : 'col-span-full')}>
      <FieldInput
        field={placed.field}
        value={valueAt(props.draft, placed.field.name)}
        {...(issues === undefined ? {} : { issues })}
        onChange={(value) => props.onChange(placed.field.name, value)}
      />
    </div>
  )
}

/** The fields of one section on a grid: one column, or two with `half` fields side by side. */
const SectionFields = ({
  section,
  props,
}: {
  section: Section
  props: Pick<FormProps, 'draft' | 'issuesFor' | 'onChange'>
}) => (
  <div className={join('grid gap-[22px]', section.columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
    {section.fields.map((placed) => (
      <FieldCell key={placed.field.name} placed={placed} props={props} />
    ))}
  </div>
)

/**
 * A section as a card with a heading — the entry screen's own "Main content" card,
 * generalised: a title when the layout gave one, Studio's own words for the section it
 * adds for what was left out, and no heading at all for a section that named none.
 */
/** What a faded section in the preview says about itself. */
const Shown = ({ section }: { section: Section }) => {
  const t = useT()
  const when = section.visibleWhen

  if (when === undefined) return null

  return (
    <p className="px-5 pt-3 text-xs font-[650] tracking-[0.06em] text-warning-ink uppercase">
      {when.present === true
        ? t('form.shownWhenPresent', { field: when.field })
        : t('form.shownWhenEquals', { field: when.field, value: String(when.equals) })}
    </p>
  )
}

const SectionCard = ({
  section,
  derived,
  hidden,
  props,
}: {
  section: Section
  derived: boolean
  /** Its condition does not hold; drawn only in preview, and faded. */
  hidden: boolean
  props: Pick<FormProps, 'draft' | 'issuesFor' | 'onChange'>
}) => {
  const t = useT()
  const { language } = useLanguage()
  const heading =
    section.key === LEFT_OUT
      ? t('form.leftOut')
      : section.title !== undefined
        ? said(section.title, language)
        : derived
          ? t('entry.mainContent')
          : undefined

  return (
    <Card className={join('min-w-0 overflow-hidden', hidden && 'border-dashed opacity-60')}>
      {heading !== undefined && (
        <div className="flex h-[46px] items-center border-b border-line bg-surface-raised px-5 text-md font-[650] text-ink-strong">
          {heading}
        </div>
      )}
      {(hidden || props.draft === undefined) && <Shown section={section} />}
      {section.description !== undefined && (
        <p className="px-5 pt-4 text-base text-ink-soft">{said(section.description, language)}</p>
      )}
      <div className="p-5">
        {section.fields.length === 0 ? (
          <p className="py-2 text-base text-ink-faint">{t('form.emptySection')}</p>
        ) : (
          <SectionFields section={section} props={props} />
        )}
      </div>
    </Card>
  )
}

export const EntryFields = ({
  arranged,
  draft,
  issuesFor,
  onChange,
  asideFooter,
  preview = false,
}: FormProps) => {
  const t = useT()
  const { language } = useLanguage()
  const [open, setOpen] = useState<string | undefined>(undefined)
  const props = { draft, ...(issuesFor === undefined ? {} : { issuesFor }), onChange }

  /** Whether a section is drawn now: its condition holds, or this is the preview. */
  const shown = (section: Section): boolean => preview || holds(section.visibleWhen, draft)

  const tabs = arranged.tabs
  const current = tabs?.find((tab) => tab.key === open) ?? tabs?.[0]
  const sections = (
    tabs === undefined ? (arranged.sections ?? []) : (current?.sections ?? [])
  ).filter(shown)
  const asideSections = arranged.aside.filter(shown)
  const hasAside =
    asideSections.some((section) => section.fields.length > 0 || !arranged.derived) ||
    asideFooter !== undefined

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div
        className={join(
          'flex min-w-0 flex-col gap-4',
          hasAside ? 'flex-[1_1_480px]' : 'w-full max-w-[760px]',
        )}
      >
        {tabs !== undefined && tabs.length > 1 && (
          <div className="-mt-6">
            <Tabs
              value={current?.key ?? ''}
              options={tabs.map((tab) => ({ value: tab.key, label: said(tab.label, language) }))}
              onChange={setOpen}
              label={t('form.tabsLabel')}
            />
          </div>
        )}

        {sections.map((section) => (
          <SectionCard
            key={section.key}
            section={section}
            derived={arranged.derived}
            hidden={!holds(section.visibleWhen, draft)}
            props={props}
          />
        ))}
        {sections.length === 0 && (
          <Card className="p-5">
            <p className="py-2 text-base text-ink-faint">{t('form.emptyTab')}</p>
          </Card>
        )}
      </div>

      {hasAside && (
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 lg:max-w-[360px]">
          {asideSections
            .filter((section) => section.fields.length > 0 || !arranged.derived)
            .map((section) => (
              <Card
                key={section.key}
                className={join(
                  'flex flex-col gap-[18px] p-[18px]',
                  !holds(section.visibleWhen, draft) && 'border-dashed opacity-60',
                )}
              >
                {section.title !== undefined && (
                  <h3 className="text-base font-[650]">{said(section.title, language)}</h3>
                )}
                {!holds(section.visibleWhen, draft) && <Shown section={section} />}
                {section.fields.length === 0 ? (
                  <p className="text-base text-ink-faint">{t('form.emptySection')}</p>
                ) : (
                  <SectionFields section={section} props={props} />
                )}
              </Card>
            ))}
          {asideFooter}
        </div>
      )}
    </div>
  )
}
