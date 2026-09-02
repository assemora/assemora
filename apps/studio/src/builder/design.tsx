/**
 * The universal design controls (SPEC.md §61, `design_handoff_studio_redesign` §4).
 *
 * Seven settings, on every block, whatever its schema says. They are tokens rather than
 * CSS on purpose: this is not a stylesheet editor, and what `lg` looks like is the
 * theme's answer rather than this panel's (SPEC.md §62).
 *
 * Every one is a control you can see the whole of at once — a segmented track, a row of
 * swatches, a row of chips — and never a dropdown. The difference is not decoration: a
 * `<select>` hides the scale behind a click, and the scale *is* the thing being taught
 * here. Somebody choosing `md` over `lg` is choosing a step on a ladder they can only
 * judge by seeing the whole ladder.
 */
import {
  BLOCK_ALIGNMENTS,
  BLOCK_WIDTHS,
  type BlockDesign,
  CONTAINER_WIDTHS,
  SPACING_SCALE,
  VIEWPORTS,
} from '@assemora/schema'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ThemeColor } from '../api/theme.ts'
import { useT } from '../i18n/translate.tsx'
import { Field, join, Segmented } from '../ui/index.tsx'

type Change = (patch: Readonly<Record<string, unknown>>) => void

/**
 * The value that means "say nothing and let the theme answer".
 *
 * A segmented control's value is a string, and absence is not one — so `theme` stands in
 * across the control and becomes `null` on the way out, which is what clears a token.
 */
const THEME = ''

const Tokens = ({
  label,
  help,
  value,
  options,
  onChange,
}: {
  label: string
  help?: string
  value: string | undefined
  options: readonly string[]
  onChange(value: string | null): void
}) => {
  const t = useT()

  return (
    <Field label={label} {...(help === undefined ? {} : { help })}>
      <Segmented
        label={label}
        value={value ?? THEME}
        onChange={(next) => onChange(next === THEME ? null : next)}
        options={[
          { value: THEME, label: t('design.themeShort'), title: t('design.themeDefault') },
          ...options.map((option) => ({ value: option, label: option, title: option })),
        ]}
      />
      {/*
       * A token this block names that the theme no longer declares.
       *
       * Kept on screen and kept selected, because it is what the block actually says —
       * dropping it would read as "theme default" and quietly rewrite the block the next
       * time anybody touched another control.
       */}
      {value !== undefined && !options.includes(value) && (
        <p className="mt-1.5 text-sm text-warning-ink">
          {t('design.notInTheme', { token: value })}
        </p>
      )}
    </Field>
  )
}

/**
 * The colours the theme declares, painted rather than named.
 *
 * A list of names is a list of words to imagine; the whole point of a background is what
 * it looks like. The first swatch is the theme's own answer, hatched so that "no colour
 * chosen" cannot be mistaken for a white one.
 */
const Backgrounds = ({
  value,
  colors,
  onChange,
}: {
  value: string | undefined
  colors: readonly ThemeColor[]
  onChange(value: string | null): void
}) => {
  const t = useT()

  const swatch = (name: string | null, paint: string | undefined) => {
    const chosen = name === null ? value === undefined : value === name

    return (
      <button
        key={name ?? THEME}
        type="button"
        title={name ?? t('design.themeDefault')}
        aria-label={name ?? t('design.themeDefault')}
        aria-pressed={chosen}
        onClick={() => onChange(name)}
        className={join(
          'size-[34px] rounded-[9px]',
          chosen
            ? 'border-2 border-ink-strong shadow-[inset_0_0_0_2px_#fff]'
            : 'border border-black/12',
        )}
        style={
          paint === undefined
            ? {
                backgroundImage:
                  'repeating-linear-gradient(45deg, #f1f1f1 0 5px, #e6e6e6 5px 10px)',
              }
            : { background: paint }
        }
      />
    )
  }

  return (
    <Field label={t('design.background')} help={t('design.backgroundHelp')}>
      <div className="flex flex-wrap gap-2">
        {swatch(null, undefined)}
        {colors.map((color) => swatch(color.name, color.value))}
        {/* A background the theme no longer declares still has to be shown, and there is
            no colour left to paint it in — so it is named instead of drawn. */}
        {value !== undefined && !colors.some((color) => color.name === value) && (
          <span className="inline-flex h-[34px] items-center rounded-[9px] border border-warning-line bg-warning-wash px-2.5 font-mono text-sm text-warning-ink">
            {value}
          </span>
        )}
      </div>
    </Field>
  )
}

const VIEWPORT_ICONS: Readonly<Record<string, ReactNode>> = {
  desktop: <Monitor className="size-4" />,
  tablet: <Tablet className="size-4" />,
  mobile: <Smartphone className="size-4" />,
}

/** Which widths this block is not drawn at. It stays in the tree either way. */
const HideOn = ({
  value,
  onChange,
}: {
  value: readonly string[] | undefined
  onChange(value: readonly string[] | null): void
}) => {
  const t = useT()
  const hidden = value ?? []

  return (
    <Field label={t('design.hiddenOn')} help={t('design.hiddenOnHelp')}>
      <div className="flex flex-wrap gap-1.5">
        {VIEWPORTS.map((viewport) => {
          const on = hidden.includes(viewport)

          return (
            <button
              key={viewport}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = on ? hidden.filter((each) => each !== viewport) : [...hidden, viewport]

                onChange(next.length === 0 ? null : next)
              }}
              className={join(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold',
                on
                  ? 'border-ink-strong bg-ink-strong text-white'
                  : 'border-line bg-surface text-ink-body hover:border-line-strong',
              )}
            >
              <span aria-hidden>{VIEWPORT_ICONS[viewport]}</span>
              {viewport}
            </button>
          )
        })}
      </div>
    </Field>
  )
}

export const DesignControls = ({
  design,
  backgrounds,
  onChange,
}: {
  design: BlockDesign
  backgrounds: readonly ThemeColor[]
  onChange: Change
}) => {
  const t = useT()

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-subdued">{t('design.sevenControls')}</p>

      <Tokens
        label={t('design.spaceAbove')}
        value={design.spacingTop}
        options={SPACING_SCALE}
        onChange={(spacingTop) => onChange({ spacingTop })}
      />
      <Tokens
        label={t('design.spaceBelow')}
        value={design.spacingBottom}
        options={SPACING_SCALE}
        onChange={(spacingBottom) => onChange({ spacingBottom })}
      />
      <Tokens
        label={t('design.width')}
        value={design.width}
        options={BLOCK_WIDTHS}
        onChange={(width) => onChange({ width })}
      />
      <Tokens
        label={t('design.container')}
        help={t('design.containerHelp')}
        value={design.container}
        options={CONTAINER_WIDTHS}
        onChange={(container) => onChange({ container })}
      />
      <Tokens
        label={t('design.alignment')}
        value={design.align}
        options={BLOCK_ALIGNMENTS}
        onChange={(align) => onChange({ align })}
      />

      <Backgrounds
        value={design.background}
        colors={backgrounds}
        onChange={(background) => onChange({ background })}
      />

      <HideOn value={design.hiddenOn} onChange={(hiddenOn) => onChange({ hiddenOn })} />
    </div>
  )
}
