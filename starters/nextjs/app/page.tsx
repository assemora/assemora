/**
 * `/` — a page you wrote, reading data Assemora owns.
 *
 * This is the half of the arrangement that answers "I already have a Next.js site".
 * Nothing here is generated and nothing here is a block: it is a React server
 * component that happens to call the CMS. Your routes stay yours.
 *
 * It is a *server* component, so the call below runs in the Next.js process and the
 * browser is sent HTML. The token never leaves this machine, and a visitor downloads
 * no JavaScript for it.
 */
// assemora:if pages
import Link from 'next/link'
// assemora:end

import { api, isUnauthenticated } from './lib/assemora.ts'

/**
 * Rendered per request, never at build time.
 *
 * The content lives in Assemora, so baking this page into the bundle would freeze it
 * at whatever the database held when somebody ran `next build` — and that build may
 * be in CI, where the API is not running at all. A CMS page is dynamic by nature;
 * add `revalidate` if you want it cached for a while instead.
 */
export const dynamic = 'force-dynamic'

/**
 * What `GET /api/articles` sends, which is not what the model holds.
 *
 * Deliberately not `typeof Article.$infer`: the record type says `createdAt: Date`,
 * and JSON has no such thing. `pnpm sdk:generate` writes this type from the Schema
 * Registry — from the *wire* schema — which is how it stops being written by hand.
 */
type Article = {
  readonly id: string
  readonly title: string
  readonly slug: string
}

/** Nothing is cached: Next 15 stopped caching `fetch` by default, so an edit shows. */
const latest = async (): Promise<readonly Article[] | 'unauthenticated'> => {
  try {
    const page = await api.resource<Article>('articles').list({ perPage: 5, sort: '-createdAt' })

    return page.data
  } catch (error) {
    if (isUnauthenticated(error)) return 'unauthenticated'

    throw error
  }
}

const Home = async () => {
  const articles = await latest()

  return (
    <main className="prose">
      <h1>My site</h1>

      {articles === 'unauthenticated' ? (
        <p className="notice">
          This frontend has no <code>ASSEMORA_TOKEN</code>, so the application refused the read —
          which is what it is supposed to do. Copy the token <code>pnpm dev:api</code> printed on
          its first boot into <code>.env</code>, then restart.
        </p>
      ) : (
        <>
          <h2>Latest articles</h2>
          <ul>
            {articles.map((article) => (
              <li key={article.id}>{article.title}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Where to go next</h2>
      <ul>
        <li>
          {/* A plain anchor, not `next/link`: /studio is a different application, on
              the far side of the rewrite, and there is nothing here to transition to. */}
          <a href="/studio">Studio</a> — sign in and edit
        </li>
        {/* assemora:if pages */}
        <li>
          <Link href="/home">The seeded page</Link> — assembled from blocks, rendered by{' '}
          <code>@assemora/react</code>
        </li>
        {/* assemora:end */}
      </ul>
    </main>
  )
}

export default Home
