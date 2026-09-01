/**
 * What the tokens look like (SPEC.md §61, §62).
 *
 * A panel rather than the builder canvas, and the reason is not weight. The canvas is
 * an iframe running the application's frontend against the *served* stylesheet, so it
 * shows the theme as it was last saved; showing an unsaved one would mean sending the
 * document into the frame and turning it into CSS there — a second path from the
 * document to a stylesheet, which is the surface §62 exists to close. A theme is also
 * not a page: an application can have no pages at all and still have a theme, and the
 * canvas needs one to render.
 *
 * What keeps this from being a second opinion about what a token means is that it has
 * no opinion. It plants each value under the custom property the generated stylesheet
 * declares — `--space-xl`, `--text-section`, the bare `--brand` — and every sample below
 * reads it back with `var()`, which is exactly what a block does. The only thing this
 * file decides is which sample to draw.
 *
 * Values reach the page through `setProperty`, never through a string that becomes
 * CSS text. The CSSOM parses what it is given and drops a declaration it cannot
 * parse, so a stored value can be wrong but cannot escape into a rule of its own.
 */
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'

import type { TokenValue } from '../api/theme.ts'
import { useT, useWoven } from '../i18n/translate.tsx'
import { namesIn, type TokenMap } from './draft.ts'
import { COLORS, GROUPS, keyOf, RADIUS, SPACING } from './tokens.ts'

const cssValue = (value: TokenValue | undefined): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)

  // A font stack, written the way CSS writes one. The families are not quoted
  // because a name a theme may hold is already a sequence of CSS identifiers, and
  // the CSSOM drops the declaration outright if one somehow is not.
  return value.length === 0 ? undefined : value.join(', ')
}

const Label = ({ children }: { children: ReactNode }) => (
  <p className="px-3 pt-3 text-xs font-medium uppercase tracking-wide text-ink-faint">{children}</p>
)

/**
 * The sample's own tokens.
 *
 * Every name here is one the framework's defaults declare, and a theme can override a
 * default but cannot remove it — the row holds overrides and the defaults live in
 * code — so these always resolve to something. A colour the *site* added shows up in
 * the palette below instead, where its name is the label.
 */
const SURFACE: CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--text-md)',
  lineHeight: 'var(--leading-normal)',
}

const Sample = () => {
  const t = useT()

  return (
    <div style={{ ...SURFACE, padding: 'var(--space-sm)' }} className="space-y-3">
      <h3
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--text-title)',
          fontWeight: 'var(--weight-bold)',
          lineHeight: 'var(--leading-tight)',
        }}
      >
        {t('preview.heading')}
      </h3>

      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--text-sm)' }}>{t('preview.body')}</p>

      <div
        style={{
          background: 'var(--surface-sunken)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-xs)',
        }}
      >
        <p style={{ fontSize: 'var(--text-sm)' }}>{t('preview.sunken')}</p>
      </div>

      <span
        style={{
          display: 'inline-block',
          background: 'var(--brand)',
          color: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          padding: '0.5rem 1rem',
        }}
      >
        {t('preview.button')}
      </span>
    </div>
  )
}

/** Three blocks, at three steps of the scale, so a step is a distance rather than a word. */
const Spacings = () => {
  const t = useT()

  return (
    <div style={SURFACE}>
      {(['sm', 'lg', '2xl'] as const).map((step) => (
        <div
          key={step}
          style={{
            paddingTop: `var(${SPACING.property(step)})`,
            paddingBottom: `var(${SPACING.property(step)})`,
            borderTop: '1px solid var(--line)',
          }}
        >
          <p
            style={{
              background: 'var(--surface-sunken)',
              fontSize: 'var(--text-sm)',
              padding: '0.25rem 0.5rem',
            }}
          >
            {t('preview.spaceStep', { step })}
          </p>
        </div>
      ))}
    </div>
  )
}

const Radii = ({ names }: { names: readonly string[] }) => (
  <div className="flex flex-wrap items-end gap-2 p-3">
    {names.map((name) => (
      <div key={name} className="space-y-1 text-center">
        <div
          className="size-10"
          style={{ background: 'var(--brand-soft)', borderRadius: `var(${RADIUS.property(name)})` }}
        />
        <p className="font-mono text-xs text-ink-faint">{name}</p>
      </div>
    ))}
  </div>
)

const Palette = ({ names }: { names: readonly string[] }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2 p-3">
    {names.map((name) => (
      <div key={name} className="space-y-1">
        <div
          className="h-8 rounded-md border border-line"
          style={{ background: `var(${COLORS.property(name)})` }}
        />
        <p className="truncate font-mono text-xs text-ink-faint" title={name}>
          {name}
        </p>
      </div>
    ))}
  </div>
)

export const Preview = ({ tokens, cssVersion }: { tokens: TokenMap; cssVersion?: string }) => {
  const root = useRef<HTMLDivElement>(null)
  const t = useT()
  const woven = useWoven()

  useEffect(() => {
    const node = root.current

    if (node === null) return

    // Cleared first, so a token somebody removed stops resolving here too — otherwise
    // the preview would keep drawing with a value the site no longer has.
    for (const property of Array.from(node.style)) node.style.removeProperty(property)

    for (const group of GROUPS) {
      for (const name of namesIn(tokens, group)) {
        const written = cssValue(tokens.get(keyOf(group, name)))

        if (written !== undefined) node.style.setProperty(group.property(name), written)
      }
    }
  }, [tokens])

  return (
    <div ref={root} className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      <Sample />
      <div>
        <Label>{t('design.group.spacing')}</Label>
        <Spacings />
      </div>
      <div>
        <Label>{t('preview.corners')}</Label>
        <Radii names={namesIn(tokens, RADIUS)} />
      </div>
      <div>
        <Label>{t('preview.everyColour')}</Label>
        <Palette names={namesIn(tokens, COLORS)} />
      </div>
      {cssVersion !== undefined && (
        <p className="p-3 text-sm text-ink-faint">
          {woven('preview.stylesheet', {
            version: <code className="font-mono">{cssVersion}</code>,
          })}
        </p>
      )}
    </div>
  )
}
