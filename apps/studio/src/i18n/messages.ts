/**
 * Everything Studio says, in every language it says it in.
 *
 * One object rather than eight, because the key space is one: `content.save` and
 * `pages.save` are different messages and `save` twice is a bug. The slices below are
 * for reading — a person translating the media library should not scroll past the
 * developer section to find it — and `messages.test.ts` proves the merge lost nothing,
 * which is the failure mode of assembling an object out of parts.
 *
 * The parameters a message takes are read off its English reading and enforced at the
 * call site: `t('entry.saved', { when })` does not compile without `when`, and does not
 * compile with a `where` the sentence has no hole for. Nothing hand-maintains that list.
 */
import type { ReactNode } from 'react'

import type { Message, Values } from './catalogue.ts'
import { say } from './catalogue.ts'
import type { Language } from './languages.ts'
import { CHROME } from './messages/chrome.ts'
import { COMMON } from './messages/common.ts'
import { CONTENT } from './messages/content.ts'
import { DESIGN } from './messages/design.ts'
import { DEVELOPER } from './messages/developer.ts'
import { FORM } from './messages/form.ts'
import { MEDIA } from './messages/media.ts'
import { PAGES } from './messages/pages.ts'
import { PEOPLE } from './messages/people.ts'
import { SETTINGS } from './messages/settings.ts'

export const SLICES = [
  COMMON,
  CHROME,
  CONTENT,
  PAGES,
  MEDIA,
  PEOPLE,
  DESIGN,
  DEVELOPER,
  SETTINGS,
  FORM,
] as const

export const MESSAGES = {
  ...COMMON,
  ...CHROME,
  ...CONTENT,
  ...PAGES,
  ...MEDIA,
  ...PEOPLE,
  ...DESIGN,
  ...DEVELOPER,
  ...SETTINGS,
  ...FORM,
}

export type MessageKey = keyof typeof MESSAGES

/**
 * Whether what sits between two braces is a name, or only two braces.
 *
 * `fill` substitutes `\{(\w+)\}` and nothing else, so `{ }` in a message — the ghost
 * JSON box draws one — is text and not a hole. Without this the type disagreed with the
 * runtime and asked the call site for a parameter called `' '`, which nothing could
 * pass. Checking for a word character in a template-literal type is not expressible;
 * refusing the punctuation a name cannot contain is, and it is the same answer for every
 * case that has come up.
 */
type Punctuation = ' ' | ',' | ':' | ';' | '"' | "'" | '{' | '}' | '(' | ')' | '[' | ']' | '.' | '-'

type Word<Name extends string> = Name extends ''
  ? never
  : Name extends `${string}${Punctuation}${string}`
    ? never
    : Name

/**
 * The `{name}` holes in a message.
 *
 * Distributive on purpose: a plural's English reading is a union of its three forms, so
 * a hole that appears in only one of them is still required at the call site.
 */
type Holes<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Word<Name> | Holes<Rest> : never

/** A message's English reading — the three forms of a plural, or the one of a phrase. */
type English<M extends Message> = M['en'] extends readonly string[] ? M['en'][number] : M['en']

type Filling<M extends Message, V> = Readonly<Record<Holes<English<M>>, V>>

/**
 * Nothing where a message has no holes, and exactly its holes where it has some.
 *
 * `[Holes<…>] extends [never]` rather than the bare test, so a message with no
 * parameters does not distribute into a call signature that takes anything at all.
 */
type Filler<M extends Message, V> = [Holes<English<M>>] extends [never]
  ? []
  : [values: Filling<M, V>]

/**
 * The keys a screen may hold as *data* — a label in a map, a heading in a table of
 * tabs — rather than write out at the call site.
 *
 * Only a message with no holes can be one: `t(row.label)` cannot know which values a
 * key it was handed needs, and refusing the wide union at the call site is what keeps
 * `{count}` from being printed unfilled. A key that takes parameters is still a key; it
 * is written where its values are.
 */
export type PlainKey = {
  [K in MessageKey]: [Holes<English<(typeof MESSAGES)[K]>>] extends [never] ? K : never
}[MessageKey]

export type Translate = <K extends MessageKey>(
  key: K,
  ...values: Filler<(typeof MESSAGES)[K], string | number>
) => string

/**
 * The same call, for a sentence something is *drawn* into rather than written into.
 *
 * A name in mono inside "Type {word} to confirm", a `<code>` inside an explanation. The
 * two could not be one function: this one answers with nodes and cannot be put in a
 * `title` attribute, and splitting such a sentence into a prefix and a suffix instead —
 * the usual workaround — is what makes it untranslatable, because the hole is at the
 * end in one language and in the middle in another.
 */
export type Woven = <K extends MessageKey>(
  key: K,
  ...values: Filler<(typeof MESSAGES)[K], ReactNode>
) => ReactNode

/**
 * One message, in one language.
 *
 * The cast is the whole of the untyped surface in this file, and it is one line: the
 * implementation cannot see through `Filler<M>` while `M` is still a type parameter,
 * though every caller can. Narrowing it any other way would mean giving up the call
 * site's checking, which is the point of the machinery above.
 */
export const translator = (language: Language): Translate =>
  ((key: MessageKey, values: Values = {}) => say(language, MESSAGES[key], values)) as Translate
