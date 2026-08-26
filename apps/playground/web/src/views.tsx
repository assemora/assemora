/**
 * What this application's blocks look like (SPEC.md §57).
 *
 * The block declarations in `src/blog.ts` say what a hero *is* — its fields, their
 * validation, the form Studio draws. These say what it looks like. They are the
 * application's, and they are the components the builder's canvas actually renders,
 * which is why the preview is accurate rather than approximate (SPEC.md §59).
 */
import type { BlockView } from '@assemora/react'

type Hero = { title?: string; subtitle?: string; image?: string; variant?: string }
type Section = { title?: string }
type Faq = { question?: string; answer?: string }

const mediaUrl = (id: string | undefined): string | undefined =>
  id === undefined || id === '' ? undefined : `/api/media/by-id/${id}`

export const HeroView: BlockView<Hero> = ({ props }) => {
  const image = mediaUrl(props.image)

  return (
    <header className="hero" data-variant={props.variant ?? 'centered'}>
      <div>
        <h1>{props.title}</h1>
        {props.subtitle !== undefined && <p>{props.subtitle}</p>}
      </div>
      {image !== undefined && <img src={image} alt="" />}
    </header>
  )
}

export const SectionView: BlockView<Section> = ({ props, children }) => (
  <section className="section">
    {props.title !== undefined && <h2>{props.title}</h2>}
    {children}
  </section>
)

export const FaqView: BlockView<Faq> = ({ props }) => (
  <div className="faq">
    <h3>{props.question}</h3>
    <p>{props.answer}</p>
  </div>
)

/** Drawn where a block type is not known here. A visitor should never see a gap. */
export const MissingView: BlockView = ({ block }) => (
  <div className="missing">No view is registered for a “{block.type}” block</div>
)
