# @assemora/audit

The audit log (SPEC.md §67). Phase 9.

```ts
import { audit, auditModule } from '@assemora/audit'

const app = createApplication({
  modules: [auditModule(), blog()],
  audit: audit(),
})
```

`@assemora/core` has declared the audit port since phase 1 and called it at the end
of every command since. This package is the implementation; registering it is what
replaces `discardAudit()`.

## Why it is not `@assemora/revisions`

They answer different questions, and SPEC.md §67 says so outright.

A **revision** says what an entity looked like before a change, and is what `undo`
and `restore` are built on. It exists only when something actually changed.

An **audit entry** says who asked, from where, which command, whether it succeeded,
and how long it took. It exists for every attempt — including the ones authorization
refused, which are the entries that matter most and which leave no revision behind.

## What it records

| Column | From |
| --- | --- |
| `actorType`, `actorId` | The context's actor — a person, an agent, an API token |
| `source` | `rest`, `studio`, `mcp`, `cli`, `internal` |
| `action` | The command name, which is also its permission name |
| `entityType`, `entityId` | The first revision the command collected, when there was one |
| `requestId` | Ties every entry of one request together |
| `metadata` | The outcome, the duration, and whatever the pipeline knew |

Failures are recorded by default. `audit({ failures: false })` turns that off, and
you should have a reason.

Writing an entry never fails a command: the log is written after the transaction has
already committed, so a failure here cannot undo anything, and turning a successful
publish into an error because logging broke would be the wrong trade every time.
