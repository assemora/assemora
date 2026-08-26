/**
 * What a `richText` block looks like.
 *
 * Studio edits this field in a plain textarea, so what arrives is text and it is
 * rendered as text. Nothing here reaches for `dangerouslySetInnerHTML`: the day this
 * block stores markup is the day it needs a sanitiser, and that is a decision to make
 * on purpose rather than to inherit from a starter.
 */
import type { BlockViewProps } from '@assemora/react'

export type RichTextProps = {
  readonly body?: string
}

export const RichTextView = ({ props }: BlockViewProps<RichTextProps>) => (
  <div className="rich-text">{props.body}</div>
)
