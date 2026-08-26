/**
 * The whole site: a table of contents beside a page.
 *
 * Routing is the location hash and nothing else. A router would be a dependency, a
 * build step and a server rewrite rule for twelve static pages, and `#/03-models` is a
 * link that works from a file:// path, from a subdirectory and from a static host that
 * has never heard of this application.
 */
import { useEffect, useState } from 'react'

import { chapters, contents, neighbours, type Page, pageBySlug } from './guide.ts'

const home = contents?.slug ?? chapters[0]?.slug ?? ''

const slugFromHash = (): string => {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('#')[0] ?? ''

  return raw === '' ? home : raw
}

const Navigation = ({ current }: { readonly current: string }) => (
  <nav aria-label="Contents">
    <a className="brand" href={`#/${home}`}>
      Assemora
    </a>
    <ol>
      {chapters.map((chapter) => (
        <li key={chapter.slug}>
          <a
            href={`#/${chapter.slug}`}
            aria-current={chapter.slug === current ? 'page' : undefined}
          >
            <span className="number">{chapter.number}</span>
            {chapter.title}
          </a>
        </li>
      ))}
    </ol>
    <p className="aside">
      The guide lives in <code>docs/guide/</code>. This site renders those files and holds no copy
      of them.
    </p>
  </nav>
)

const Footer = ({ page }: { readonly page: Page }) => {
  const { previous, next } = neighbours(page)

  return (
    <footer>
      {previous === undefined ? (
        <span />
      ) : (
        <a href={`#/${previous.slug}`}>
          <span className="direction">Previous</span>
          {previous.title}
        </a>
      )}
      {next === undefined ? (
        <span />
      ) : (
        <a className="next" href={`#/${next.slug}`}>
          <span className="direction">Next</span>
          {next.title}
        </a>
      )}
    </footer>
  )
}

const Missing = ({ slug }: { readonly slug: string }) => (
  <article>
    <h1>No such page</h1>
    <p>
      There is no <code>{slug}</code> in the guide. <a href={`#/${home}`}>Start at the contents</a>.
    </p>
  </article>
)

export const App = () => {
  const [slug, setSlug] = useState(slugFromHash)

  useEffect(() => {
    const onHashChange = () => setSlug(slugFromHash())

    window.addEventListener('hashchange', onHashChange)

    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // A new page starts at its own beginning, rather than wherever the last one was read
  // to. The browser does that for a document load and not for a hash change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slug is what changed, not what the effect reads
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [slug])

  const page = pageBySlug(slug)

  return (
    <div className="layout">
      <Navigation current={slug} />
      <main>
        {page === undefined ? (
          <Missing slug={slug} />
        ) : (
          <>
            {/* The Markdown is this repository's own, read at build time; there is no
                user input anywhere in it. */}
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the guide is built from docs/guide/*.md at build time */}
            <article dangerouslySetInnerHTML={{ __html: page.html }} />
            <Footer page={page} />
          </>
        )}
      </main>
    </div>
  )
}
