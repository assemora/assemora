/**
 * What a field kind looks like and what it means, for the person choosing one
 * (`design_handoff_studio_redesign` §3).
 *
 * A kind is a machine word — `richText`, `checkboxes`, `slug` — and a dropdown of two
 * dozen of them is a list of words somebody has no reason to know apart. So each one is
 * drawn with an icon and one sentence saying what a value of that kind *is*, and the
 * name stays in mono because it is the name the definition, the API and an agent use.
 *
 * Presentation only, and therefore allowed to be incomplete. The kinds themselves come
 * from the application (`kindsOf` reads them off `collections.create`'s own schema), so
 * a plugin's kind is offered here whether or not this file has heard of it — it simply
 * arrives without an icon and without a sentence, which is the honest state of "Studio
 * does not know what this is" rather than a guess about somebody else's field.
 */
import {
  Binary,
  Braces,
  Calendar,
  CalendarClock,
  Circle,
  CircleChevronDown,
  Clock,
  Code,
  ExternalLink,
  FileText,
  Group,
  Hash,
  Image as ImageIcon,
  LetterText,
  Link,
  Link2,
  List,
  ListChecks,
  Mail,
  Palette,
  Pilcrow,
  Quote,
  Table,
  Tag,
  TextAlignStart,
  ToggleLeft,
  Type,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { MessageKey } from '../i18n/messages.ts'
import { blankField, type FieldDraft } from './draft.ts'

/** The one sentence about a kind, keyed the way every other message is. */
type KindHelp = Extract<MessageKey, `kind.help.${string}`>

const ICONS: Readonly<Record<string, ReactNode>> = {
  text: <Type className="size-[17px]" />,
  textarea: <TextAlignStart className="size-[17px]" />,
  richText: <Pilcrow className="size-[17px]" />,
  markdown: <LetterText className="size-[17px]" />,
  code: <Code className="size-[17px]" />,
  number: <Hash className="size-[17px]" />,
  integer: <Binary className="size-[17px]" />,
  boolean: <ToggleLeft className="size-[17px]" />,
  date: <Calendar className="size-[17px]" />,
  datetime: <CalendarClock className="size-[17px]" />,
  time: <Clock className="size-[17px]" />,
  select: <CircleChevronDown className="size-[17px]" />,
  checkboxes: <ListChecks className="size-[17px]" />,
  color: <Palette className="size-[17px]" />,
  json: <Braces className="size-[17px]" />,
  slug: <Tag className="size-[17px]" />,
  url: <Link2 className="size-[17px]" />,
  link: <ExternalLink className="size-[17px]" />,
  email: <Mail className="size-[17px]" />,
  media: <ImageIcon className="size-[17px]" />,
  relation: <Link className="size-[17px]" />,
  table: <Table className="size-[17px]" />,
  object: <Group className="size-[17px]" />,
  array: <List className="size-[17px]" />,
}

const HELP: Readonly<Record<string, KindHelp>> = {
  text: 'kind.help.text',
  textarea: 'kind.help.textarea',
  richText: 'kind.help.richText',
  markdown: 'kind.help.markdown',
  code: 'kind.help.code',
  number: 'kind.help.number',
  integer: 'kind.help.integer',
  boolean: 'kind.help.boolean',
  date: 'kind.help.date',
  datetime: 'kind.help.datetime',
  time: 'kind.help.time',
  select: 'kind.help.select',
  checkboxes: 'kind.help.checkboxes',
  color: 'kind.help.color',
  json: 'kind.help.json',
  slug: 'kind.help.slug',
  url: 'kind.help.url',
  link: 'kind.help.link',
  email: 'kind.help.email',
  media: 'kind.help.media',
  relation: 'kind.help.relation',
  table: 'kind.help.table',
  object: 'kind.help.object',
  array: 'kind.help.array',
}

/** A kind Studio has no icon for — a plugin's — gets the shape of an unknown thing. */
export const iconOf = (kind: string): ReactNode => ICONS[kind] ?? <Circle className="size-[17px]" />

export const helpOf = (kind: string): KindHelp | undefined => HELP[kind]

/**
 * A shape people ask for often, offered where there is nothing yet.
 *
 * Not a template in the framework sense and not stored anywhere: pressing one fills the
 * form in, and every row is then editable exactly as if it had been typed. The names are
 * machine names and stay Latin in every language; the label on the button is a word and
 * is translated.
 *
 * `Testimonial` rather than `Article`: a preset has to be something the framework would
 * never have declared for you, or it reads as a feature you already have.
 */
export type Preset = {
  readonly name: string
  /** Narrowed to its own family, because `t` cannot be handed a key that could be any. */
  readonly label: Extract<MessageKey, `preset.${string}`>
  readonly icon: ReactNode
  /** How many rows it lays out, without building them to find out. */
  readonly count: number
  /** Built on demand, because a `FieldDraft` carries a key that must be unique. */
  fields(nextKey: () => string): readonly FieldDraft[]
}

type Shape = Partial<Omit<FieldDraft, 'key' | 'stored'>> & { readonly name: string }

const rows = (...shapes: readonly Shape[]): Pick<Preset, 'count' | 'fields'> => ({
  count: shapes.length,
  fields: (nextKey) => shapes.map((shape) => ({ ...blankField(nextKey()), ...shape })),
})

export const PRESETS: readonly Preset[] = [
  {
    name: 'testimonial',
    label: 'preset.testimonial',
    icon: <Quote className="size-[15px]" />,
    ...rows(
      { name: 'quote', kind: 'textarea', required: true },
      { name: 'author', kind: 'text', required: true, searchable: true },
      { name: 'company', kind: 'text' },
      {
        name: 'sentiment',
        kind: 'checkboxes',
        filterable: true,
        options: ['positive', 'neutral', 'critical'],
      },
    ),
  },
  {
    name: 'post',
    label: 'preset.post',
    icon: <FileText className="size-[15px]" />,
    ...rows(
      { name: 'title', kind: 'text', required: true, searchable: true },
      // The one preset field that shows a kind off rather than only using it: a slug
      // made from another field is what `source` is for, and it is the thing nobody
      // finds by reading a list of kind names.
      { name: 'slug', kind: 'slug', required: true, source: 'title' },
      { name: 'body', kind: 'richText' },
      { name: 'cover', kind: 'media' },
      { name: 'published_at', kind: 'datetime', filterable: true },
    ),
  },
  {
    name: 'member',
    label: 'preset.member',
    icon: <Users className="size-[15px]" />,
    ...rows(
      { name: 'full_name', kind: 'text', required: true, searchable: true },
      { name: 'role', kind: 'text' },
      { name: 'photo', kind: 'media' },
      { name: 'bio', kind: 'textarea' },
    ),
  },
]

/**
 * Whether this application registered every kind a preset uses.
 *
 * An application can register fewer — `collections.create` publishes the kinds *this
 * process* has — and a preset that fills the form with a kind the command will refuse is
 * worse than one button fewer.
 */
export const fits = (preset: Preset, kinds: readonly string[]): boolean =>
  preset.fields(() => 'probe').every((field) => kinds.includes(field.kind))
