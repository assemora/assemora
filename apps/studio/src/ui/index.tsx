/**
 * Studio's small vocabulary of controls.
 *
 * Not a design system — the surface Studio itself is drawn with. Blocks and content
 * are rendered by the application's own frontend, never by these (SPEC.md §59).
 */
import {
  type ButtonHTMLAttributes,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  use,
  useId,
} from 'react'

const join = (...classes: (string | false | undefined)[]): string =>
  classes.filter(Boolean).join(' ')

const VARIANTS = {
  primary: 'bg-accent text-white hover:brightness-110 disabled:bg-ink-faint',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-sunken',
  ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110',
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: 'sm' | 'md'
}

export const Button = ({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) => (
  <button
    type="button"
    className={join(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
      'disabled:cursor-not-allowed disabled:opacity-60',
      size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
      VARIANTS[variant],
      className,
    )}
    {...rest}
  />
)

/**
 * The id `Field` minted, so a control can claim the label without every call site
 * naming one. Containment would associate them too, but an explicit `for` survives
 * a control that later grows a wrapper.
 */
const FieldId = createContext<string | undefined>(undefined)

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition focus:border-accent focus:outline-none disabled:bg-surface-sunken'

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input id={use(FieldId)} className={join(CONTROL, className)} {...rest} />
)

export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea id={use(FieldId)} className={join(CONTROL, 'min-h-24 resize-y', className)} {...rest} />
)

export const Select = ({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    id={use(FieldId)}
    className={join(CONTROL, 'appearance-none pr-8', className)}
    {...rest}
  />
)

export const Field = ({
  label,
  help,
  required,
  errors,
  children,
}: {
  label: string
  help?: string | undefined
  required?: boolean
  errors?: readonly string[]
  children: ReactNode
}) => {
  const id = useId()

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1 text-sm font-medium text-ink">
        {label}
        {required === true && <span className="text-danger">*</span>}
      </label>
      <FieldId value={id}>{children}</FieldId>
      {help !== undefined && errors === undefined && (
        <p className="text-xs text-ink-soft">{help}</p>
      )}
      {errors?.map((error) => (
        <p key={error} className="text-xs text-danger">
          {error}
        </p>
      ))}
    </div>
  )
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={join('rounded-xl border border-line bg-surface-raised', className)}>
    {children}
  </div>
)

export const Badge = ({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'positive' | 'accent' | 'danger'
}) => (
  <span
    className={join(
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
      tone === 'positive' && 'bg-positive-soft text-positive',
      tone === 'accent' && 'bg-accent-soft text-accent',
      tone === 'danger' && 'bg-danger-soft text-danger',
      tone === 'neutral' && 'bg-surface-sunken text-ink-soft',
    )}
  >
    {children}
  </span>
)

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex items-center gap-2 text-sm text-ink-soft" role="status">
    <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
    {label}
  </div>
)

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
    <p className="text-sm font-medium text-ink">{title}</p>
    {children !== undefined && <div className="text-sm text-ink-soft">{children}</div>}
  </div>
)

export const Failure = ({ error }: { error: unknown }) => (
  <Card className="border-danger/30 bg-danger-soft p-4">
    <p className="text-sm font-medium text-danger">
      {error instanceof Error ? error.message : 'Something went wrong'}
    </p>
  </Card>
)
