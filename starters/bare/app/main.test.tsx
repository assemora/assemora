/**
 * The two decisions `main.tsx` makes on behalf of a project with nothing in it.
 *
 * `Site` chooses between the page and an invitation to make one; `readPublished`
 * decides what "nothing is published at that slug" means to somebody who is only
 * reading. Both are the blank slate's whole answer to *what does a visitor see*, and
 * each is one boolean away from the failure it exists to prevent — a blank white
 * document indistinguishable from a broken build, and a 404 shown as an error to a
 * visitor for whom it is not one.
 *
 * The canvas is the half a screenshot would never catch. An editor looking at an
 * empty page is told what that means by Studio, over the frame, so the invitation
 * must *not* be drawn inside the iframe: a second explanation there would be a block
 * they can neither select nor delete.
 *
 * This file is the repository's, not the template's. `create-assemora` leaves a
 * starter's own tests behind, because a scaffolded project depends on no test runner.
 */
import { type BlockTree, emptyTree } from '@assemora/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readPublished, Site } from './main.tsx'

/** A tree of blocks, named by type, because nothing here cares what is in one. */
const treeOf = (...types: readonly string[]): BlockTree => ({
  blocks: types.map((type, index) => ({
    id: `block-${index}`,
    type,
    version: 1,
    props: {},
    children: [],
  })),
})

/** The site route, answering the way `src/routes.ts` answers. */
const answering = (status: number, body: unknown) => {
  const asked = vi.fn((_url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )

  vi.stubGlobal('fetch', asked)

  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a visitor sees before anything is published', () => {
  it('invites them to make a page rather than drawing a blank document', () => {
    const markup = renderToStaticMarkup(<Site tree={emptyTree()} />)

    expect(markup).toContain('Nothing is published yet')
    expect(markup).toContain('/studio')
    // The palette is empty until this project declares a block type, and the copy has
    // to name the command that does it — as it is actually run. In a scaffolded
    // project `assemora` is only in `node_modules/.bin`, so the bare name is a
    // `command not found` for anybody who copies what they were shown.
    expect(markup).toContain('pnpm assemora make:block hero')
  })

  it('says nothing at all inside the builder canvas', () => {
    expect(renderToStaticMarkup(<Site tree={emptyTree()} editing />)).toBe('')
  })

  it('draws the page instead as soon as there is a block in it', () => {
    expect(renderToStaticMarkup(<Site tree={treeOf('hero')} />)).not.toContain(
      'Nothing is published yet',
    )
  })

  it('names a block type it has no view for rather than leaving a gap', () => {
    // A blank project registers no views at all, so this is what *every* block looks
    // like until somebody writes one. A silent gap reads as a broken build, and a
    // stored page outlives the code that drew it — a block dropped from a project is
    // still in every tree that used it.
    const markup = renderToStaticMarkup(<Site tree={treeOf('hero')} />)

    expect(markup).toContain('hero')
    expect(markup).toContain('app/blocks/')
  })
})

describe('reading the published tree of one page', () => {
  it('answers a slug nothing is published at with an empty tree', async () => {
    // To a visitor there is nothing to read, and on a project this new the ordinary
    // case is that no page has been made at all. That is not a failure.
    answering(404, { code: 'NOT_FOUND', message: 'No published page has that slug' })

    expect(await readPublished('home')).toEqual(emptyTree())
  })

  it('hands back the tree that was published', async () => {
    answering(200, { slug: 'home', title: 'Home', tree: treeOf('hero') })

    expect((await readPublished('home')).blocks.map((block) => block.type)).toEqual(['hero'])
  })

  it('does not turn a real failure into an empty page', async () => {
    // The 404 is the one status that means "nothing here". Anything else is the site
    // being broken, and rendering the invitation for it would hide an outage behind
    // a friendly sentence.
    answering(500, { code: 'INTERNAL' })

    await expect(readPublished('home')).rejects.toThrow('500')
  })

  it('asks for the slug it was given, whatever is in it', async () => {
    const asked = answering(404, {})

    await readPublished('a b/c')

    expect(asked).toHaveBeenCalledWith('/api/site/pages/a%20b%2Fc')
  })
})
