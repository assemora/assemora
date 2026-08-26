# @assemora/change-sets

What an agent proposes, and a person approves (SPEC.md §73, §74, §75).

```ts
const proposal = await commands.execute('changesets.propose', {
  title: 'Make the hero more compact',
  commands: [
    { command: 'blocks.design', input: { id, blockId, design: { spacingTop: 'md' } } },
    { command: 'blocks.remove', input: { id, blockId: heroImage } },
  ],
})
```

Nothing has happened. `proposal.changes` is one readable line per change —
`hero — spacing: xl → md` — and `changesets.apply` is what runs them.

## Why proposing is safe

`changesets.propose` previews the whole sequence through `commands.dryRun`: every
command passes validation, authorization and its real handler, and the transaction
is undone. A proposal an agent could not have performed is refused when it is made,
not when somebody tries to approve it.

The commands are previewed as a *sequence*, in one transaction, so the second sees
what the first did. "Add a block, then set its title" is one proposal, and previewing
the steps separately would leave the second referring to a block that had been rolled
back.

## Why applying is safe

Apply re-executes the stored commands through the Command Bus, in the applier's own
context — under the approving person's permissions and policies, not the proposer's.
It does not write the stored diff: a diff describes what would happen, and writing it
would be a second way to mutate, which SPEC.md §14 does not allow.

Before it runs anything it previews the proposal again and compares the versions each
entity was at when the diff was computed. If one has moved, the person approved a
description of a state that no longer exists, and it declines.

## The five statuses

`pending`, `applied`, `rejected`, `expired`, `conflicted` (SPEC.md §74).

Declining is an **outcome, not an exception**: `changesets.apply` answers
`{ status: 'conflicted', applied: false, changed: [...] }` rather than throwing.
It has to. The status is written inside the command's transaction, and throwing
would roll back the very row that records the refusal.

A caller mistake — applying something already applied, or an id that does not exist —
still throws.

## Conflict detection is only as good as versioning

`baseVersions` records a version for each touched entity, taken from the `before`
snapshot the preview produced. Only entities that carry one are recorded: pages and
users do, resource rows do not, because SPEC.md §66's versioning landed with pages.
So conflict detection is complete for pages and absent for entries until versioning
is general.
