/**
 * Things drawn over the screen: a menu, a dialog, a toast.
 *
 * The one rule the handoff insists on is that a menu measures where it is before it
 * opens. Studio's tables and panels are scrollers, and a menu positioned relative to a
 * row inside one is clipped by it — so every menu here is `position: fixed`, anchored to
 * the trigger's box on screen, and flips above the trigger when the space below is less
 * than it needs. A fixed `top` is what put a row menu half under the table's own edge.
 */

import { Check, ChevronDown, X } from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { useT, useWoven } from '../i18n/translate.tsx'
import { Button, Input, join } from './index.tsx'

export type MenuPlacement = {
  left: number
  /** What the panel should be: the width asked for, or the trigger's when stretched. */
  width: number
  top: number
  maxHeight: number
  flipped: boolean
}

/**
 * Which edge a panel is hung from.
 *
 * A menu is `end`: it hangs from the trigger's right edge at a width of its own, because
 * a 28px icon button says nothing about how wide its menu should be. A picker is
 * `stretch`: it *is* the field, so it takes the field's left edge and the field's width,
 * and the number passed becomes a floor rather than the answer.
 */
export type MenuAlign = 'end' | 'stretch'

/** The gap the design leaves between a trigger and the menu it opens. */
const GAP = 6

/** Below this, a menu opens upwards instead of being squeezed. */
const MINIMUM = 200

/**
 * Where a menu anchored to `trigger` fits, in viewport coordinates.
 *
 * Recomputed on scroll and resize while open, because a fixed element does not travel
 * with the scroller it was measured against — the menu would stay put while the row it
 * belongs to moved out from under it.
 */
export const useMenuPlacement = (
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
  width: number,
  wanted = 260,
  align: MenuAlign = 'end',
): MenuPlacement => {
  const [placement, setPlacement] = useState<MenuPlacement>({
    left: 0,
    width,
    top: 0,
    maxHeight: wanted,
    flipped: false,
  })

  const measure = useCallback(() => {
    const anchor = trigger.current
    if (anchor === null) return

    const box = anchor.getBoundingClientRect()
    const below = window.innerHeight - box.bottom - GAP - 8
    const above = box.top - GAP - 8
    const flipped = below < Math.min(wanted, MINIMUM) && above > below
    const across = align === 'stretch' ? Math.max(width, box.width) : width

    setPlacement({
      left: Math.max(
        8,
        Math.min(
          align === 'stretch' ? box.left : box.right - across,
          window.innerWidth - across - 8,
        ),
      ),
      width: across,
      top: flipped ? Math.max(8, box.top - GAP) : box.bottom + GAP,
      maxHeight: Math.max(120, Math.min(wanted, flipped ? above : below)),
      flipped,
    })
  }, [trigger, width, wanted, align])

  useLayoutEffect(() => {
    if (!open) return
    measure()

    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  return placement
}

/**
 * Escape, and a click anywhere that is not the menu or the button that opened it.
 *
 * The refs travel through a ref of their own rather than the dependency list: a caller
 * writes `useDismiss(open, close, panel, trigger)`, and a fresh array on every render
 * would re-subscribe on every render — a listener churn nobody asked for. What the
 * effect needs from them is read at the moment of the click, not at subscribe time.
 */
export const useDismiss = (
  open: boolean,
  onDismiss: () => void,
  ...inside: RefObject<HTMLElement | null>[]
) => {
  const kept = useRef(inside)
  kept.current = inside

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }

    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (kept.current.some((ref) => ref.current?.contains(target) === true)) return
      onDismiss()
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, onDismiss])
}

/**
 * A menu hung off a trigger.
 *
 * The caller owns `open` and the trigger's ref, because a menu is a state of the thing
 * that opened it — a row remembers that its own menu is showing, and two rows cannot
 * both be open.
 */
export const Menu = ({
  open,
  trigger,
  onDismiss,
  width = 200,
  maxHeight,
  label,
  children,
}: {
  open: boolean
  trigger: RefObject<HTMLElement | null>
  onDismiss(): void
  width?: number
  maxHeight?: number
  label: string
  children: ReactNode
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const placement = useMenuPlacement(trigger, open, width, maxHeight)

  useDismiss(open, onDismiss, panel, trigger)

  if (!open) return null

  return (
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      className="drop fixed z-50 overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-menu"
      style={{
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        ...(placement.flipped
          ? { bottom: window.innerHeight - placement.top }
          : { top: placement.top }),
      }}
    >
      {children}
    </div>
  )
}

/** A row in a menu: 34px, an icon in muted ink, the label in body. */
export const MenuItem = ({
  icon,
  tone = 'neutral',
  onClick,
  children,
}: {
  icon?: ReactNode
  tone?: 'neutral' | 'danger'
  onClick(): void
  children: ReactNode
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={join(
      'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-base',
      tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'hover:bg-canvas',
    )}
  >
    {icon !== undefined && (
      <span className={join('shrink-0', tone === 'danger' ? '' : 'text-ink-soft')}>{icon}</span>
    )}
    {children}
  </button>
)

export const MenuSeparator = () => <div className="mx-1 my-1.5 h-px bg-hairline" />

export const MenuHeading = ({ children }: { children: ReactNode }) => (
  <p className="mx-2.5 mt-2 mb-1 text-xs font-[650] tracking-[0.08em] text-ink-subdued uppercase">
    {children}
  </p>
)

/* --------------------------------------------------------------------------- picker */

export type PickerOption = {
  readonly value: string
  /** The machine's own word for it — `richText` — so it is set in mono. */
  readonly label: string
  /** One line saying what a value of this kind is. */
  readonly help?: string
  readonly icon?: ReactNode
}

export type PickerGroup = {
  readonly label: string
  readonly options: readonly PickerOption[]
}

/**
 * A dropdown whose options are explained (`design_handoff_studio_redesign` §3).
 *
 * `Select` is the native control and is the right one almost everywhere: the platform's
 * behaviour on a phone, with a keyboard and under a screen reader is better than
 * anything written here. It cannot do one thing, and the Kind dropdown needs exactly
 * that thing — an option that is an icon, a machine name and a sentence about what it
 * means. `<option>` holds text.
 *
 * So this exists for the one place where the *explanation* is the point: somebody
 * choosing between `text`, `richText` and `markdown` is choosing between three words
 * they have no reason to know apart. Everywhere the options speak for themselves,
 * `Select` stays.
 *
 * Positioned against the viewport and flipped above the trigger when the space below is
 * short, for the reason every menu here is: this list sits inside a scroller, and a
 * panel positioned inside one is clipped by the edge it needs to cross.
 */
export const Picker = ({
  value,
  groups,
  onChange,
  label,
  disabled = false,
  invalid = false,
}: {
  value: string
  groups: readonly PickerGroup[]
  onChange(value: string): void
  /** What the control is, for a screen reader: the field's own label. */
  label: string
  disabled?: boolean
  invalid?: boolean
}) => {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const placement = useMenuPlacement(trigger, open, 244, 306, 'stretch')

  useDismiss(open, () => setOpen(false), panel, trigger)

  const chosen = groups.flatMap((group) => group.options).find((option) => option.value === value)

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((showing) => !showing)}
        className={join(
          'flex h-9 w-full items-center gap-2 rounded-lg border bg-surface px-2.5 text-left text-base',
          'disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-ink-disabled',
          invalid ? 'ring-field-danger' : 'ring-field border-line hover:border-line-strong',
        )}
      >
        {chosen?.icon !== undefined && (
          <span aria-hidden className="shrink-0 text-ink-soft">
            {chosen.icon}
          </span>
        )}
        <span className="min-w-0 truncate">{chosen?.label ?? value}</span>
        <ChevronDown aria-hidden className="ml-auto size-[18px] shrink-0 text-ink-soft" />
      </button>

      {open && (
        <div
          ref={panel}
          role="listbox"
          aria-label={label}
          className="drop fixed z-50 overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-menu"
          style={{
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
            ...(placement.flipped
              ? { bottom: window.innerHeight - placement.top }
              : { top: placement.top }),
          }}
        >
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mx-2 mt-1.5 mb-1 text-xs font-[650] tracking-[0.06em] text-ink-faint uppercase">
                {group.label}
              </p>
              {group.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={join(
                    'flex w-full items-center gap-2.5 rounded-lg p-2 text-left',
                    option.value === value ? 'bg-canvas' : 'hover:bg-canvas',
                  )}
                >
                  {option.icon !== undefined && (
                    <span aria-hidden className="shrink-0 text-ink-soft">
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-ink">{option.label}</span>
                    {option.help !== undefined && (
                      <span className="mt-px block text-xs leading-[1.35] text-ink-subdued">
                        {option.help}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Check aria-hidden className="ml-auto size-4 shrink-0 text-ink-strong" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * A question that stops everything until it is answered.
 *
 * Radius 18 and the deepest of the four shadows, over a `rgba(17,18,38,0.32)` scrim —
 * a dialog is the only surface in Studio allowed to dim what is behind it.
 */
export const Dialog = ({
  open,
  title,
  onClose,
  footer,
  width = 440,
  children,
}: {
  open: boolean
  title: string
  onClose(): void
  footer?: ReactNode
  width?: number
  children?: ReactNode
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const t = useT()

  useDismiss(open, onClose, panel)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[rgb(17_18_38/0.32)] p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="rise w-full rounded-[18px] bg-surface p-[22px] shadow-dialog"
        style={{ maxWidth: width }}
      >
        <h2 className="text-section font-[650]">{title}</h2>
        {children !== undefined && <div className="mt-2 text-base text-ink-soft">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          {footer ?? (
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A dialog that will not act until its subject is typed out in full.
 *
 * The handoff puts this behind every irreversible action. The word is the name of the
 * thing being destroyed rather than "DELETE", so muscle memory cannot carry somebody
 * through it: typing `assemora.co` means having read which workspace this is.
 */
export const ConfirmByTyping = ({
  open,
  title,
  word,
  action,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  word: string
  action: string
  onClose(): void
  onConfirm(): void
  children?: ReactNode
}) => {
  const [typed, setTyped] = useState('')
  const t = useT()
  const woven = useWoven()
  const id = useId()

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={typed !== word} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      {children}
      <label htmlFor={id} className="mt-4 block text-base font-semibold text-ink">
        {woven('common.confirmByTyping', {
          word: <span className="font-mono text-sm text-danger">{word}</span>,
        })}
        <Input
          id={id}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 block font-mono text-sm"
        />
      </label>
    </Dialog>
  )
}

/**
 * One line of news, bottom-left, for five seconds.
 *
 * Chrome-coloured rather than in the palette of what happened: a toast reports that
 * something *did* happen, and the screen behind it already shows what. Only a banner
 * carries a state's colour.
 */
export const Toast = ({
  icon,
  action,
  onDismiss,
  children,
}: {
  icon?: ReactNode
  action?: { label: string; onClick(): void }
  onDismiss?(): void
  children: ReactNode
}) => {
  const t = useT()

  return (
    <div
      role="status"
      className="rise fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-[10px] bg-chrome px-3 py-2.5 text-base text-chrome-ink shadow-menu"
    >
      {icon !== undefined && <span className="text-accent-soft">{icon}</span>}
      {children}
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-2 font-semibold text-sm text-ink-faint hover:text-white"
        >
          {action.label}
        </button>
      )}
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label={t('common.dismiss')}
          onClick={onDismiss}
          className="ml-1 opacity-55 hover:opacity-100"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  )
}
