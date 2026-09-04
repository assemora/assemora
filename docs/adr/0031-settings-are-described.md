# 0031. Settings are described

Status: accepted
Date: 2026-09-04

## Context

`design_handoff_studio_redesign` §5 draws a settings screen: sections in a sidebar, a
group per screen, a block per decision, a row per setting, one save bar. The first port
of it into `apps/studio` held a hand-written map — five groups, their blocks, the key of
every row — and found the values by reading the registry sideways: the upload ceiling
from the `bodyLimit` of a route whose path Studio spelled out, the MCP address from a
route tag, the project's name from a second request to `/openapi.json`.

Studio does that nowhere else. It has no list of collections, no hand-written form and
no list of block types: every one of those is a section of the Schema Registry, declared
once by whoever knows and read by Studio, OpenAPI, the SDK and `assemora.describe`
alike (SPEC.md §42). A settings screen that knew the server's addresses and a list of
groups was a second kind of Studio, and the day a package declared a setting of its own
there was nowhere for it to go.

## Decision

**A `settings` section of the Schema Registry.** A group is `SettingsGroupDescriptor`
in `@assemora/core`: a name, a section (`workspace`, `content`, `platform`), a label, an
icon name, an optional badge, and blocks of rows. A row is a `value` — a fact already
written as words — or a `link` — somewhere the reader goes. A block may be `locked`,
which says its values were declared in the project's source and offers no control.

**Declarative data, and nothing else.** Strings and a kind per row; no function, no
schema, no predicate. A group reaches a browser as JSON and an agent over MCP, and a
function survives neither (ADR-0027). The words in it are the application's — printed by
Studio as they arrive, the way a resource's label is, and never translated there.

**Whoever knows, declares.** The umbrella registers the groups only it can fill: the
project's name and version, the languages, the upload ceiling it sized the upload route
to, the API prefix and its rate limit, where it mounted the MCP endpoint and in which
mutation mode, how the session cookie travels. A module declares its own with
`module('search').settings({ … })`, checked where it is written and registered under the
module's name. Studio draws the section and holds one group of its own — which language
it speaks — because that is a fact about the person reading, stored in the browser
(ADR-0030).

**There is no `input` row.** A setting somebody changes at run time is a command's
input, and a command is already described in its own section (SPEC.md §14). When a
stored setting exists (SPEC.md §135), it arrives as a command with a policy, a revision
and an audit entry, not as a third row kind that would need all of those invented again
for one screen.

## Consequences

- `apps/studio/src/screens/settings.tsx` has no list of groups, no row keys and no
  server address. Adding a group anywhere in the process adds it to the screen and to
  `assemora.describe` without a line of Studio.
- A group that cannot be drawn — a section the sidebar lacks, an icon that is not a
  name, a row key used twice, a block with no rows — is refused by `settingsGroup()` at
  the declaration, not discovered as an empty card.
- Every block the umbrella declares is `locked`. The screen is, today, a description of
  the deployment with one preference on it. That is the truth of the framework, and the
  screen says it rather than drawing controls that reach nothing.
- An agent asked "what is the upload limit" reads the same sentence a person does.

## Alternatives

- **Keep the map in Studio.** Rejected: it is the one screen that would know addresses
  the server chose and a list the registry already holds, and it closes the screen to
  packages.
- **A settings *store* now — `settings.get` / `settings.update` over a JSONB row.**
  Rejected for this change: it decides what a stored setting *is* before anything needs
  one, and §135 has that decision. When it lands, it is a command and this section
  describes its facts; the two do not compete.
- **Translate the groups in Studio by key.** Rejected: the words are the
  application's, and a fourth package would have to ship its strings inside Studio's
  bundle to be read in Ukrainian, which is the coupling ADR-0030 refuses.
