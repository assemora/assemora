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

import { Field, Select } from '../ui/index.tsx'

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
}) => (
  <Field label={label}>
    <Select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">Theme default</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  </Field>
)

export const DesignControls = ({
  design,
  backgrounds,
  onChange,
}: {
  design: BlockDesign
  backgrounds: readonly string[]
  onChange: Change
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <Choice
        label="Space above"
        value={design.spacingTop}
        options={SPACING_SCALE}
        onChange={(spacingTop) => onChange({ spacingTop })}
      />
      <Choice
        label="Space below"
        value={design.spacingBottom}
        options={SPACING_SCALE}
        onChange={(spacingBottom) => onChange({ spacingBottom })}
      />
    </div>

    <div className="grid grid-cols-2 gap-3">
      <Choice
        label="Width"
        value={design.width}
        options={BLOCK_WIDTHS}
        onChange={(width) => onChange({ width })}
      />
      <Choice
        label="Container"
        value={design.container}
        options={CONTAINER_WIDTHS}
        onChange={(container) => onChange({ container })}
      />
    </div>

    <Choice
      label="Alignment"
      value={design.align}
      options={BLOCK_ALIGNMENTS}
      onChange={(align) => onChange({ align })}
    />

    <Choice
      label="Background"
      value={design.background}
      options={backgrounds}
      onChange={(background) => onChange({ background })}
    />

    <Field label="Hidden on" help="Responsive visibility. The block stays in the tree">
      <div className="flex gap-3 pt-1">
        {VIEWPORTS.map((viewport) => (
          <label key={viewport} className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={design.hiddenOn?.includes(viewport) === true}
              onChange={(event) => {
                const current = new Set(design.hiddenOn ?? [])

                if (event.target.checked) current.add(viewport)
                else current.delete(viewport)

                onChange({ hiddenOn: current.size === 0 ? null : [...current] })
              }}
            />
            {viewport}
          </label>
        ))}
      </div>
    </Field>
  </div>
)
