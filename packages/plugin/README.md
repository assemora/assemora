# @assemora/plugin

A module somebody else wrote (SPEC.md §80).

```ts
import { plugin } from '@assemora/plugin'

export default plugin('seo', {
  version: '1.0.0',
  description: 'Meta tags, sitemaps and structured data',
})
  .resources(SeoSettings)
  .blocks(FaqBlock)
  .routes(sitemap)
  .commands(RegenerateSitemap)
```

An application installs it the way it registers anything else:

```ts
createApplication({ modules: [seo] })
```

Exporting a function that returns the plugin works just as well, and is what the
modules in this repository do — `modules: [seo()]` then gives every application its
own builder.

## A plugin is a module

`module()` already has every method SPEC.md §80 asks for: `.commands()` and
`.queries()` come from `@assemora/core`, and `.models()`, `.resources()`, `.blocks()`
and `.routes()` arrive as facets from the packages that own those declarations
(ADR-0009). So `plugin()` builds a module and hands it back, and an installed plugin
goes through the same Command Bus, the same policies and the same revisions the
application's own code does. There is deliberately no `plugins: [...]` option beside
`modules: [...]`: a second registration path is a second place for authorization to
be missing from, and it would buy nothing — the two would do the same thing.

That is also why this package depends on `@assemora/schema` and `@assemora/core` and
nothing else, and can still offer `.resources()` and `.routes()`. It never sees a
resource or a route: the *application* installs the packages that contribute those
methods, and the types arrive with them through interface augmentation. A plugin that
calls `.blocks()` in an application that never installed `@assemora/pages` finds no
such method — which fails where the plugin declares itself, not at the first call.

## What a plugin has that a module does not

Provenance. It ships as an npm package the application did not write, so it carries
that package's version and description, and it writes itself into the `plugins`
section of the Schema Registry when the application registers it:

```ts
installedPlugins(app.registry)
// [{
//   name: 'seo',
//   version: '1.0.0',
//   description: 'Meta tags, sitemaps and structured data',
//   contributes: {
//     resources: { count: 1, names: ['seoSettings'] },
//     blocks: { count: 1, names: ['faq'] },
//     routes: { count: 1, names: ['get /sitemap.xml'] },
//     commands: { count: 1, names: ['seo.regenerateSitemap'] },
//   },
// }]
```

That is the answer to "what did installing this actually add", which is the question a
person has about code they did not write. It lives in the registry rather than in a
list of its own, so `GET /api/_introspection` — the API Explorer's source — carries it
already (SPEC.md §42, §45).

The contributions are recorded as the chain is written, under the builder method that
made each one — including a method contributed by a package that does not exist yet,
because the wrapper forwards whatever the module has rather than listing what it
expects. The names come off the declarations themselves: a resource, a command and a
query carry `name`, a block carries `type`, a model carries `table`, a policy carries
the `subject` it guards, and a route is known by its method and path — written the way
`routeName()` writes it, so `registry.find('routes', name)` finds the same route.

### Why a count and not just a list

This package may import none of the packages that own those declarations, so it reads
the label off the declaration rather than asking. Something it cannot label still
happened, and a list of names is not a count: reporting only the recognised names
would answer "this plugin added no policies" for a plugin that added five, which is
the one thing a person auditing somebody else's package must not be told wrongly. So
`count` is every declaration the method was handed and `names` are the ones that could
be named — never padded with an invented name, and never quietly shorter than the
truth.

## What the registry publishes, and where an application turns it off

`plugins` lives in the Schema Registry, so it reaches every reader of the registry —
including `GET /api/_introspection` (`introspectionRoute` in `@assemora/openapi`),
which requires a credential unless the application passes `{ public: true }`. A
plugin's `version` is therefore readable by anyone who can reach that endpoint: the
exact version of a package the application did not write, which is how a published
vulnerability is matched to a target.

The version stays, deliberately. It is what makes the entry provenance rather than a
list of names — "which version of this did we install" is the first question anyone
asks about code they did not write, and SPEC.md §42 and §80 ask for the entry so that
question has an answer without reading `node_modules`. It is not a secret under
`docs/rules/security.md`, and the same payload already enumerates every route,
resource, command and query the application has, which fingerprints it more precisely
than a version string does.

What an application decides is who may read it. That endpoint is mounted by the
application, not by this package, so an application that wants its description open
says so — and one that wants no description at all leaves the route unmounted:

```ts
// Anybody may read it, deliberately.
introspectionRoute(app.registry, { public: true })

// Under the umbrella.
assemora({ api: { introspection: 'public' }, modules: [...] })
```

`installedPlugins(app.registry)` answers the same question in process — for a Studio
screen, a CLI or a boot-time check — and needs no endpoint at all.

## Why there is no `requires`

A plugin that needs `@assemora/pages` says so as a peer dependency, which is a package
manager's business rather than the framework's. What a peer dependency cannot say is
whether the application actually *registered* `pages()` — and neither can this package,
because nothing records the modules an application has. `ModuleContext` carries one
module's name, and the Schema Registry has sections for models, resources, blocks,
routes, commands and queries, but none for modules. A check built on what is
observable would be wrong in the common case: a module that contributes only resources
leaves behind no entry carrying its name, so `requires: ['blog']` would refuse to boot
an application that has `blog` registered right there in its module list.

A requirement check that reports missing things that are present is worse than no
requirement check, so v1 ships without one. Making it sound is a small change in
`@assemora/core` — a `modules` section in the registry, written by `createApplication`
— and that is an ADR, not a patch this package can apply on its own.

The failure `requires` was meant to catch is half-caught anyway: a plugin that calls
`.blocks()` without `@assemora/pages` installed fails at its own declaration, before
an application is even built.
