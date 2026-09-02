/**
 * Studio's small vocabulary of controls.
 *
 * Not a design system a project may extend — the surface Studio itself is drawn with,
 * fixed by `design_handoff_studio_redesign`. Blocks and content are rendered by the
 * application's own frontend, never by these (SPEC.md §59).
 *
 * Every geometry below is quoted from the handoff rather than chosen here: a control
 * is 36px on its own and 32px in a toolbar, a button is 32px, a switch is 40×22 with a
 * 16px knob. Where a screen needs something that is not in this file, it belongs in
 * this file first.
 */

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  Loader,
  Minus,
  Search as SearchIcon,
  X,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  use,
  useId,
} from 'react'

import { ApiError, unshownMessages } from '../api/client.ts'
import { useT } from '../i18n/translate.tsx'

export const join = (...classes: (string | false | undefined)[]): string =>
  classes.filter(Boolean).join(' ')

/* --------------------------------------------------------------------------- actions */

/**
 * The five buttons of the handoff, and no sixth.
 *
 * `primary` and `secondary` carry a relief built from two inset shadows and a hairline
 * drop; it is what makes a solid button read as pressable against a white panel without
 * a border. `ghost` is the tertiary of the design — no fill at rest — and `danger` is
 * the outlined destructive, never a red fill: the handoff spends a solid red only on a
 * dialog's confirm.
 */
const VARIANTS = {
  primary:
    'bg-ink-strong text-white relief-primary hover:brightness-[0.86] active:brightness-[0.76]',
  secondary: 'bg-surface text-ink-strong relief-secondary hover:bg-surface-raised active:bg-canvas',
  ghost: 'bg-transparent text-ink-strong hover:bg-canvas',
  danger: 'border border-danger-line bg-surface text-danger hover:bg-danger-soft',
  /** The confirm inside a destructive dialog, and nowhere else. */
  destructive: 'bg-danger text-white relief-primary hover:brightness-[0.92]',
  accent: 'bg-accent text-white relief-primary hover:brightness-[0.9] active:brightness-[0.82]',
} as const

const SIZES = {
  /** In a list row. */
  xs: 'h-7 rounded-[7px] px-2.5 text-sm',
  /** In a card, a toolbar, a dialog footer. */
  sm: 'h-[30px] rounded-lg px-3.5',
  /** The standard. */
  md: 'h-8 rounded-lg px-4',
  /** The one primary on a sign-in form. */
  lg: 'h-[38px] rounded-lg px-4',
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  busy?: boolean
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) => (
  <button
    type="button"
    disabled={disabled === true || busy}
    className={join(
      'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-[650]',
      'disabled:cursor-not-allowed disabled:border disabled:border-hairline',
      'disabled:bg-surface-raised disabled:text-ink-disabled disabled:shadow-none',
      variant === 'ghost' && 'font-semibold',
      SIZES[size],
      VARIANTS[variant],
      className,
    )}
    {...rest}
  >
    {busy && <Loader aria-hidden className="size-4 animate-spin" />}
    {children}
  </button>
)

/**
 * A square button carrying an icon and nothing else.
 *
 * `label` is required rather than optional: an icon on its own is unreadable to a screen
 * reader, and a control that only some people can name is not the same control.
 */
export const IconButton = ({
  label,
  size = 32,
  variant = 'ghost',
  className,
  children,
  ...rest
}: Omit<ComponentPropsWithRef<'button'>, 'aria-label'> & {
  label: string
  size?: 28 | 30 | 32 | 36
  variant?: 'ghost' | 'outline'
  children: ReactNode
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={join(
      'inline-grid shrink-0 place-items-center rounded-lg',
      'disabled:cursor-not-allowed disabled:text-ink-disabled',
      size === 28 && 'size-7',
      size === 30 && 'size-[30px]',
      size === 32 && 'size-8',
      size === 36 && 'h-8 w-9',
      variant === 'ghost' && 'bg-transparent text-ink-soft hover:bg-canvas hover:text-ink-strong',
      variant === 'outline' &&
        'bg-surface text-ink-strong relief-secondary hover:bg-surface-raised',
      className,
    )}
    {...rest}
  >
    {children}
  </button>
)

/**
 * A primary action with a menu hung off its right edge.
 *
 * One rounded shell holding two buttons and a hairline, so the relief is drawn once
 * across the pair rather than twice with a seam down the middle.
 */
export const SplitButton = ({
  children,
  onClick,
  onMore,
  moreLabel,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  onMore?: () => void
  moreLabel: string
  disabled?: boolean
}) => (
  <div className="relief-primary flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg whitespace-nowrap">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="bg-ink-strong px-[18px] font-[650] text-white hover:brightness-[0.86] active:brightness-[0.76] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
    {onMore !== undefined && (
      <>
        <span aria-hidden className="my-auto h-[18px] w-px bg-white/20" />
        <button
          type="button"
          aria-label={moreLabel}
          onClick={onMore}
          className="grid w-8 place-items-center bg-ink-strong text-white hover:brightness-[0.86]"
        >
          <ChevronDown aria-hidden className="size-5" />
        </button>
      </>
    )}
  </div>
)

/* ----------------------------------------------------------------------------- forms */

/**
 * The id `Field` minted, so a control can claim the label without every call site
 * naming one. Containment would associate them too, but an explicit `for` survives
 * a control that later grows a wrapper.
 */
const FieldId = createContext<string | undefined>(undefined)

/** Whether the enclosing `Field` is reporting a refusal, so a control can wear it. */
const FieldInvalid = createContext(false)

const CONTROL =
  'w-full border bg-surface text-base text-ink placeholder:text-ink-faint ring-field hover:border-line-strong disabled:cursor-not-allowed disabled:border-hairline disabled:bg-surface-raised disabled:text-ink-disabled read-only:bg-surface-sunken'

const border = (invalid: boolean) => (invalid ? 'ring-field-danger' : 'border-line')

export const Input = ({
  size = 'field',
  className,
  ...rest
  // `size` on a native input is a width in characters, which nothing here has ever set
  // and no design in the handoff is expressed in. The name is worth more as this.
  // `ComponentPropsWithRef`, so a caller can hold the element: the rich text strip moves
  // focus into the address box the moment it opens. `IconButton` takes its ref the same
  // way — React 19 passes one through as an ordinary prop.
}: Omit<ComponentPropsWithRef<'input'>, 'size'> & { size?: ControlSize }) => (
  <input
    id={use(FieldId)}
    className={join(CONTROL, INPUT_SIZES[size], border(use(FieldInvalid)), className)}
    {...rest}
  />
)

export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    id={use(FieldId)}
    className={join(
      CONTROL,
      'min-h-24 resize-y rounded-lg px-3 py-[9px]',
      border(use(FieldInvalid)),
      className,
    )}
    {...rest}
  />
)

/**
 * A native `select` wearing the chevron of the design.
 *
 * Native rather than a listbox of our own: it is the one control where the platform's
 * behaviour on a phone, with a keyboard and under a screen reader is better than
 * anything this file would write, and the handoff's dropdown is only its skin. The
 * grouped picker with an explanation per option — the Kind dropdown — is `Picker`, in
 * `overlay.tsx`, because it is a panel over the screen rather than a control on it.
 */
/**
 * The three sizes a control comes in, and nothing between them.
 *
 * The handoff gives a field one height per place it stands in — 36 on a form, 32 in a
 * toolbar or a side panel, 28 in a list row — each with its own padding and its own
 * radius at the smallest. Left to a `className` at the call site, `h-8` changed the
 * height and left the rest behind, which is how five selects came to be five slightly
 * different controls.
 */
export type ControlSize = 'field' | 'panel' | 'small'

const INPUT_SIZES: Readonly<Record<ControlSize, string>> = {
  field: 'h-9 rounded-lg px-3 text-base',
  panel: 'h-8 rounded-lg px-3 text-base',
  small: 'h-7 rounded-[7px] px-2.5 text-sm',
}

/**
 * A select's padding is not an input's: the right edge is a well for the chevron, and
 * the chevron shrinks with the box.
 */
const SELECT_SIZES = {
  field: { box: 'h-9 rounded-lg pl-3 pr-9 text-base', chevron: 'right-2.5 size-[18px]' },
  panel: { box: 'h-8 rounded-lg pl-2.5 pr-8 text-base', chevron: 'right-[9px] size-4' },
  small: { box: 'h-7 rounded-[7px] pl-2.5 pr-7 text-sm', chevron: 'right-2 size-3.5' },
} as const satisfies Record<ControlSize, { box: string; chevron: string }>

export const Select = ({
  size = 'field',
  className,
  ...rest
  // `size` on a native `<select>` is how many rows a list box shows, which this control
  // is never. The name is worth more as the handoff's three sizes than as that.
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  /** Where it stands: a form, a toolbar or panel, or a row in a list. */
  size?: ControlSize
}) => (
  <span className="relative block">
    <select
      id={use(FieldId)}
      className={join(
        CONTROL,
        'cursor-pointer appearance-none',
        SELECT_SIZES[size].box,
        border(use(FieldInvalid)),
        className,
      )}
      {...rest}
    />
    <ChevronDown
      aria-hidden
      className={join(
        'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-soft',
        SELECT_SIZES[size].chevron,
      )}
    />
  </span>
)

/**
 * A field with a fixed cell welded to one edge — `/articles/` before a slug, `MB` after
 * a number. One border around the pair, so the two read as one control.
 */
export const Affixed = ({
  prefix,
  suffix,
  children,
}: {
  prefix?: ReactNode
  suffix?: ReactNode
  children: ReactNode
}) => (
  <span
    className={join(
      'flex h-9 overflow-hidden rounded-lg border bg-surface',
      use(FieldInvalid) ? 'ring-field-danger' : 'border-line',
      'focus-within:border-ink-strong focus-within:shadow-[0_0_0_3px_rgb(48_48_48/0.08)]',
    )}
  >
    {prefix !== undefined && (
      <span className="grid place-items-center border-r border-line bg-surface-raised px-2.5 font-mono text-sm text-ink-soft">
        {prefix}
      </span>
    )}
    {children}
    {suffix !== undefined && (
      <span className="grid place-items-center border-l border-line bg-surface-raised px-2.5 text-sm text-ink-soft">
        {suffix}
      </span>
    )}
  </span>
)

/** The bare input to put inside `Affixed` — it wears the wrapper's border, not its own. */
export const AffixedInput = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    id={use(FieldId)}
    className={join(
      'min-w-0 flex-1 border-0 bg-transparent px-2.5 text-base text-ink outline-none placeholder:text-ink-faint',
      className,
    )}
    {...rest}
  />
)

/**
 * A search box, which the handoff draws twice and identically: over the entries of a
 * collection and over the people in a workspace.
 *
 * Its own control rather than a magnifier positioned by hand at each call site, which is
 * what it was — three copies of `absolute top-1/2 left-3` and a padding that has to know
 * about them. The geometry is the kit's toolbar field: 32px, a 20px glyph 12px from the
 * left edge, and 40px of room made for it.
 */
export const SearchField = ({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>) => (
  <span className={join('relative block', className)}>
    <SearchIcon
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-subdued"
    />
    <Input type="search" size="panel" className="pl-10" {...rest} />
  </span>
)

export const Field = ({
  label,
  help,
  required,
  errors,
  inline = false,
  children,
}: {
  label: string
  help?: string | undefined
  required?: boolean
  errors?: readonly string[]
  /**
   * Label on the left and the control on the right, on one line.
   *
   * For a control that is already its own answer — a switch is on or off, and a label
   * stacked over one leaves a 40px object alone on a 320px row. The design uses this
   * shape everywhere a boolean appears (`design_handoff_studio_redesign` §3, §5).
   */
  inline?: boolean
  children: ReactNode
}) => {
  const id = useId()
  const invalid = errors !== undefined && errors.length > 0
  const messages = (
    <>
      {help !== undefined && !invalid && <p className="text-sm text-ink-subdued">{help}</p>}
      {errors?.map((error) => (
        <p key={error} className="flex items-center gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ))}
    </>
  )

  if (inline) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={id}
            className="flex items-baseline gap-1 text-base font-semibold text-ink"
          >
            {label}
            {required === true && <span className="text-danger">*</span>}
          </label>
          <FieldId value={id}>
            <FieldInvalid value={invalid}>{children}</FieldInvalid>
          </FieldId>
        </div>
        {messages}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1 text-base font-semibold text-ink">
        {label}
        {required === true && <span className="text-danger">*</span>}
      </label>
      <FieldId value={id}>
        <FieldInvalid value={invalid}>{children}</FieldInvalid>
      </FieldId>
      {messages}
    </div>
  )
}

/** 40×22, knob 16, `translateX(18px)` when on. */
export const Switch = ({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange(next: boolean): void
  label: string
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={join(
      'relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
      checked ? 'bg-accent' : 'bg-pressed',
    )}
  >
    <span
      aria-hidden
      className={join(
        'absolute top-[3px] left-[3px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-150',
        checked && 'translate-x-[18px]',
      )}
    />
  </button>
)

/**
 * 17px, radius 5, accent fill with a white check. `mixed` draws the header state.
 *
 * A button rather than `input[type=checkbox]`: the box is 17px with a 5px radius and a
 * third, mixed appearance, and no native checkbox renders that. Styling one into shape
 * means hiding it and painting a `span` beside it — which is this button, with a focus
 * target that no longer matches what is on screen.
 */
export type CheckboxProps = {
  checked: boolean
  mixed?: boolean
  onChange(next: boolean): void
  disabled?: boolean
} & (
  | {
      /** What it is, where nothing beside it says so — a box in a table header. */
      label: string
      children?: undefined
    }
  | {
      /** The sentence beside the box *is* the control's name, so `label` is redundant. */
      label?: undefined
      children: ReactNode
    }
)

export const Checkbox = ({
  checked,
  mixed = false,
  onChange,
  label,
  disabled,
  children,
}: CheckboxProps) => (
  /*
   * One button holding the box and its sentence, which is the handoff's own markup: a
   * `<label>` wrapping a native input would be two hit targets with one of them 13px
   * tall, and the words beside a checkbox are the largest part of it to aim at.
   */
  // biome-ignore lint/a11y/useSemanticElements: the box is the control — see above
  <button
    type="button"
    role="checkbox"
    aria-checked={mixed ? 'mixed' : checked}
    {...(label === undefined ? {} : { 'aria-label': label })}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={join(
      'inline-flex items-center gap-2 text-left text-base disabled:cursor-not-allowed disabled:opacity-50',
      children === undefined && 'shrink-0',
    )}
  >
    <span
      aria-hidden
      className={join(
        'grid size-[17px] shrink-0 place-items-center rounded-[5px] border transition-colors',
        checked || mixed ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface',
      )}
    >
      {mixed ? (
        <Minus className="size-3" strokeWidth={3} />
      ) : (
        checked && <Check className="size-3" strokeWidth={3} />
      )}
    </span>
    {children}
  </button>
)

/**
 * 16px, `5px solid accent` when on — a ring rather than a dot inside a ring.
 *
 * A button for the same reason `Checkbox` is one: this shape is the border, and a native
 * radio has no border to grow.
 */
export const Radio = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange(): void
  label: string
}) => (
  // biome-ignore lint/a11y/useSemanticElements: the ring is the control — see above
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    className={join(
      'block size-4 shrink-0 rounded-full bg-surface transition-[border-color,border-width]',
      checked ? 'border-[5px] border-accent' : 'border border-line-strong',
    )}
  />
)

/** A checkbox or a radio with its sentence, as one target. */
export const Choice = ({
  children,
  control,
  onClick,
}: {
  children: ReactNode
  control: ReactNode
  onClick(): void
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2.5 text-left text-base"
  >
    <span aria-hidden className="contents">
      {control}
    </span>
    <span>{children}</span>
  </button>
)

/**
 * 26px items in a 2px canvas track; the chosen one is white with a hairline shadow.
 *
 * The design's viewport picker, its token pickers and its density switch are all this
 * one control, so it takes a value and a list rather than children.
 *
 * The options are buttons: in a segmented control the option *is* the indicator, so
 * there is nothing left for a native radio to be — the label and the mark are one box.
 */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange(next: T): void
  label: string
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    /* Wrapping, because a track is as long as the scale it is offering and a scale is
       the theme's to decide: seven spacing tokens and `theme` do not fit across a 344px
       inspector. Two rows of the same track still read as one control; a row that
       overflows its panel does not. */
    className="inline-flex flex-wrap gap-0.5 rounded-[9px] bg-canvas p-0.5"
  >
    {options.map((option) => (
      // biome-ignore lint/a11y/useSemanticElements: the option is the control — see above
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        title={option.title ?? undefined}
        onClick={() => onChange(option.value)}
        className={join(
          'inline-flex h-[26px] items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-sm font-semibold',
          option.value === value
            ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
            : 'text-ink-soft hover:text-ink',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
)

/* --------------------------------------------------------------------- status & shape */

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={join('rounded-xl border border-line bg-surface', className)}>{children}</div>
)

const TONES = {
  neutral: 'bg-canvas text-ink-body',
  positive: 'bg-accent-wash text-accent-ink',
  accent: 'bg-accent-tint text-accent-ink',
  warning: 'bg-warning-wash text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-wash text-info-ink',
  quiet: 'bg-surface-raised text-ink-subdued',
} as const

const DOTS = {
  neutral: 'bg-ink-subdued',
  positive: 'bg-accent',
  accent: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-link',
  quiet: 'bg-line-strong',
} as const

export const Badge = ({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode
  tone?: keyof typeof TONES
  dot?: boolean
}) => (
  <span
    className={join(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold',
      TONES[tone],
    )}
  >
    {dot && <span aria-hidden className={join('size-1.5 rounded-full', DOTS[tone])} />}
    {children}
  </span>
)

/** The square-cornered status chip a table row wears — 24px, radius 8, no dot. */
export const StatusChip = ({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: keyof typeof TONES
}) => (
  <span
    className={join(
      'inline-flex h-6 items-center rounded-lg px-2.5 text-sm font-[650]',
      TONES[tone],
    )}
  >
    {children}
  </span>
)

/** A count beside a heading: canvas fill, tabular figures, so a number does not jump. */
export const Counter = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full bg-canvas px-2.5 py-[3px] text-sm font-[650] text-ink-soft tabular-nums">
    {children}
  </span>
)

const BANNERS = {
  info: {
    box: 'border-info-line bg-info-wash text-info-ink',
    Icon: Info,
  },
  warning: {
    box: 'border-warning-line bg-warning-wash-soft text-warning-ink-strong',
    Icon: AlertTriangle,
  },
  danger: {
    box: 'border-danger-line bg-danger-soft text-danger-ink',
    Icon: CircleAlert,
  },
} as const

/**
 * A sentence about the whole screen, in the palette of what it is about.
 *
 * Not a toast: a banner stays until the condition it names is gone, which is what a
 * failed publish or a 409 needs. `onDismiss` is for the ones that are merely news.
 */
export const Banner = ({
  tone,
  title,
  children,
  actions,
  onDismiss,
}: {
  tone: keyof typeof BANNERS
  title: string
  children?: ReactNode
  actions?: ReactNode
  onDismiss?: () => void
}) => {
  const { box, Icon } = BANNERS[tone]

  return (
    <div className={join('drop flex items-start gap-2.5 rounded-xl border p-3 px-3.5', box)}>
      <Icon aria-hidden className="mt-px size-[18px] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-[650]">{title}</p>
        {children !== undefined && <div className="mt-0.5 text-base opacity-85">{children}</div>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
      {onDismiss !== undefined && <Dismiss onClick={onDismiss} />}
    </div>
  )
}

/** The X on a banner. Its own component because the word on it is a translation. */
const Dismiss = ({ onClick }: { onClick: () => void }) => {
  const t = useT()

  return (
    <button
      type="button"
      aria-label={t('common.dismiss')}
      onClick={onClick}
      className="grid size-[26px] shrink-0 place-items-center rounded-[7px] opacity-55 hover:opacity-100"
    >
      <X aria-hidden className="size-4" />
    </button>
  )
}

/**
 * `label` is a prop with no default: a spinner in a sidebar shows the animation alone,
 * and the word beside it is a translation rather than a string this file can hold.
 */
export const Spinner = ({ label }: { label?: string }) => {
  const t = useT()

  return (
    <div className="flex items-center gap-2 text-base text-ink-soft" role="status">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-line border-t-ink-strong"
      />
      {label ?? t('common.loading')}
    </div>
  )
}

/**
 * A bar shaped like the line it stands in for.
 *
 * A width per bar rather than one width repeated: a loading table has to read as
 * content arriving and not as a pattern, or a person waits without knowing what for.
 */
export const Skeleton = ({ width, className }: { width?: string; className?: string }) => (
  <span
    aria-hidden
    className={join('shimmer block h-2.5 rounded-md', className)}
    style={width === undefined ? undefined : { width }}
  />
)

/**
 * A list with nothing in it: an icon, one line, one sentence, one action.
 *
 * `action` rather than a button somewhere else on the screen: an empty list is the
 * one moment when what to do next is the only thing on the page, and a person reading
 * the sentence that explains it should not then have to go looking for the control it
 * describes.
 */
export const Empty = ({
  icon,
  title,
  tone = 'neutral',
  action,
  footnote,
  children,
}: {
  icon?: ReactNode
  title: string
  tone?: 'neutral' | 'danger'
  action?: ReactNode
  footnote?: ReactNode
  children?: ReactNode
}) => (
  <div className="flex flex-col items-center px-6 py-20 text-center">
    {icon !== undefined && (
      <div
        className={join(
          'mb-[18px] grid size-[46px] place-items-center rounded-xl',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-canvas text-ink-soft',
        )}
      >
        {icon}
      </div>
    )}
    <p className="text-section font-[650]">{title}</p>
    {children !== undefined && (
      <div className="mt-1.5 max-w-[400px] text-base text-ink-soft">{children}</div>
    )}
    {action !== undefined && <div className="mt-5 flex gap-2">{action}</div>}
    {footnote !== undefined && (
      <p className="mt-6 font-mono text-xs text-ink-subdued">{footnote}</p>
    )}
  </div>
)

/**
 * A line to type at a terminal.
 *
 * Selectable text and deliberately not a button: Studio is a client of the running
 * application and cannot reach the machine the project is checked out on. Offering to
 * run it would be a promise nothing here can keep.
 */
export const Snippet = ({ children }: { children: string }) => (
  <code className="block select-all rounded-lg bg-canvas px-3 py-2 text-left font-mono text-sm text-ink-soft">
    {children}
  </code>
)

/**
 * A refusal, said the way the application said it (SPEC.md §84).
 *
 * The message *and* the field messages, because a `VALIDATION_ERROR` keeps its meaning
 * in the second: `error.message` is the headline "Validation failed" and `error.fields`
 * is what actually went wrong. Rendering only the headline is how choosing an option in
 * a sort dropdown replaced a list with an empty red box, while the server's "Dynamic
 * entries sort by createdAt, updatedAt, publishedAt, status only" was thrown away by
 * the component that was given it.
 *
 * `except` names the fields a form is already showing against their own inputs, so the
 * box says what is left rather than everything twice.
 */
export const Failure = ({ error, except = [] }: { error: unknown; except?: readonly string[] }) => {
  const details = unshownMessages(error, except)
  const t = useT()

  /**
   * The application's own sentence, in the language the application wrote it in.
   *
   * Studio does not translate a refusal it did not write: `message` is the API's, and
   * guessing at its words here would be a second, drifting copy of them. The exception
   * is the one failure Studio invents — a response that was not our error shape at all,
   * where there is no sentence to pass on (see `failureOf` in `api/client.ts`).
   */
  const said =
    error instanceof ApiError && error.code === 'HTTP_ERROR'
      ? t('common.http', { status: String(error.status) })
      : error instanceof Error
        ? error.message
        : t('common.wentWrong')

  return (
    <Banner tone="danger" title={said}>
      {details.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {details.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </Banner>
  )
}
