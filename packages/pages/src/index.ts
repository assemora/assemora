/**
 * `@assemora/pages` — pages as trees of blocks.
 *
 * A page is never stored as HTML (SPEC.md §125.14). It is a tree with stable block
 * ids, edited only through commands, so every builder operation Studio offers is one
 * an agent can perform identically (SPEC.md §60).
 *
 * ```ts
 * export const Hero = block('hero', {
 *   title: text().required(),
 *   subtitle: text(),
 *   variant: select('centered', 'split'),
 * })
 *
 * export default pages({ blocks: [Hero] })
 * ```
 *
 * The block tree types themselves live in `@assemora/schema`, so a renderer can draw
 * a page without the server layer coming with it.
 */

export {
  type Block,
  type BlockDescriptor,
  type BlockOptions,
  block,
  blockFor,
  clearBlockRegistry,
  describeBlock,
  hasBlock,
  type PropsMode,
  registerBlock,
  registeredBlocks,
  validateProps,
} from './block.js'
export {
  AddBlock,
  ArchivePage,
  CreatePage,
  DeletePage,
  DesignBlock,
  DuplicateBlock,
  HideBlock,
  MoveBlock,
  PublishPage,
  pageCommands,
  RemoveBlock,
  UnpublishPage,
  UpdateBlock,
  UpdatePage,
} from './commands.js'
export { Page, type PageMeta, pageModels } from './models.js'
export { defineBlockFacet, type PagesModuleOptions, pages } from './module.js'
export { GetPage, ListPages, type PageMode, pageQueries } from './queries.js'
export {
  type AddBlock as AddBlockRequest,
  addBlock,
  duplicateBlock,
  moveBlock,
  type Placement,
  parentOf,
  removeBlock,
  setBlockDesign,
  setBlockHidden,
  unfinishedBlocks,
  updateBlockProps,
} from './tree.js'
