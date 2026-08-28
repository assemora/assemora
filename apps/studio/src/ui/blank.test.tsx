/**
 * The words a fresh install is made of (SPEC.md §58, §115).
 *
 * Drawn rather than reasoned about, because what these have to get right is what they
 * *say*: an empty list has one job, and the ways to fail it are saying nothing, saying
 * it to somebody who cannot act on it, and naming a command that does not exist.
 *
 * The `make:block` line is asserted here and against the generator in
 * `packages/cli/src/commands/make.test.ts`. Two files that have to agree is exactly how
 * a screen comes to point at a path the CLI stopped writing, so this one states the
 * whole line — including how it is invoked, because a select-all snippet is copied
 * whole and `assemora` on its own is not on anybody's PATH.
 */
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GettingStarted, NoBlocks, NoCollections, NoEntries, NoPages } from './blank.tsx'

const draw = (element: ReactElement): string => renderToStaticMarkup(element)

/** Markup with the tags taken out, which is how a person reads it. */
const words = (element: ReactElement): string =>
  draw(element)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

describe('a collection list with nothing in it', () => {
  it('says what a collection is, and offers to start one', () => {
    const markup = words(<NoCollections canCreate onCreate={() => {}} />)

    expect(markup).toContain('Make your first collection')
    expect(markup).toContain('A collection is a kind of content')
    expect(markup).toContain('New collection')
  })

  it('does not invite somebody who may not act on the invitation', () => {
    // The refusal would be correct and would arrive after the form. A screen that can
    // only end in one is a screen that should not have opened.
    const markup = words(<NoCollections canCreate={false} onCreate={() => {}} />)

    expect(markup).not.toContain('New collection')
    expect(markup).toContain('a permission this account does not have')
  })

  it('still explains what a collection is to somebody who cannot make one', () => {
    // Reading is not the same right as writing, and "you may not" on its own tells a
    // person nothing about the application they are looking at.
    expect(words(<NoCollections canCreate={false} onCreate={() => {}} />)).toContain(
      'A collection is a kind of content',
    )
  })
})

describe('a page list with nothing in it', () => {
  it('says what a page is, and offers to start one', () => {
    const markup = words(<NoPages filtered={false} onCreate={() => {}} />)

    expect(markup).toContain('Make your first page')
    expect(markup).toContain('tree of blocks')
    expect(markup).toContain('New page')
  })

  it('tells a search that found nothing apart from an application with nothing in it', () => {
    // The same sentence for both is how somebody comes to believe the search box
    // deleted their pages.
    const markup = words(<NoPages filtered onCreate={() => {}} />)

    expect(markup).toContain('No page matches that')
    expect(markup).not.toContain('Make your first page')
    expect(markup).not.toContain('New page')
  })
})

describe('a collection with no entries in it', () => {
  it('calls one of them what the application calls it', () => {
    const markup = words(<NoEntries singular="Testimonial" editable onCreate={() => {}} />)

    expect(markup).toContain('No testimonial yet')
    expect(markup).toContain('An entry is one testimonial')
    expect(markup).toContain('New Testimonial')
  })

  it('says that the shape is still free, while it still is', () => {
    // The last moment it is true: what a stored value *is* freezes as soon as one
    // exists, and the collection editor then locks those controls and says why.
    expect(words(<NoEntries singular="Testimonial" editable onCreate={() => {}} />)).toContain(
      'the cheapest moment to change what they are',
    )
  })

  it('says nothing of the kind about a resource declared in TypeScript', () => {
    // Its fields are in a file, and this screen has no business discussing them.
    expect(
      words(<NoEntries singular="Article" editable={false} onCreate={() => {}} />),
    ).not.toContain('cheapest moment')
  })

  it('offers nothing to somebody the resource does not let create', () => {
    expect(words(<NoEntries singular="Article" editable={false} />)).not.toContain('New Article')
  })
})

describe('an empty block palette', () => {
  it('says why it is empty, rather than reading as broken software', () => {
    const markup = words(<NoBlocks />)

    expect(markup).toContain('A block is a TypeScript declaration')
  })

  it('names the command that does what Studio cannot', () => {
    const markup = words(<NoBlocks />)

    expect(markup).toContain('src/blocks/hero.ts')
    expect(markup).toContain('pages({ blocks: [Hero] })')
  })

  /**
   * The bug this covers: the snippet said `assemora make:block hero`, and the
   * executable is a dependency rather than a global one. Every person who selected the
   * line and pressed enter got `command not found`, on the one screen whose whole
   * purpose is to unblock them.
   */
  it('names it in a form that runs where the project is checked out', () => {
    expect(words(<NoBlocks />)).toContain('npx assemora make:block hero')
  })

  it('says the step the generator does not take, which is the one people miss', () => {
    // `make:block` writes the declaration and no component: a block's fields and its
    // view are deliberately separate (SPEC.md §55, §57).
    expect(words(<NoBlocks />)).toContain('give it a view in your frontend')
  })
})

describe('the dashboard of an application with nothing in it', () => {
  const started = (canCreateCollection: boolean) =>
    words(
      <GettingStarted
        canCreateCollection={canCreateCollection}
        onCreateCollection={() => {}}
        onCreatePage={() => {}}
      />,
    )

  it('offers the three ways to start', () => {
    const markup = started(true)

    expect(markup).toContain('Describe some content')
    expect(markup).toContain('Build a page')
    expect(markup).toContain('Declare a block')
  })

  it('carries the same runnable line the palette does', () => {
    // Two snippets of one command is two chances to ship one that does not run.
    expect(started(true)).toContain('npx assemora make:block hero')
  })

  it('leaves out the collection step when this application has no collections at all', () => {
    // An application without `collections()`, or an account without the permission.
    // Both make the step a door onto a refusal.
    const markup = started(false)

    expect(markup).not.toContain('Describe some content')
    expect(markup).toContain('Build a page')
  })

  it('promises only what the button does', () => {
    // Making a page is a dialog on the page list, so this goes to the list and says
    // so. `New page` here would be a form that never opens.
    expect(started(true)).toContain('Go to pages')
  })
})
