/**
 * One control per kind of token value (SPEC.md §62).
 *
 * A theme is edited by kind, not as text: a colour gets a colour picker, a length
 * gets a number and a unit, a font stack gets the ordered list of families it is.
 * That is the same idea the command enforces one layer down — a value is a colour or
 * a length or a stack, never a fragment of a stylesheet — expressed as inputs that
 * cannot easily produce anything else.
 *
 * These controls are not the check. `theme.update` decides what a value may be, and
 * a value it refuses comes back as a field error like any other; what they do is keep
 * a person from having to find that out by saving.
 */
import { useEffect, useState } from 'react'

import type { FontStack, TokenValue } from '../api/theme.ts'
import { Button, Input, Select } from '../ui/index.tsx'
import type { TokenKind } from './tokens.ts'

/**
 * The units a theme may use.
 *
 * A copy of the list `@assemora/theme` enforces, because Studio cannot import a
 * server package (it versions the stylesheet with `node:crypto`). A unit missing here
 * is a unit nobody can pick; a unit here that the command has dropped comes back as a
 * field error rather than a silent write.
 */
const UNITS = ['rem', 'px', 'em', 'ch', '%', 'vw', 'vh'] as const

const LENGTH = /^(\d{1,5}(?:\.\d{1,4})?)([a-z%]{0,3})$/

const partsOf = (value: string): { amount: string; unit: string } => {
  const match = LENGTH.exec(value.trim())

  if (match === null) return { amount: '', unit: 'rem' }

  const [, amount = '', unit = ''] = match

  // A bare `0` carries no unit, which is what the defaults hold and what the
  // stylesheet writes back out for any zero.
  return { amount, unit: unit === '' ? 'rem' : unit }
}

const composed = (amount: string, unit: string): string =>
  Number(amount) === 0 ? '0' : `${amount}${unit}`

/**
 * A number that is allowed to be half-typed.
 *
 * `1.` and an empty box are both states on the way to a value and neither is one, so
 * they live here and nothing is reported upward until the box holds a number. Without
 * that, clearing the field to retype it would snap back to what was there.
 */
const Amount = ({
  value,
  min,
  max,
  step,
  className,
  onChange,
}: {
  value: string
  min: number
  max?: number
  step: number
  className?: string
  onChange(amount: string): void
}) => {
  const [typed, setTyped] = useState(value)

  useEffect(() => setTyped(value), [value])

  return (
    <Input
      type="number"
      inputMode="decimal"
      min={min}
      {...(max === undefined ? {} : { max })}
      step={step}
      value={typed}
      className={className}
      onChange={(event) => {
        const next = event.target.value

        setTyped(next)

        if (next !== '' && Number.isFinite(Number(next))) onChange(next)
      }}
    />
  )
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A colour, with a picker for the common case and text for the rest.
 *
 * `<input type="color">` can only say `#rrggbb`, and a theme may also say
 * `transparent`, `currentColor` or hex with alpha — so the text field is the value
 * and the picker is a way of writing into it. Only a value that matched a hex pattern
 * *here* is ever handed to the swatch as a style; everything else gets a labelled
 * chip, so no stored string reaches a declaration by being echoed.
 */
export const ColorInput = ({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) => {
  const isHex = HEX.test(value)
  const pickable = /^#[0-9a-f]{6}$/i.test(value)

  return (
    <div className="flex items-center gap-2">
      {pickable ? (
        <input
          type="color"
          aria-label="Pick a colour"
          value={value.toLowerCase()}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-0.5"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <span
          aria-hidden="true"
          title={value}
          className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed border-line text-[0.6rem] text-ink-faint"
          {...(isHex ? { style: { background: value } } : {})}
        >
          {isHex ? '' : 'abc'}
        </span>
      )}

      <Input
        value={value}
        spellCheck={false}
        className="font-mono text-xs"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export const LengthInput = ({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) => {
  const { amount, unit } = partsOf(value)

  return (
    <div className="flex items-center gap-2">
      <Amount
        value={amount}
        min={0}
        step={0.25}
        onChange={(next) => onChange(composed(next, unit))}
      />
      <Select
        aria-label="Unit"
        className="w-24 shrink-0"
        value={unit}
        onChange={(event) => onChange(composed(amount === '' ? '0' : amount, event.target.value))}
      >
        {UNITS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {/* A unit this list does not know is still what the theme says, so it stays
            selectable rather than silently becoming the first option. */}
        {(UNITS as readonly string[]).includes(unit) ? null : <option value={unit}>{unit}</option>}
      </Select>
    </div>
  )
}

/**
 * A font stack, drawn as what it is: an ordered list of families.
 *
 * Order is the whole point — the browser takes the first family it has — so the list
 * can be reordered and the last entry is expected to be a generic family. A family
 * already in the stack is not added twice, because the second one can never be
 * reached.
 */
export const FontStackInput = ({
  value,
  onChange,
}: {
  value: FontStack
  onChange(value: FontStack): void
}) => {
  const [typed, setTyped] = useState('')

  const add = () => {
    const family = typed.trim()

    if (family === '' || value.includes(family)) return

    onChange([...value, family])
    setTyped('')
  }

  return (
    <div className="space-y-1.5">
      <ol className="flex flex-wrap gap-1.5">
        {value.map((family, at) => (
          <li
            key={family}
            className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs"
          >
            <span className="font-mono">{family}</span>
            <button
              type="button"
              aria-label={`Move ${family} earlier`}
              disabled={at === 0}
              className="text-ink-faint transition hover:text-ink disabled:opacity-30"
              onClick={() => {
                const next = [...value]
                const [moved] = next.splice(at, 1)

                if (moved !== undefined) next.splice(at - 1, 0, moved)

                onChange(next)
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Remove ${family}`}
              className="text-ink-faint transition hover:text-danger"
              onClick={() => onChange(value.filter((entry) => entry !== family))}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <Input
          value={typed}
          placeholder="Add a family, such as Inter or sans-serif"
          spellCheck={false}
          className="text-xs"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return

            event.preventDefault()
            add()
          }}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}

/** The control for one kind of token, given whatever the document actually held. */
export const TokenInput = ({
  kind,
  value,
  onChange,
}: {
  kind: TokenKind
  value: TokenValue | undefined
  onChange(value: TokenValue): void
}) => {
  if (kind === 'fontStack') {
    return <FontStackInput value={Array.isArray(value) ? value : []} onChange={onChange} />
  }

  if (kind === 'color') {
    return <ColorInput value={typeof value === 'string' ? value : ''} onChange={onChange} />
  }

  if (kind === 'length') {
    return <LengthInput value={typeof value === 'string' ? value : ''} onChange={onChange} />
  }

  const number = typeof value === 'number' ? String(value) : ''

  return kind === 'weight' ? (
    <Amount
      value={number}
      min={1}
      max={1000}
      step={50}
      className="max-w-28"
      onChange={(next) => onChange(Number(next))}
    />
  ) : (
    <Amount
      value={number}
      min={0.5}
      max={10}
      step={0.05}
      className="max-w-28"
      onChange={(next) => onChange(Number(next))}
    />
  )
}
