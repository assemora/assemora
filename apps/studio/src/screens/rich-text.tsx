/**
 * A rich text field, edited as text rather than as tags.
 *
 * `richText` was drawn as a textarea, so writing an article meant typing `<p>` and
 * `<strong>` by hand and reading the result as source. That is a developer's field on a
 * screen made for the person who runs the restaurant.
 *
 * It is `contenteditable` and `document.execCommand`, and that deserves an explanation
 * because `execCommand` is deprecated. The supported replacement is not a smaller API —
 * it is *no* API: making bold work without it means keeping a document model, mapping the
 * selection into it and rendering back, which is what ProseMirror and Lexical are and why
 * they weigh what they weigh. Studio is a closed artefact shipped to every project, and
 * several hundred kilobytes for bold and a bulleted list is the wrong trade. Every engine
 * still implements it, and the day one stops, the model is the thing to write.
 *
 * The toolbar is structure and nothing else: headings, emphasis, lists, a quote, a link,
 * a picture. No fonts, no colours, no sizes — the same rule the markdown field is written
 * under, and SPEC.md §61's: the theme decides how a thing looks, and a colour picker here
 * is the CSS editor arriving through the field layer.
 *
 * Drawn to `design_handoff_studio_redesign` §3: a `#f1f1f1` strip with a hairline under
 * it, 30px square buttons at radius 8, 18px Lucide icons, headings as their own words,
 * and hairline separators between the three groups.
 */
import {
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { MediaItem } from '../api/media.ts'
import { useT } from '../i18n/translate.tsx'
import { Input, join } from '../ui/index.tsx'
import { MediaPicker } from './media-picker.tsx'

/**
 * `execCommand`, with the two settings that decide what it writes.
 *
 * `styleWithCSS: false` asks for `<strong>` rather than `<span style="font-weight:bold">`
 * — tags a sanitiser can allow, instead of inline CSS every allowlist strips. And a
 * paragraph separator of `p`, because the default in some engines is `div`, which is not
 * a paragraph and is not on anybody's list.
 */
const exec = (command: string, value?: string): void => {
  document.execCommand('styleWithCSS', false, 'false')
  document.execCommand('defaultParagraphSeparator', false, 'p')
  document.execCommand(command, false, value)
}

/** What the caret is standing in, lower-cased — engines disagree about the case. */
const blockAt = (): string => {
  try {
    return document.queryCommandValue('formatBlock').toLowerCase()
  } catch {
    return ''
  }
}

const stateOf = (command: string): boolean => {
  try {
    return document.queryCommandState(command)
  } catch {
    return false
  }
}

/** The marks the toolbar lights up for. Read from the selection, never remembered. */
type Marks = {
  readonly block: string
  readonly bold: boolean
  readonly italic: boolean
  readonly bullets: boolean
  readonly numbers: boolean
}

const NOTHING: Marks = {
  block: '',
  bold: false,
  italic: false,
  bullets: false,
  numbers: false,
}

/**
 * One button on the strip: 30px square, radius 8, and a fill when it is on.
 *
 * `onMouseDown` is prevented on every one of them, because the selection is lost the
 * moment a button takes focus and a command with nothing selected does nothing at all.
 */
const Tool = ({
  title,
  active = false,
  onMouseDown,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onMouseDown?: (event: React.MouseEvent) => void
  onClick(): void
  children: ReactNode
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onMouseDown={(event) => {
      event.preventDefault()
      onMouseDown?.(event)
    }}
    onClick={onClick}
    className={join(
      'grid size-[30px] shrink-0 place-items-center rounded-lg',
      active ? 'bg-hairline text-ink' : 'bg-transparent text-ink-body hover:bg-line',
    )}
  >
    {children}
  </button>
)

const Separator = () => <span aria-hidden className="mx-1.5 h-[18px] w-px shrink-0 bg-line" />

export const RichTextInput = ({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) => {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const saved = useRef<Range | null>(null)
  /**
   * The last thing this component put in the box, or said about it.
   *
   * The effect below has to tell *our own* change from one that came from outside — a
   * record loading, a language switching, a draft discarded — and it cannot do that by
   * comparing against the DOM. A state update is deferred and the effect runs after the
   * commit, so by then the box may already hold the next keystroke while `value` still
   * holds the last one; comparing against the DOM, the effect sees a difference that is
   * only time, writes the older text back, and the caret goes to the start.
   *
   * So it compares against the last thing this component emitted. Equal means the value
   * is our own echo, however far ahead the box has run. `null` at the start, so the first
   * run always writes: that is how the article gets into an empty box.
   */
  const spoken = useRef<string | null>(null)
  const address = useRef<HTMLInputElement>(null)
  const [linking, setLinking] = useState(false)
  const [picking, setPicking] = useState(false)
  const [href, setHref] = useState('')
  const [marks, setMarks] = useState<Marks>(NOTHING)

  /**
   * The value reaches the node here and nowhere else, and never through React.
   *
   * `dangerouslySetInnerHTML` was the obvious way to render it and is the wrong one:
   * React re-applies it on a commit that touches the element even when the string has not
   * changed, so every keystroke put the box back to what it held at mount. Measured, not
   * reasoned about — three characters typed into a harness came back as none.
   *
   * `useLayoutEffect` rather than `useEffect` because this is the browser's own DOM being
   * corrected: after paint, the box would show empty for a frame when a record loads.
   */
  useLayoutEffect(() => {
    const node = box.current

    if (node === null || value === spoken.current) return

    spoken.current = value
    node.innerHTML = value
  }, [value])

  // The cursor goes where the work is. `autoFocus` would say the same thing, and is the
  // attribute that puts a caret in a form the moment a page loads; this only fires when
  // somebody has just asked for the address bar.
  useEffect(() => {
    if (linking) address.current?.focus()
  }, [linking])

  /**
   * Which buttons are lit, read from wherever the caret is.
   *
   * Derived and never stored: a mark is a fact about the selection, and remembering one
   * is how a toolbar comes to show bold while the caret sits in plain text. The listener
   * is on the document because a selection change does not bubble from the box.
   */
  const read = useCallback(() => {
    const node = box.current
    const selection = document.getSelection()
    const inside =
      node !== null &&
      selection !== null &&
      selection.anchorNode !== null &&
      node.contains(selection.anchorNode)

    setMarks(
      inside
        ? {
            block: blockAt(),
            bold: stateOf('bold'),
            italic: stateOf('italic'),
            bullets: stateOf('insertUnorderedList'),
            numbers: stateOf('insertOrderedList'),
          }
        : NOTHING,
    )
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', read)

    return () => document.removeEventListener('selectionchange', read)
  }, [read])

  const said = (): void => {
    const node = box.current

    if (node === null) return

    spoken.current = node.innerHTML
    onChange(spoken.current)
  }

  /** Runs a command against the text, then reports what the text became. */
  const apply = (command: string, argument?: string) => () => {
    box.current?.focus()
    exec(command, argument)
    said()
    read()
  }

  /**
   * A heading is a toggle, the way the design draws it.
   *
   * Pressing H2 inside an H2 puts the line back to a paragraph. Without that there is no
   * way out of a heading except deleting the line, and the strip has no ¶ of its own —
   * the design does not draw one, and it does not need to.
   */
  const heading = (tag: 'h2' | 'h3') => apply('formatBlock', marks.block === tag ? 'p' : tag)

  /** A picture from the library, as a tag the value carries like any other. */
  const insert = (item: MediaItem) => {
    setPicking(false)
    box.current?.focus()
    exec(
      'insertHTML',
      `<img src="${item.url}" alt="${(item.alt ?? '').replace(/"/g, '&quot;')}" />`,
    )
    said()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface focus-within:border-line-strong">
      <div className="flex min-h-8 flex-wrap items-center gap-0.5 border-b border-line bg-canvas px-2 py-1.5 text-ink-strong">
        <Tool title={t('richText.heading')} active={marks.block === 'h2'} onClick={heading('h2')}>
          <span className="text-base font-[650]">H2</span>
        </Tool>
        <Tool
          title={t('richText.subheading')}
          active={marks.block === 'h3'}
          onClick={heading('h3')}
        >
          <span className="text-base font-[650]">H3</span>
        </Tool>

        <Separator />

        <Tool title={t('richText.bold')} active={marks.bold} onClick={apply('bold')}>
          <Bold aria-hidden className="size-[18px]" />
        </Tool>
        <Tool title={t('richText.italic')} active={marks.italic} onClick={apply('italic')}>
          <Italic aria-hidden className="size-[18px]" />
        </Tool>
        <Tool
          title={t('richText.bullets')}
          active={marks.bullets}
          onClick={apply('insertUnorderedList')}
        >
          <List aria-hidden className="size-[18px]" />
        </Tool>
        <Tool
          title={t('richText.numbers')}
          active={marks.numbers}
          onClick={apply('insertOrderedList')}
        >
          <ListOrdered aria-hidden className="size-[18px]" />
        </Tool>
        <Tool
          title={t('richText.quote')}
          active={marks.block === 'blockquote'}
          onClick={apply('formatBlock', marks.block === 'blockquote' ? 'p' : 'blockquote')}
        >
          <Quote aria-hidden className="size-[18px]" />
        </Tool>

        <Separator />

        <Tool
          title={t('richText.link')}
          active={linking}
          onMouseDown={() => {
            // Kept before focus moves to the input: `createLink` needs a selection, and by
            // the time the address has been typed there is none left to give it.
            const range = getSelection()?.getRangeAt(0)

            saved.current = range === undefined ? null : range.cloneRange()
          }}
          onClick={() => setLinking((was) => !was)}
        >
          <Link2 aria-hidden className="size-[18px]" />
        </Tool>
        <Tool title={t('richText.unlink')} onClick={apply('unlink')}>
          <Link2Off aria-hidden className="size-[18px]" />
        </Tool>
        <Tool title={t('richText.image')} onClick={() => setPicking(true)}>
          <ImageIcon aria-hidden className="size-[18px]" />
        </Tool>

        {linking && (
          <Input
            size="panel"
            ref={address}
            value={href}
            placeholder="https://"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLinking(false)
                return
              }

              if (event.key !== 'Enter') return

              event.preventDefault()

              const range = saved.current

              if (range !== null) {
                const selection = getSelection()

                selection?.removeAllRanges()
                selection?.addRange(range)
              }

              box.current?.focus()
              exec('createLink', href)
              said()
              setHref('')
              setLinking(false)
            }}
            className="ml-1.5 w-56"
          />
        )}
      </div>

      {/* `useSemanticElements` wants a textarea, which holds text and not structure — a
          heading in one is the four characters `<h2>`. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a textarea holds text, not structure */}
      <div
        ref={box}
        contentEditable
        // A `contenteditable` is focusable without it, but nothing in the markup says so
        // — to a reader, or to a linter reading the role.
        tabIndex={0}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={said}
        onBlur={said}
        onKeyUp={read}
        onMouseUp={read}
        /**
         * A paste arrives as text and nothing else.
         *
         * What a browser puts on the clipboard from Word or Google Docs is fonts, colours
         * and `<span style>` by the screenful. Some of it survives to the database and is
         * stripped on the way out, which means an author sees one thing while writing and
         * another on the site. Plain text is the honest version: the structure is put back
         * with the toolbar, which is what the toolbar is for.
         */
        onPaste={(event) => {
          event.preventDefault()
          exec('insertText', event.clipboardData.getData('text/plain'))
          said()
        }}
        className="min-h-48 p-4 text-base leading-[1.65] text-ink focus:outline-none [&_a]:text-link [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-section [&_h2]:font-[650] [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-md [&_h3]:font-[650] [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-3 [&_p]:first:mt-0 [&_ul]:my-2 [&_ul]:list-disc"
      />

      {picking && <MediaPicker onClose={() => setPicking(false)} onPick={insert} />}
    </div>
  )
}
