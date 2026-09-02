/**
 * The form this definition will be, drawn while it is still being written
 * (`design_handoff_studio_redesign` §3).
 *
 * A definition is a list of names and kinds, and what it *becomes* is a form somebody
 * else fills in — which is the thing the person writing it is actually deciding about
 * and the one thing the list of rows does not show. So the panel answers "what will an
 * editor meet?" beside the answer to "what am I declaring?".
 *
 * A drawing and never a form: nothing here takes focus, holds a value or can be typed
 * into. It is deliberately not `FieldInput` — that renders the *real* control for a
 * field that exists, and pointing it at a draft would put a live media picker and a live
 * relation query behind a collection nobody has created yet.
 */
import { Calendar, Clock, Eye, Hash, ImagePlus, Link, Type } from 'lucide-react'
import type { ReactNode } from 'react'

import type { MessageKey } from '../i18n/messages.ts'
import { useT } from '../i18n/translate.tsx'
import { join } from '../ui/index.tsx'
import type { CollectionDraft, FieldDraft } from './draft.ts'

/** The hint inside a ghost input, by kind. Absent means the box is drawn empty. */
const HINTS: Readonly<Record<string, Extract<MessageKey, `sees.hint.${string}`>>> = {
  text: 'sees.hint.line',
  slug: 'sees.hint.slug',
  number: 'sees.hint.number',
  integer: 'sees.hint.number',
  date: 'sees.hint.date',
  datetime: 'sees.hint.date',
  time: 'sees.hint.time',
  relation: 'sees.hint.entry',
  textarea: 'sees.hint.text',
  markdown: 'sees.hint.text',
  richText: 'sees.hint.body',
  json: 'sees.hint.json',
  code: 'sees.hint.code',
}

const ICONS: Readonly<Record<string, ReactNode>> = {
  text: <Type className="size-3.5" />,
  slug: <Type className="size-3.5" />,
  number: <Hash className="size-3.5" />,
  integer: <Hash className="size-3.5" />,
  date: <Calendar className="size-3.5" />,
  datetime: <Calendar className="size-3.5" />,
  time: <Clock className="size-3.5" />,
  relation: <Link className="size-3.5" />,
}

const LINES = ['textarea', 'richText', 'markdown', 'json', 'code']
const CHOICES = ['select', 'checkboxes']
const BOXES = [
  'text',
  'slug',
  'url',
  'email',
  'number',
  'integer',
  'date',
  'datetime',
  'time',
  'relation',
  'color',
]

const Ghost = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <div
    className={join(
      'mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-disabled',
      className,
    )}
  >
    {children}
  </div>
)

/** One field, as the control an editor will be given for it. */
const Row = ({ field }: { field: FieldDraft }) => {
  const t = useT()
  const label = field.label.trim() || field.name.trim() || t('sees.untitledField')
  const hint = HINTS[field.kind]

  return (
    <div>
      <span className="flex items-baseline gap-1 text-xs font-semibold">
        {label}
        {field.required && <span className="text-danger">*</span>}
      </span>

      {BOXES.includes(field.kind) && (
        <Ghost className="h-8">
          {ICONS[field.kind] !== undefined && (
            <span aria-hidden className="shrink-0">
              {ICONS[field.kind]}
            </span>
          )}
          <span className="truncate">{hint === undefined ? '' : t(hint)}</span>
        </Ghost>
      )}

      {LINES.includes(field.kind) && (
        <Ghost className="h-14 items-start py-2">
          <span className="truncate">{hint === undefined ? '' : t(hint)}</span>
        </Ghost>
      )}

      {field.kind === 'boolean' && (
        <span className="mt-1.5 flex items-center gap-2.5">
          <span aria-hidden className="relative block h-5 w-[34px] rounded-full bg-pressed">
            <span className="absolute top-[3px] left-[3px] block size-3.5 rounded-full bg-surface" />
          </span>
          <span className="text-xs text-ink-subdued">{t('sees.offByDefault')}</span>
        </span>
      )}

      {field.kind === 'media' && (
        <span className="mt-1.5 flex flex-col items-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-sunken p-3.5 text-center">
          <ImagePlus aria-hidden className="size-4 text-ink-faint" />
          <span className="text-xs text-ink-faint">{t('sees.dropAnImage')}</span>
        </span>
      )}

      {CHOICES.includes(field.kind) &&
        (field.options.length === 0 ? (
          <span className="mt-1.5 block text-xs text-danger">{t('sees.needsAnOption')}</span>
        ) : (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {field.options.map((option) => (
              <span
                key={option}
                className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs text-ink-body"
              >
                <span
                  aria-hidden
                  className={join(
                    'block size-[11px] border border-line-strong bg-surface',
                    field.kind === 'checkboxes' ? 'rounded-[3px]' : 'rounded-full',
                  )}
                />
                {option}
              </span>
            ))}
          </span>
        ))}

      {field.kind === 'table' && (
        <span className="mt-1.5 block text-xs text-ink-faint">{t('sees.aTable')}</span>
      )}
      {field.kind === 'object' && (
        <span className="mt-1.5 block text-xs text-ink-faint">
          {t('sees.aGroup', { count: field.fields.length })}
        </span>
      )}
      {field.kind === 'array' && (
        <span className="mt-1.5 block text-xs text-ink-faint">{t('sees.aRepeater')}</span>
      )}
    </div>
  )
}

export const Preview = ({ draft }: { draft: CollectionDraft }) => {
  const t = useT()

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-3">
        <Eye aria-hidden className="size-4 text-ink-soft" />
        <span className="text-xs font-[650]">{t('sees.title')}</span>
      </div>

      <div className="bg-surface-sunken p-3.5">
        <div className="rounded-[10px] border border-hairline bg-surface p-3.5">
          <div className="flex items-center gap-2 border-b border-canvas pb-3">
            <span className="min-w-0 truncate text-base font-[650]">
              {t('sees.entry', { name: draft.label.trim() || t('sees.untitled') })}
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-canvas px-2 py-px text-xs font-semibold text-ink-soft">
              {t('pages.status.draft')}
            </span>
          </div>

          {draft.fields.length === 0 ? (
            <p className="mt-3.5 mb-0.5 text-xs text-ink-faint">{t('sees.nothingYet')}</p>
          ) : (
            <div className="mt-3.5 flex flex-col gap-3.5">
              {draft.fields.map((field) => (
                <Row key={field.key} field={field} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
