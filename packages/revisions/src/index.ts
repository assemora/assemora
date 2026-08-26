/**
 * `@assemora/revisions` — history, and the way back.
 *
 * Core collects a revision inside the command's transaction (ADR-0008); this package
 * stores it, diffs it and puts it back. Restoring is itself a command, so it passes
 * policies and leaves a revision of its own — undoing is not a way around the
 * pipeline (SPEC.md §64, §65).
 */

export { changedFields, diff, type Patch } from '@assemora/schema'
export {
  CompareRevisions,
  GetRevision,
  ListRevisions,
  RedoChange,
  RestoreRevision,
  type RestoreSide,
  revisionCommands,
  revisionQueries,
  UndoChange,
} from './commands.js'
export { Revision, type RevisionPatch, revisionModels } from './models.js'
export { revisionsModule } from './module.js'
export { clearRestorers, type Restorer, registerRestorer, restorerFor } from './restore.js'
export { revisions } from './store.js'
