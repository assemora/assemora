/**
 * `/:slug` — a page somebody assembled in the builder, rendered by Next.js.
 *
 * This is the other half of the arrangement. A page is a tree of blocks with stable
 * ids (SPEC.md §54), and `@assemora/react` turns it into React elements using the
 * views in `app/blocks/`. Because those views are shared components and this is a
 * server component, the tree is rendered *on the server*: a visitor is sent HTML and
 * no renderer, no block registry and no tree.
 *
 * The seeded page is `/home`. Anything a person adds in Studio is reachable here the
 * moment it is published, with no route to add and no build to run.
 */
import { AssemoraPage } from '@assemora/react'
import { notFound } from 'next/navigation'

import { blocks } from '../blocks/registry.tsx'
import { isUnauthenticated, type PageContent, readPage } from '../lib/assemora.ts'

/**
 * Rendered per request, never at build time.
 *
 * The content lives in Assemora, so baking this page into the bundle would freeze it
 * at whatever the database held when somebody ran `next build` — and that build may
 * be in CI, where the API is not running at all. A CMS page is dynamic by nature;
 * add `revalidate` if you want it cached for a while instead.
 */
export const dynamic = 'force-dynamic'

const Page = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params
  let content: PageContent

  try {
    content = await readPage(slug)
  } catch (error) {
    // A read this frontend is not allowed to make is not a missing page, and saying
    // so is the difference between a five-minute fix and an afternoon.
    if (isUnauthenticated(error)) {
      return (
        <main className="prose">
          <p className="notice">
            This frontend has no <code>ASSEMORA_TOKEN</code>. Copy the one <code>pnpm dev:api</code>{' '}
            printed into <code>.env</code>, then restart.
          </p>
        </main>
      )
    }

    notFound()
  }

  return (
    <main>
      <AssemoraPage page={content} blocks={blocks} />
    </main>
  )
}

export default Page
