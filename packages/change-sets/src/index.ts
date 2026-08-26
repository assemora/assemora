/**
 * `@assemora/change-sets` — what an agent proposes, and a person approves.
 *
 * SPEC.md §73 puts a change set between a dry run and an apply, and §75 states the
 * guarantee it exists for: production state does not change before Apply.
 *
 * ```ts
 * const proposal = await commands.execute('changesets.propose', {
 *   title: 'Make the hero more compact',
 *   commands: [
 *     { command: 'blocks.design', input: { id, blockId, design: { spacingTop: 'md' } } },
 *     { command: 'blocks.remove', input: { id, blockId: heroImage } },
 *   ],
 * })
 * ```
 *
 * Nothing has happened. `proposal.changes` is one line per change, and
 * `changesets.apply` is what runs them — in the applier's own name.
 */

export {
  ApplyChangeSet,
  changeSetCommands,
  changeSetQueries,
  GetChangeSet,
  ListChangeSets,
  ProposeChangeSet,
  RejectChangeSet,
} from './commands.js'
export {
  ChangeSet,
  type ChangeSetDiff,
  type ChangeSetStatus,
  changeSetModels,
  type ProposedChange,
  type ProposedCommand,
} from './models.js'
export { changeSets } from './module.js'
export { summarise } from './summary.js'
