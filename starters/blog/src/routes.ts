/**
 * The site, for a reader with no session (SPEC.md §41).
 *
 * Reading is denied by default like every other operation (SPEC.md §50), so a page a
 * visitor may see is a deliberate opening — and this is it, the one route in the
 * project that answers without a credential.
 *
 * It could not be a policy. `pages.get` is the query Studio and the builder canvas
 * use, and it accepts `mode=draft`; a policy rule answering "may this actor read
 * pages" never sees which mode was asked for, so opening it would publish every
 * unfinished draft in the project. A route can insist, because it writes the filter
 * itself: published status, and the *published* tree, never the draft beside it.
 *
 * This is also the shape to copy for anything else anonymous readers need — a feed,
 * an article, a search. Return exactly what is public, from a query you control.
 */
import { route } from '@assemora/http'
import { Page } from '@assemora/pages'
import { blockTree, emptyTree, string } from '@assemora/schema'

export const readPage = route.get('/site/pages/:slug', {
  description: 'The published tree of one page',
  tags: ['site'],
  params: { slug: string().min(1) },
  response: { slug: string(), title: string(), tree: blockTree() },
  errors: [{ code: 'NOT_FOUND', status: 404, description: 'No published page has that slug' }],
  handler: async ({ params }) => {
    const page = await Page.where('slug', params.slug).where('status', 'published').firstOrFail()

    // A page published and then unpublished keeps its tree; `status` is what decides,
    // and `?? emptyTree()` is the honest answer for one that has never been published.
    return { slug: page.slug, title: page.title, tree: page.publishedTree ?? emptyTree() }
  },
})
