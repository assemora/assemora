/**
 * Which subjects a module may speak for (SPEC.md §51, ADR-0027).
 *
 * A policy is a *grant*. `authorize` lets a caller through on a permission **or** a
 * policy, so registering one for `pages` opens `pages.create` to everybody the rule
 * says yes to — and the rule is somebody's function. That is fine while every module
 * in the process is first-party. It stops being fine the day a package is installable,
 * which is what ADR-0027 is for: twelve lines in a dependency would otherwise open the
 * application, and describing the registration (as `assemora.describe` and Studio now
 * do) makes it *visible* rather than *impossible*. Looking is not a control.
 *
 * So a module may only write a policy for a subject it declared. Two ways to have
 * declared one, and both are things the module already says out loud:
 *
 * **Its own name, as a namespace.** `module('pages')` owns `pages` and `pages.drafts`.
 * This is what every framework module relies on — `@assemora/pages` names `pages` as
 * the subject of its block commands, `@assemora/auth` answers for `auth` and
 * `auth.users` — and it is the case where the module name *is* the domain.
 *
 * **A resource or a model it registered.** An application's module is usually named
 * after the area rather than the table: `module('blog').models(Article)
 * .resources(Articles)` owns `articles`, and would own nothing at all under a
 * name-only rule. The registry knows who registered each entry, so this asks it.
 *
 * ## What this is not
 *
 * It is not a sandbox. Everything here runs in one process, and a package determined
 * to grant itself access can reach past any of it — patch the module, patch this
 * function, register a resource named `pages` (which the registry would refuse as a
 * duplicate, but the shape of the attack is the point). Nothing short of a separate
 * realm changes that, and claiming otherwise would be worse than saying so.
 *
 * What it removes is the *casual* case, which is the one that actually happens: a
 * package that wants a policy for a subject it has nothing to do with now has to
 * impersonate a module to get one, and impersonation reads as impersonation in a diff.
 */
import type { SchemaRegistry } from '@assemora/core'

/**
 * The sections whose entries name a subject.
 *
 * A model is registered under its table and a resource under its name, and both of
 * those are what a subject is spelled as — `articles`, `pages`, `media`. Nothing else
 * in the registry names one: a command is `articles.update`, and the subject inside it
 * is the part before the dot, which the namespace half of the rule already covers.
 */
const DECLARING_SECTIONS = ['resources', 'models'] as const

/**
 * Whether `module` declared `subject`, and may therefore write a policy for it.
 *
 * @param registry the application's, for the attribution — the module that registered
 *   each entry, which is what `forModule` records.
 */
export const ownsSubject = (registry: SchemaRegistry, module: string, subject: string): boolean => {
  if (subject === module || subject.startsWith(`${module}.`)) return true

  return DECLARING_SECTIONS.some((section) => registry.registeredBy(section, subject) === module)
}

/**
 * Why a subject was refused, in the terms the person reading it can act on.
 *
 * It names all three things the refusal is about — who asked, for what, and what would
 * have had to be true — because a configuration error read at boot is read once, by
 * somebody who did not write the module that caused it.
 */
export const foreignSubject = (module: string, subject: string): string =>
  `Module "${module}" registered a policy for "${subject}", which it does not declare. ` +
  `A policy is a grant: it lets a caller through where a permission would have been ` +
  `required, so a module may only write one for a subject of its own. "${module}" would ` +
  `have to name "${subject}" as a model or a resource, or be named "${subject}" itself. ` +
  `If this policy belongs to the application rather than to a module, pass it as ` +
  `auth({ policies: [...] }) at the composition root, where the application speaks for itself.`

/** The same, for a policy that reached the registry through no module at all. */
export const unattributedSubject = (subject: string): string =>
  `A policy for "${subject}" was registered outside any module, so nothing declares it ` +
  `and nothing answers for it. Register it on the module that owns the subject with ` +
  `.policies(...), or — if it is the application's — pass it as auth({ policies: [...] }).`
