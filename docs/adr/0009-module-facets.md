# 0009. Module builder methods contributed by packages above core

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §13 fixes the module API:

```ts
module('blog')
  .models(Post, Category)
  .resources(Posts)
  .commands(PublishPost)
  .routes(routes)
```

`.models()` belongs to `@assemora/data`, `.resources()` to `@assemora/resources`,
`.routes()` to `@assemora/http`. `core` owns `module()` and, by SPEC.md §8, must not
know any of those packages exist. SPEC.md §125.17 forbids changing a public API just
to make the implementation easier, so replacing the named methods with a generic
`.use(...)` is not available.

## Decision

Two halves, one for types and one for runtime.

**Types.** `ModuleBuilder` is an `interface`, so a package augments it:

```ts
declare module '@assemora/core' {
  interface ModuleBuilder {
    models(...models: Model[]): ModuleBuilder
  }
}
```

**Runtime.** `core` keeps a facet registry. A package calls `defineModuleFacet` at
import time, and `module()` attaches one method per registered facet when it builds
the object. A facet receives `ModuleInternals` — the module's name plus
`addRegistration` and `addHook` — and nothing else.

Registrations run synchronously while the application is being created, so
introspection sees a complete picture before anything boots. A facet that registers
asynchronously is rejected with a message pointing at `boot()`.

## Consequences

- The API of §13 is preserved exactly, and `core` still compiles with no knowledge of
  models, resources or routes.
- A package must do two things to add a facet — augment the interface and register
  the runtime behaviour. They can drift apart: the type would exist while the method
  does not. Each package that defines a facet owns a test proving the method runs.
- Facets are global to the process. Defining the same facet twice throws rather than
  silently overwriting.

## Alternatives

A generic `.use(registration)` — rejected against SPEC.md §13 and §125.17. A `Proxy`
around the builder — rejected: the same result with worse stack traces and no
discoverable own-properties.
