/**
 * What the blocks of `src/blocks.ts` look like (SPEC.md §57).
 *
 * A declaration says what a block is; these say what it looks like, and they belong to
 * the site: change one and every page using the block changes with it, without a single
 * stored tree being touched.
 *
 * None of them positions itself. Spacing, width, alignment, background and visibility
 * arrive as a wrapper the renderer draws from the universal controls, and `theme.css`
 * decides what each token means — which is what keeps those controls universal
 * (SPEC.md §61).
 */
import type { BlockViewProps } from '@assemora/react'
import { useEffect, useState } from 'react'

/**
 * Reads one of the public routes in `src/routes.ts`.
 *
 * No credentials: these endpoints exist precisely so a visitor with no session can
 * read them, and sending a cookie the site does not need would only make the fetch
 * fail differently in the builder canvas.
 */
const usePublic = <T,>(path: string, empty: T): T => {
  const [value, setValue] = useState<T>(empty)

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      const response = await fetch(path, { signal: controller.signal })

      if (response.ok) setValue((await response.json()) as T)
    }

    load().catch(() => undefined)

    return () => controller.abort()
  }, [path])

  return value
}

export const HeroView = ({
  props,
}: BlockViewProps<{
  readonly headline?: string
  readonly subhead?: string
  readonly image?: string
  readonly action?: string
  readonly href?: string
  readonly variant?: string
}>) => (
  <header className="hero" data-variant={props.variant ?? 'centered'}>
    <div>
      <h1>{props.headline}</h1>
      {props.subhead !== undefined && <p>{props.subhead}</p>}
      {props.action !== undefined && props.href !== undefined && (
        <a className="button" href={props.href}>
          {props.action}
        </a>
      )}
    </div>
    {props.image !== undefined && props.image !== '' && <img src={props.image} alt="" />}
  </header>
)

/**
 * The one view that draws `children`.
 *
 * The renderer has already turned the child nodes into elements; this decides where
 * they go. A block that accepts children and ignores them is a block that silently
 * eats whatever an editor nests inside it.
 */
export const SectionView = ({
  props,
  children,
}: BlockViewProps<{
  readonly heading?: string
  readonly lede?: string
  readonly columns?: string
}>) => (
  <section className="section" data-columns={props.columns ?? 'one'}>
    {props.heading !== undefined && <h2>{props.heading}</h2>}
    {props.lede !== undefined && <p className="lede">{props.lede}</p>}
    <div className="children">{children}</div>
  </section>
)

export const FeatureView = ({
  props,
}: BlockViewProps<{
  readonly title?: string
  readonly body?: string
  readonly icon?: string
}>) => (
  <div className="feature">
    <span className="icon" data-icon={props.icon ?? 'spark'} />
    <h3>{props.title}</h3>
    <p>{props.body}</p>
  </div>
)

export const ProseView = ({ props }: BlockViewProps<{ readonly body?: string }>) => (
  <div className="prose">{props.body}</div>
)

export const CtaView = ({
  props,
}: BlockViewProps<{
  readonly title?: string
  readonly label?: string
  readonly href?: string
}>) => (
  <section className="cta">
    <h2>{props.title}</h2>
    {props.label !== undefined && props.href !== undefined && (
      <a className="button" href={props.href}>
        {props.label}
      </a>
    )}
  </section>
)

type Member = {
  readonly name: string
  readonly title: string
  readonly bio: string | null
  readonly photo: string | null
}

export const TeamView = ({ props }: BlockViewProps<{ readonly heading?: string }>) => {
  const { members } = usePublic<{ members: readonly Member[] }>('/api/site/team', { members: [] })

  return (
    <section className="people">
      {props.heading !== undefined && <h2>{props.heading}</h2>}
      <ul>
        {members.map((member) => (
          <li key={member.name}>
            {member.photo !== null && <img src={member.photo} alt="" />}
            <strong>{member.name}</strong>
            <span>{member.title}</span>
            {member.bio !== null && <p>{member.bio}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

type Role = {
  readonly slug: string
  readonly title: string
  readonly team: string
  readonly location: string
  readonly employment: string
  readonly description: string
}

export const OpeningsView = ({ props }: BlockViewProps<{ readonly heading?: string }>) => {
  const { roles } = usePublic<{ roles: readonly Role[] }>('/api/site/openings', { roles: [] })

  return (
    <section className="roles">
      {props.heading !== undefined && <h2>{props.heading}</h2>}
      {roles.length === 0 && <p className="empty">Nothing open right now.</p>}
      {roles.map((role) => (
        <article key={role.slug}>
          <h3>{role.title}</h3>
          <p className="where">
            {role.team} · {role.location} · {role.employment}
          </p>
          <p>{role.description}</p>
        </article>
      ))}
    </section>
  )
}

/**
 * Drawn where a block type has no view here.
 *
 * A stored page outlives the code that renders it: a block dropped from this project
 * is still in every tree that used it, and a visitor should not be shown a gap.
 */
export const MissingView = ({ block }: BlockViewProps) => (
  <p className="missing">No view is registered for a “{block.type}” block.</p>
)
