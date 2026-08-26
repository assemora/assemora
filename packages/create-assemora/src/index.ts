/**
 * `create-assemora` — how a project starts (SPEC.md §78, §124).
 *
 * The package has no dependencies, and cannot have one: `pnpm create assemora
 * my-project` runs it before anything is installed, so a dependency of its own would
 * have to be fetched first (ADR-0021). Node 24 builtins are the whole toolkit.
 *
 * `scaffold()` is the entire public API. `assemora new` in `@assemora/cli` calls this
 * function rather than owning a second scaffolder, which is what keeps one definition
 * of what a generated project is.
 */
export { ScaffoldError } from './error.js'
export { applyFeatures, FEATURES, type Feature, type Features } from './features.js'
export { dependencyRange } from './package-json.js'
export {
  projectNameError,
  type ScaffoldOptions,
  type ScaffoldResult,
  scaffold,
} from './scaffold.js'
export {
  DEFAULT_TEMPLATE,
  type FeatureManifest,
  MANIFEST_FILE,
  type ResolveTemplateOptions,
  readManifest,
  resolveTemplate,
  type TemplateManifest,
} from './template.js'
