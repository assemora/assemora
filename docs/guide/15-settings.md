# Settings

```ts
import { module } from '@assemora/core'

export const search = module('search').settings({
  name: 'search',
  section: 'platform',
  label: { en: 'Search', uk: 'Пошук', ru: 'Поиск' },
  icon: 'gauge',
  blurb: 'What the index holds, and where it is rebuilt.',
  blocks: [
    {
      title: 'Index',
      locked: true,
      note: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
      rows: [
        { key: 'search.engine', kind: 'value', label: 'Engine', value: 'Meilisearch' },
        {
          key: 'search.rebuild',
          kind: 'link',
          label: 'Rebuild',
          help: 'Every document, from scratch. Takes a minute.',
          href: '/api/queries/search.status',
          action: 'Open',
        },
      ],
    },
  ],
})
```

That is the whole of a settings group. It reaches Studio's settings screen as a group
under **Platform** with an icon, a blurb, one block, two rows; it reaches an agent as
part of `assemora.describe`; and the module that declared it is recorded as the one
that did. Nothing in Studio was told (ADR-0031).

Studio's settings screen holds no list of groups, the way its sidebar holds no list of
collections. What it draws is a `settings` section of the Schema Registry, and whoever
knows a fact declares it there: the umbrella declares what only it knows — the
project's name, the languages, the API prefix and its limits, where an agent connects —
and a module declares its own.

## The shape

Three levels, which are the three levels of the screen.

| | | |
| --- | --- | --- |
| **Group** | a screen: `name`, `section`, `label`, `icon`, `blurb`, `badge` | one per module, filed under `workspace`, `content` or `platform` |
| **Block** | a decision: `title`, `note`, `locked` | a card of rows |
| **Row** | a setting: `key`, `label`, `help`, and a kind | `value` prints a fact, `link` goes somewhere |

A row is one of two things. A `value` is a fact the application decided and prints —
a name, a path, a size — already written as words, because the application is what
knows what its own number means. A `link` is somewhere the reader goes to decide
something the screen does not hold.

There is no `input`. A setting somebody changes at run time is a command's input, and
a command is already described in its own section of the registry (SPEC.md §14). A
stored setting is a singleton — see below — and it arrives as exactly that: a command,
validated, authorized, revised, audited, a tool an agent can call, rather than a third
row kind that would need all of that invented again for one screen.

`locked` says the block's values were declared in the project's own source. Studio
draws the tag and no control: a screen that offered a switch for a value in
`assemora.config.ts` would be offering to change a file it cannot reach. Every block
the umbrella declares is locked, which is the truth of the framework today.

## Words in several languages

Every sentence in a group is a `Said`: a string, or a map keyed by language tag.

```ts
label: { en: 'Largest file', uk: 'Найбільший файл', ru: 'Наибольший файл' }
```

Studio picks the language it is being read in and falls back to the first one
written. It translates nothing: these are the application's words, and the application
is simply allowed to have written them more than once (ADR-0030). A group written in
one language is read in that language by everybody.

## Values that are not known until boot

A module is written before the application exists, and some of what it would say is
handed to it later — which storage driver, what ceiling. Give `.settings()` a function
and it is called at boot, with the same checks:

```ts
module('media').settings(() => ({
  name: 'media',
  section: 'content',
  label: 'Media',
  blocks: [
    {
      title: 'Uploads',
      locked: true,
      rows: [
        {
          key: 'media.max-upload',
          kind: 'value',
          label: 'Largest file',
          value: megabytes(currentUploadLimit()),
        },
      ],
    },
  ],
}))
```

That is how `@assemora/media` declares its own group. The umbrella tells it the
ceiling with `useUploadLimit()`, beside the driver it hands over with `useStorage()`,
and the module says both. A group has one declarer: two modules cannot each add a
block to `media`, so whatever a group needs from elsewhere is told to the module that
owns it.

## A stored setting

Everything above describes a deployment. A setting a person *changes* — the site's
name, a footer note, whether orders are open — is a singleton (SPEC.md §135, ADR-0032):
fields like a resource, one row, no list.

```ts
import { email, singleton, text, toggle } from '@assemora/resources'

export const Site = singleton(
  'site',
  {
    title: text().required(),
    tagline: text(),
    contactEmail: email(),
    open: toggle().agentAccess({ write: false }),
  },
  { label: 'Site settings', icon: 'building' },
)

export const site = module('site').singletons(Site)
```

It reaches the settings screen as a group under **Content** whose rows are its fields,
drawn by the same control every entry form uses and saved through the screen's one
save bar. It reaches an agent as `singletons.get` and `singletons.update`, two tools for
every singleton an application has; `open` above is a field an agent may read and not
write, by the same rule an entry's fields follow (SPEC.md §76).

A write validates against the declared fields, asks the record before writing, states
the version it read — a save that lost a race is a 409, not an overwrite — and is a
revision under the singleton's own name, so `revisions.restore` puts it back. The row
lives in `assemora_singletons`, one table for every singleton, so adding a footer to a
site is never a migration. A singleton nobody has written is version 0 and empty.

```ts
await app.commands.execute('singletons.update', {
  name: 'site',
  values: { title: 'Papa Cotta', open: true },
  expectedVersion: 0,
})
```

A visitor is not told the row: `singletons.get` is a query with a permission, and a
storefront needs a narrower answer anyway. Declare a query of your own and read the row
with `readSingleton()`, the way a menu query reads the dishes — it leaves hidden fields
out and offers no write, because `singletons.update` is the one.

```ts
export const SiteFacts = query('site.facts', {
  input: {},
  output: { title: string(), open: boolean() },
  handle: async () => {
    const { values } = await readSingleton('site')

    return { title: String(values.title ?? ''), open: values.open !== false }
  },
})
```

## What is refused, and where

`settingsGroup()` checks a group where it is written — at `module()` for a group
written out, at boot for one given as a function — and throws a `ConfigurationError`
naming the group and the fault:

- a name that is not kebab-case, or a section the sidebar does not have;
- an icon that is not a name (`CreditCard` is a component, `credit-card` is a name);
- a group with no blocks, a block with no rows, two blocks with one title;
- a row key that is not a dotted path of names, or one used twice in the group;
- a sentence that says nothing in one of the languages it claims.

Each of those would otherwise be discovered as an empty card, a document icon or two
rows a search counts as one — on a screen, by somebody who cannot fix it.

## Where to look next

- [Resources](05-resources.md) — the fields a singleton is declared with.
- [Commands and queries](06-commands-and-queries.md) — the pipeline `singletons.update`
  goes through.
- [Agents and MCP](10-agents-and-mcp.md) — `assemora.describe`, which answers with the
  same section.
- `docs/adr/0031-settings-are-described.md` for the reasoning, and
  `packages/assemora/src/settings-groups.ts` for the groups the umbrella declares.
