# 0029. Notifications are a module of their own; a channel is a driver behind it

Status: accepted
Date: 2026-09-01

## Context

SPEC.md §81 names notifications once, in a list of what events exist for:

```text
cache invalidation
notifications
search indexing
analytics
```

That is the whole of the specification, and it is a mechanism away from anything a
site can use. A real one asked the question: `papa-cotta`'s `shop.alertKitchen` job
had carried this comment since the day the shop was written —

```ts
// The delivery channel is a decision nobody has made yet — a screen, a printer, a
// messenger bot. Until then the log is the channel.
```

An order was placed, the transaction committed, a job ran, and the kitchen was told by
a line of JSON on a server nobody was looking at.

Three questions had to be answered before anything could be written.

**Where does it live?** The framework ships mechanisms and a package ships nouns
(ADR-0027). "Deliver a message to somebody" is a mechanism; "a recipient", "a
delivery" and "a topic" are nouns. So the choice was between a port in `core` with an
adapter package beside `queue-bullmq`, and a module that declares its nouns through
the same builder methods an application uses. A port alone answers "how does the byte
leave" and leaves every application to invent its own address book, its own retry and
its own record of what was sent — three things every one of them needs and none of
them should design.

**Who may announce?** A command is authorized, and authorization denies by default. A
site's notifications are triggered by things a stranger does: a guest places an order
and nobody is signed in. The tempting fix is for the package to register a policy that
grants it. That is exactly the hole named in `CLAUDE.md`: twelve lines in an installed
package that open an application nobody opened.

**What does a channel promise?** Telegram answers "chat not found" and "too many
requests" with the same HTTP shape, and the difference between them is the difference
between a queue giving up and a queue trying again in a minute.

## Decision

**`@assemora/notifications` is a module, on the resource layer.** It depends on
`schema`, `core`, `data` and `resources` and on nothing above them. It knows no
server, no HTTP and no messenger.

**A topic is declared like a command.** `notification('orders.placed', { input,
render })` is the fourth member of the family beside `command()`, `query()` and
`job()`. The input schema is what makes announcing a typed act rather than a text box:
`notifications.send` validates the payload against the topic before anybody is told
anything, so no caller anywhere — a handler, an operator, an agent — can put arbitrary
prose into a staff channel. `render` is a server-side function and never leaves the
process; the descriptor a generator reads carries the name, the description and the
input schema, which is everything a form or an agent needs to *ask* for one
(ADR-0027).

**A recipient and a delivery are resources.** The address book is a row somebody adds
in Studio, and the log is a row per attempt. Declaring them as resources is what makes
the list, the form, the filters, REST, OpenAPI, the SDK and the MCP tools follow from
one declaration. The delivery log is `api: { create: false, update: false, delete:
false }` — a log is written by the sending and read by everybody else, and SPEC.md §43
makes that true in every client at once rather than only in the API.

**A channel is a driver, exactly as storage and queues are.** `NotificationChannel`
names no messenger; `telegram()` is the first driver and the only file in the
repository that knows Telegram exists. A driver reports two failures apart:
`rejected()` for an address that will never work, `unreachable()` for a minute that
has passed. The job retries the second and records the first.

**A message is text and only text.** No parse mode, no markup, no template a channel
would interpret. The values in a notification come from what a stranger typed into a
checkout, and a name holding `<b>` or `*` must arrive as those characters. Formatting
would have to be escaped value by value, and a missed escape is a stranger writing
markup into a staff channel.

**The package registers no policy.** Authorization denies by default and stays that
way. An application that announces from a job writes four lines:

```ts
export const notificationPolicy = policy('notifications', {
  send: ({ context }) => context.source === 'job',
  record: ({ context }) => context.source === 'job',
})
```

`context.source` is set by whichever door the call came through — `rest`, `mcp`, `cli`,
`studio`, `job`, `internal` — and a client cannot choose it. So a rule keyed on it says
"the site announces its own events; a request never does", and it says it in the
application, where opening a door is somebody's decision rather than a dependency's.

**Sending and recording are two commands, and the network call is in between.**
`notifications.send` renders once and writes a pending row per address inside the
caller's transaction; the delivery jobs are held until the outermost commit (ADR-0023),
so an order that rolls back tells nobody. The job sends and then executes
`notifications.record`, so the row it changes goes through the Command Bus like every
other row (SPEC.md §14) and the external call happens outside a transaction.

## Consequences

- An application gains an address book, a delivery log and a retry it did not write. A
  chat can be silenced for an evening without losing what it is.
- A notification that did not arrive says so in a row, with the channel's own words in
  it. That is the difference between "the kitchen was not told" and "nobody knows
  whether the kitchen was told".
- Delivery is at-least-once and the job checks `status === 'sent'` before sending, so a
  worker killed between the send and the record does not send a duplicate. It cannot
  rule one out: a channel that delivered and then failed to answer is indistinguishable
  from one that did not deliver.
- A recipient pointing at a channel this deployment was not given produces a failed
  delivery rather than silence. A misconfiguration is visible in the same list as
  everything else.
- The rendered text is stored, so the log holds what was actually said. It therefore
  holds whatever the notification carried — a telephone number, an address — and
  nothing here expires it. Retention is an application's decision and it has not been
  made.
- `notifications.record` is a command, so it is an MCP tool and a REST endpoint like
  any other. Nothing grants it, and the policy above refuses a caller who is not a job
  — but an application that grants the permission broadly has given somebody the
  ability to mark a delivery as sent.

## Alternatives

**A port in `core` with `@assemora/notify-telegram` beside it.** The smaller change,
and it is what an application wants on the day it has exactly one hard-coded chat id.
It answers only "how does the byte leave": every application would then write its own
recipients table, its own retry and its own record of what was sent. Rejected because
those three are what makes a notification trustworthy, and none of them is
application-specific.

**Only in the application.** `papa-cotta` could have had eighty lines in
`src/notify/telegram.ts` this afternoon. Rejected because the next site starts from
nothing again, and because a chat id in an environment variable is not something a
person can change without a deployment.

**A recipient subscribes through code.** Subscriptions as a declaration rather than
rows would be typed and reviewable. Rejected because the people who know which chat
wants which topic are the people using Studio, and a deployment to add a courier's chat
is how an address book stops being maintained.

**Formatting with `parse_mode`.** Bold order numbers read better. Rejected for now:
every value in the message comes from a stranger, and the escaping has to be right
every single time rather than nearly always. A channel that wants formatting can grow a
structured message the driver escapes, which is why `NotificationMessage` is an object
with one field rather than a string.
