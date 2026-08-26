/**
 * The `.blocks()` facet and the `pages()` module (SPEC.md §13, §114).
 */
import { defineModuleFacet, type ModuleBuilder, module, registerRestorer } from '@assemora/core'

import type { BlockTree } from '@assemora/schema'
import { emptyTree } from '@assemora/schema'

import { type Block, describeBlock, registerBlock } from './block.js'
import { pageCommands } from './commands.js'
import { Page, type PageMeta, pageModels } from './models.js'
import { pageQueries } from './queries.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    /** Registers block types, which is what makes them usable in a page (SPEC.md §55). */
    blocks(...blocks: Block[]): ModuleBuilder
  }
}

let defined = false

export const defineBlockFacet = (): void => {
  if (defined) return

  defineModuleFacet('blocks', (internals, args) => {
    internals.addRegistration((context) => {
      for (const candidate of args) {
        const declared = candidate as Block

        if (declared?.node !== 'block') continue

        registerBlock(declared)
        context.registry.register('blocks', describeBlock(declared, internals.name))
      }
    })
  })

  defined = true
}

defineBlockFacet()

export type PagesModuleOptions = {
  /** The block types this application offers (SPEC.md §55). */
  readonly blocks?: readonly Block[]
}

export const pages = (options: PagesModuleOptions = {}): ModuleBuilder =>
  module('pages')
    .models(...pageModels)
    .commands(...pageCommands)
    .queries(...pageQueries)
    .blocks(...(options.blocks ?? []))
    .boot(() => {
      // How a page goes back to an earlier state. `@assemora/revisions` calls this
      // and never learns what a page is (SPEC.md §65).
      registerRestorer('pages', async (entityId, state) => {
        const existing = await Page.find(entityId)
        const replaced = existing === null ? null : existing.toJSON()

        // `null` means the page did not exist then. Undoing a creation is an ordinary
        // restore, and so is putting back something that was deleted (SPEC.md §65).
        if (state === null || state === undefined) {
          if (existing !== null) await existing.delete()

          return { replaced, version: 0 }
        }

        const snapshot = state as Record<string, unknown>

        if (existing === null) {
          const recreated = await Page.create({
            id: entityId,
            slug: String(snapshot.slug ?? entityId),
            title: String(snapshot.title ?? 'Restored page'),
            status: (snapshot.status ?? 'draft') as 'draft',
            draftTree: (snapshot.draftTree ?? emptyTree()) as BlockTree,
            publishedTree: (snapshot.publishedTree ?? null) as BlockTree | null,
            meta: (snapshot.meta ?? {}) as PageMeta,
            version: 1,
            publishedAt: null,
          })

          return { replaced, version: recreated.version, tree: recreated.draftTree }
        }

        await existing.update({
          title: String(snapshot.title ?? existing.title),
          slug: String(snapshot.slug ?? existing.slug),
          status: (snapshot.status ?? existing.status) as 'draft',
          draftTree: (snapshot.draftTree ?? existing.draftTree) as BlockTree,
          publishedTree: (snapshot.publishedTree ?? existing.publishedTree) as BlockTree | null,
          meta: (snapshot.meta ?? existing.meta) as PageMeta,
          version: existing.version + 1,
        })

        // The caller needs both: its next command carries `expectedVersion`, and an
        // editor has to draw what the undo produced without reading the page again.
        return { replaced, version: existing.version, tree: existing.draftTree }
      })
    })
