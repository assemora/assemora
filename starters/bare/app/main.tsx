/**
 * The public site (SPEC.md §57).
 *
 * One renderer draws a page, and it is this one. Studio's builder canvas loads this
 * very bundle inside its iframe, so a preview cannot drift from what a visitor sees —
 * there is no second implementation for it to drift from (SPEC.md §59).
 *
 * `preview.tsx` is the document that mounts what is here and adds the editor's half
 * of the conversation. Everything the page *looks like* is in this file and in
 * `app/blocks/`, which is empty because this project declares no block types yet.
 */
import { AssemoraPage, type BlockViewProps, createBlockRegistry } from '@assemora/react'
import { type BlockTree, emptyTree } from '@assemora/schema'

/**
 * Drawn where a block type has no view here.
 *
 * A stored page outlives the code that renders it: a block dropped from this project
 * is still in every tree that used it, and a visitor should never be shown a silent
 * gap where one used to be. It is also what you will see first after
 * `assemora make:block hero` — the declaration is registered, the component is not.
 */
const Missing = ({ block }: BlockViewProps) => (
  <p className="missing">
    No view is registered for a “{block.type}” block. Write one in <code>app/blocks/</code> and add
    it to the registry in <code>app/main.tsx</code>.
  </p>
)

/**
 * Where a block declaration meets its component.
 *
 * The key is the block's type from `src/blocks/`, and this map is the only thing
 * joining the two. It is empty because the project declares no blocks: add one with
 * `assemora make:block hero`, list it in `pages({ blocks: [Hero] })` in `src/app.ts`,
 * write its view, and add it here — then the builder can place it.
 */
export const blocks = createBlockRegistry({}, { fallback: Missing })

/**
 * What a visitor sees before anybody has published anything.
 *
 * A blank white page is what an empty tree renders to, and it is indistinguishable
 * from a broken build. This says which of the two it is, and what the next act is —
 * and it is the site's own copy rather than the framework's, so deleting it is one
 * edit rather than a configuration option nobody can find.
 */
const Nothing = () => (
  <main className="empty">
    <h1>Nothing is published yet</h1>
    <p>
      Sign in at <a href="/studio">/studio</a>, make a page, and drop a block into it.
    </p>
    <p>
      The palette is empty until this project declares a block type: run{' '}
      <code>pnpm assemora make:block hero</code>, list it in{' '}
      <code>pages({'{ blocks: [Hero] }'})</code> in <code>src/app.ts</code>, and write its view in{' '}
      <code>app/blocks/</code>.
    </p>
  </main>
)

/**
 * What a visitor gets: the published tree, by slug, with no session at all.
 *
 * `src/routes.ts` is the other half, and it says why this is a route rather than a
 * policy. Nothing here is authenticated, so `/preview` and `/preview?slug=about` are
 * pages anybody can open.
 *
 * A slug nothing is published at answers with an empty tree rather than an error. To
 * a visitor the two are one thing — there is nothing to read — and on a project this
 * new the ordinary case is that no page has been made at all, which is not a failure.
 */
export const readPublished = async (slug: string): Promise<BlockTree> => {
  const response = await fetch(`/api/site/pages/${encodeURIComponent(slug)}`)

  if (response.status === 404) return emptyTree()
  if (!response.ok) throw new Error(`The page could not be loaded (${response.status})`)

  return ((await response.json()) as { tree: BlockTree }).tree
}

/**
 * What the builder's canvas gets: one page by id, in whichever mode it asked for,
 * through the Query Bus the way Studio and an agent reach it (ADR-0014).
 *
 * The session cookie goes with it because a draft is not public: reading is denied by
 * default like every other operation (SPEC.md §50), and the editor looking at the
 * canvas is the actor being authorized. Signed out, this is a 403 — which is correct,
 * and is why the visitor's path above does not use it.
 */
export const readTree = async (parameters: Record<string, string>): Promise<BlockTree> => {
  const query = new URLSearchParams(parameters)
  const response = await fetch(`/api/queries/pages.get?${query.toString()}`, {
    credentials: 'include',
  })

  if (response.status === 403) {
    throw new Error('Sign in to Studio at /studio: an unpublished draft is not public.')
  }

  if (!response.ok) throw new Error(`The page could not be loaded (${response.status})`)

  return ((await response.json()) as { tree: BlockTree }).tree
}

export type SiteProps = {
  readonly tree: BlockTree
  /** Marks each block in the DOM so the builder can find it. Off for a visitor. */
  readonly editing?: boolean
}

/**
 * The empty state is the visitor's, never the canvas's.
 *
 * An editor looking at a page they have not put anything in yet is being told what an
 * empty page is by Studio, over the frame, and a second explanation drawn *inside* the
 * canvas would be a block they cannot select and cannot delete.
 */
export const Site = ({ tree, editing = false }: SiteProps) =>
  tree.blocks.length === 0 && !editing ? (
    <Nothing />
  ) : (
    <AssemoraPage page={{ tree }} blocks={blocks} editing={editing} />
  )
