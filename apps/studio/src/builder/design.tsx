/**
 * The universal design controls (SPEC.md §61).
 *
 * Seven settings, on every block, whatever its schema says. They are tokens rather
 * than CSS on purpose: this is not a stylesheet editor, and what `lg` looks like is
 * the theme's answer, not this panel's (SPEC.md §62).
 */
import {
  BLOCK_ALIGNMENTS,
  BLOCK_WIDTHS,
  type BlockDesign,
  CONTAINER_WIDTHS,
  SPACING_SCALE,
  VIEWPORTS,
} from '@assemora/schema'

import { useT } from '../i18n/translate.tsx'
import { Checkbox, Field, Select } from '../ui/index.tsx'

type Change = (patch: Readonly<Record<string, unknown>>) => void

const Choice = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | undefined
  options: readonly string[]
  onChange(value: string | null): void
}) => {
  const t = useT()

  return (
    <Field label={label}>
      <Select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('design.themeDefault')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {/*
         * A token this block names that the theme no longer declares.
         *
         * It stays on screen and stays selected, because it is what the block actually
         * says — dropping it would read as "theme default" and quietly rewrite the
         * block the next time anybody touched another control.
         */}
        {value === undefined || options.includes(value) ? null : (
          <option value={value}>{t('design.notInTheme', { token: value })}</option>
        )}
      </Select>
    </Field>
  )
}

export const DesignControls = ({
  design,
  backgrounds,
  onChange,
}: {
  design: BlockDesign
  backgrounds: readonly string[]
  onChange: Change
}) => {
  const t = useT()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Choice
          label={t('design.spaceAbove')}
          value={design.spacingTop}
          options={SPACING_SCALE}
          onChange={(spacingTop) => onChange({ spacingTop })}
        />
        <Choice
          label={t('design.spaceBelow')}
          value={design.spacingBottom}
          options={SPACING_SCALE}
          onChange={(spacingBottom) => onChange({ spacingBottom })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Choice
          label={t('design.width')}
          value={design.width}
          options={BLOCK_WIDTHS}
          onChange={(width) => onChange({ width })}
        />
        <Choice
          label={t('design.container')}
          value={design.container}
          options={CONTAINER_WIDTHS}
          onChange={(container) => onChange({ container })}
        />
      </div>

      <Choice
        label={t('design.alignment')}
        value={design.align}
        options={BLOCK_ALIGNMENTS}
        onChange={(align) => onChange({ align })}
      />

      <Choice
        label={t('design.background')}
        value={design.background}
        options={backgrounds}
        onChange={(background) => onChange({ background })}
      />

      <Field label={t('design.hiddenOn')} help={t('design.hiddenOnHelp')}>
        <div className="flex gap-3 pt-1">
          {VIEWPORTS.map((viewport) => (
            <Checkbox
              key={viewport}
              checked={design.hiddenOn?.includes(viewport) === true}
              onChange={(hidden) => {
                const current = new Set(design.hiddenOn ?? [])

                if (hidden) current.add(viewport)
                else current.delete(viewport)

                onChange({ hiddenOn: current.size === 0 ? null : [...current] })
              }}
            >
              {viewport}
            </Checkbox>
          ))}
        </div>
      </Field>
    </div>
  )
}
