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
 * The toolbar is structure and nothing else: headings, emphasis, lists, a quote, a link.
 * No fonts, no colours, no sizes — the same rule the markdown field is written under, and
 * SPEC.md §61's: the theme decides how a thing looks, and a colour picker here is the CSS
 * editor arriving through the field layer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const BUTTON =
  'inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm text-ink-soft transition hover:bg-surface-sunken'

type Tool = {
  readonly label: string
  readonly title: string
  /** What `execCommand` is asked to do, and with what. */
  readonly run: () => void
  readonly bold?: boolean
}

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

export const RichTextInput = ({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) => {
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
  const [href, setHref] = useState('')

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
  }

  const tools: readonly Tool[] = [
    { label: 'B', title: 'Bold', run: apply('bold'), bold: true },
    { label: 'I', title: 'Italic', run: apply('italic') },
    { label: 'H2', title: 'Heading', run: apply('formatBlock', 'h2') },
    { label: 'H3', title: 'Subheading', run: apply('formatBlock', 'h3') },
    { label: '¶', title: 'Paragraph', run: apply('formatBlock', 'p') },
    { label: '• —', title: 'Bulleted list', run: apply('insertUnorderedList') },
    { label: '1.', title: 'Numbered list', run: apply('insertOrderedList') },
    { label: '❝', title: 'Quote', run: apply('formatBlock', 'blockquote') },
  ]

  return (
    <div className="rounded-lg border border-line bg-surface focus-within:border-accent">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.title}
            // The selection is lost the moment the button takes focus, and a command with
            // nothing selected does nothing at all.
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.run}
            className={`${BUTTON} ${tool.bold === true ? 'font-bold' : ''}`}
          >
            {tool.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-line" />

        <button
          type="button"
          title="Link"
          onMouseDown={(event) => {
            // Kept before focus moves to the input: `createLink` needs a selection, and by
            // the time the address has been typed there is none left to give it.
            event.preventDefault()
            const range = getSelection()?.getRangeAt(0)

            saved.current = range === undefined ? null : range.cloneRange()
          }}
          onClick={() => setLinking((was) => !was)}
          className={BUTTON}
        >
          🔗
        </button>

        <button
          type="button"
          title="Remove link"
          onMouseDown={(event) => event.preventDefault()}
          onClick={apply('unlink')}
          className={BUTTON}
        >
          ⌫
        </button>

        {linking && (
          <span className="flex items-center gap-1 pl-1">
            <input
              ref={address}
              value={href}
              placeholder="https://"
              onChange={(event) => setHref(event.target.value)}
              onKeyDown={(event) => {
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
              className="h-7 w-56 rounded border border-line px-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </span>
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
        className="prose-sm min-h-48 max-w-none px-3 py-2 text-sm text-ink focus:outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc"
      />
    </div>
  )
}
