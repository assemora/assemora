/**
 * Choosing what a collection is drawn as (SPEC.md §58).
 *
 * A grid rather than a dropdown, and a grid rather than a name typed by hand: the
 * question is "which of these?" and the answer is a picture, so the control shows the
 * pictures. Sixty-one of them in one wall is a scroll nobody reads, which is why the set
 * arrives grouped — the same reason the kind picker is grouped.
 *
 * It is offered only where it can be honoured: a collection made in Studio holds its
 * icon in its own definition, and a resource declared in TypeScript holds it in
 * `resource(…, { icon })`, which no screen may rewrite.
 */
import { useState } from 'react'

import { useT } from '../i18n/translate.tsx'
import { ICON_GROUPS, ResourceIcon } from '../ui/icons.tsx'
import { Field, join } from '../ui/index.tsx'

export const IconField = ({
  value,
  onChange,
}: {
  /** The chosen name, or the empty string for "nobody said". */
  value: string
  onChange(icon: string): void
}) => {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <Field label={t('editor.icon')} help={t('editor.iconHelp')}>
      <div className="space-y-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((showing) => !showing)}
          className="ring-field flex h-9 items-center gap-2.5 rounded-lg border border-line bg-surface pr-3 pl-2.5 text-base hover:border-line-strong"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-canvas text-ink-soft">
            <ResourceIcon name={value === '' ? undefined : value} className="size-4" />
          </span>
          <span className={value === '' ? 'text-ink-subdued' : 'font-mono text-sm'}>
            {value === '' ? t('editor.iconDefault') : value}
          </span>
        </button>

        {open && (
          <div className="drop max-h-72 space-y-3 overflow-auto rounded-xl border border-line bg-surface p-3">
            {ICON_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-xs font-[650] tracking-[0.06em] text-ink-faint uppercase">
                  {t(group.label)}
                </p>
                <div className="flex flex-wrap gap-1">
                  {group.names.map((name) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      aria-label={name}
                      aria-pressed={name === value}
                      onClick={() => {
                        // Pressing the chosen one again clears it: there is no other way
                        // back to "nobody said", and a control that can only ever be set
                        // is one somebody has to edit JSON to undo.
                        onChange(name === value ? '' : name)
                        setOpen(false)
                      }}
                      className={join(
                        'grid size-8 place-items-center rounded-lg border',
                        name === value
                          ? 'border-accent bg-accent-wash text-accent-ink'
                          : 'border-transparent text-ink-soft hover:bg-canvas',
                      )}
                    >
                      <ResourceIcon name={name} className="size-[18px]" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}
