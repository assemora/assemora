/**
 * The shape of a screen inside the content panel.
 *
 * The handoff draws every screen the same way: a header that does not scroll, an
 * optional row of tabs and a toolbar under it, then one scroller holding the content,
 * then a footer pinned to the bottom. That is a column of fixed height rather than a
 * long page, which is why the toolbar of a table stays put while its rows move — and
 * why a row menu has to be positioned against the viewport (see `overlay.tsx`).
 */
import type { ReactNode } from 'react'

import { Counter, join } from './index.tsx'

/** The whole screen: a column that fills the panel and scrolls only where told to. */
export const Screen = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full min-h-0 flex-col">{children}</div>
)

/**
 * The part of a screen that stays while the content moves.
 *
 * `32px 32px 0` — the same inset the scroller below uses, so a title and the first row
 * under it share a left edge.
 */
export const ScreenHead = ({
  divided = false,
  children,
}: {
  /**
   * A hairline along the bottom.
   *
   * The content below scrolls under this header, so something has to mark where the
   * header ends. On a screen with tabs or a table that line is already there — the tab
   * row's own border, the table's header rule — and a second one would be a double
   * rule. A form has neither, and without this its first card slides up under the
   * title with nothing between them.
   */
  divided?: boolean
  children: ReactNode
}) => (
  <div className={join('shrink-0 px-8 pt-8', divided && 'border-b border-hairline pb-5')}>
    {children}
  </div>
)

/** Title, an optional count, and the actions — one line, actions pushed right. */
export const ScreenTitle = ({
  icon,
  title,
  count,
  badge,
  description,
  actions,
}: {
  icon?: ReactNode
  title: string
  count?: ReactNode
  badge?: ReactNode
  description?: string | undefined
  actions?: ReactNode
}) => (
  <div className="flex items-start gap-3">
    {icon !== undefined && <span className="mt-0.5 shrink-0 text-ink-soft">{icon}</span>}
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <h1 className="truncate text-title font-[650] tracking-[-0.005em]">{title}</h1>
        {count !== undefined && <Counter>{count}</Counter>}
        {badge}
      </div>
      {description !== undefined && (
        <p className="mt-1 max-w-prose text-base text-ink-soft">{description}</p>
      )}
    </div>
    {actions !== undefined && (
      <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">{actions}</div>
    )}
  </div>
)

/**
 * Views of one record or one list — never separate destinations.
 *
 * The underline sits on the container's own border rather than floating above it, which
 * is what keeps a tab row from reading as a second toolbar.
 */
export const Tabs = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: ReactNode }[]
  onChange(next: T): void
  label: string
}) => (
  <div role="tablist" aria-label={label} className="mt-6 flex gap-6 border-b border-line">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={option.value === value}
        onClick={() => onChange(option.value)}
        className={join(
          'h-9 border-b-2 px-0.5 text-base',
          option.value === value
            ? 'border-ink text-ink font-[650]'
            : 'border-transparent text-ink-soft font-[550] hover:text-ink',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
)

/** The row of filters over a list: search on the left, settings pushed right. */
export const Toolbar = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2 pt-5 pb-4">{children}</div>
)

/** The one scroller on a screen. Everything else is pinned. */
export const ScreenBody = ({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) => <div className={join('min-h-0 flex-1 overflow-auto px-8', className)}>{children}</div>

/** A footer pinned to the bottom of the panel: 60px, a hairline above it. */
export const ScreenFoot = ({ children }: { children: ReactNode }) => (
  <div className="flex h-15 shrink-0 items-center justify-between gap-3 border-t border-hairline px-8 text-base text-ink-soft">
    {children}
  </div>
)

/**
 * The bar along the bottom of a form.
 *
 * A form is one form, not forty autosaves: nothing is written until this is pressed, and
 * until then the bar says how much is waiting and which fields it is. `#fafafa` at rest
 * and warm the moment anything is unsaved, so the state of the form is legible from the
 * bottom of the screen without reading it.
 */
export const SaveBar = ({
  dirty,
  summary,
  detail,
  children,
}: {
  dirty: boolean
  summary: ReactNode
  detail?: ReactNode
  children: ReactNode
}) => (
  <div
    className={join(
      'flex shrink-0 items-center gap-3 border-t border-hairline px-8 py-3',
      dirty ? 'bg-[#fffaf0]' : 'bg-surface-sunken',
    )}
  >
    <span
      aria-hidden
      className={join('size-2 shrink-0 rounded-full', dirty ? 'bg-warning' : 'bg-line-strong')}
    />
    <span className="flex min-w-0 items-baseline gap-2 text-base text-ink-soft">
      <span className={dirty ? 'shrink-0 font-[650] text-ink tabular-nums' : 'shrink-0'}>
        {summary}
      </span>
      {detail !== undefined && <span className="truncate text-ink-soft">{detail}</span>}
    </span>
    <div className="ml-auto flex shrink-0 gap-2">{children}</div>
  </div>
)

/* ----------------------------------------------------------------------------- tables */

export const Table = ({ children }: { children: ReactNode }) => (
  <table className="w-full min-w-[860px] text-left">{children}</table>
)

export const Th = ({
  align = 'left',
  width,
  className,
  children,
}: {
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
  children?: ReactNode
}) => (
  <th
    scope="col"
    style={width === undefined ? undefined : { width }}
    className={join(
      'h-9 px-3 text-sm font-[650] tracking-[0.01em] text-ink-soft',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      className,
    )}
  >
    {children}
  </th>
)

/**
 * A cell. The vertical padding is a variable so density is one declaration on the
 * table rather than a number repeated in every cell.
 */
export const Td = ({
  align = 'left',
  className,
  children,
  ...rest
}: {
  align?: 'left' | 'right' | 'center'
  className?: string
  children?: ReactNode
  colSpan?: number
}) => (
  <td
    className={join(
      'px-4 py-[var(--row-y,10px)] leading-[1.4]',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      className,
    )}
    {...rest}
  >
    {children}
  </td>
)

export const Tr = ({
  selected = false,
  className,
  children,
}: {
  selected?: boolean
  className?: string
  children: ReactNode
}) => (
  <tr
    className={join(
      'border-b border-hairline',
      selected ? 'bg-surface-raised' : 'hover:bg-surface-sunken',
      className,
    )}
  >
    {children}
  </tr>
)

/** A machine value in a cell: mono, one size down, never wrapped. */
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={join('font-mono text-sm whitespace-nowrap text-ink-soft', className)}>
    {children}
  </span>
)
