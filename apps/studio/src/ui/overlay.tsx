/**
 * Things drawn over the screen: a menu, a dialog, a toast.
 *
 * The one rule the handoff insists on is that a menu measures where it is before it
 * opens. Studio's tables and panels are scrollers, and a menu positioned relative to a
 * row inside one is clipped by it — so every menu here is `position: fixed`, anchored to
 * the trigger's box on screen, and flips above the trigger when the space below is less
 * than it needs. A fixed `top` is what put a row menu half under the table's own edge.
 */

import { X } from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button, join } from './index.tsx'

export type MenuPlacement = {
  left: number
  top: number
  maxHeight: number
  flipped: boolean
}

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
): MenuPlacement => {
  const [placement, setPlacement] = useState<MenuPlacement>({
    left: 0,
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

    setPlacement({
      left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
      top: flipped ? Math.max(8, box.top - GAP) : box.bottom + GAP,
      maxHeight: Math.max(120, Math.min(wanted, flipped ? above : below)),
      flipped,
    })
  }, [trigger, width, wanted])

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
        width,
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
              Close
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
            Cancel
          </Button>
          <Button variant="destructive" disabled={typed !== word} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      {children}
      <label className="mt-4 block text-base font-semibold text-ink">
        Type <span className="font-mono text-sm text-danger">{word}</span> to confirm
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="ring-field mt-1.5 block h-9 w-full rounded-lg border border-line bg-surface px-3 font-mono text-sm text-ink"
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
}) => (
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
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-1 opacity-55 hover:opacity-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    )}
  </div>
)
