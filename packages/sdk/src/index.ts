/**
 * `@assemora/sdk` — the typed client.
 *
 * The runtime is generic and the types are generated from the Schema Registry, so a
 * resource or a route that exists is one the SDK can already call (SPEC.md §48,
 * §121). This package depends on `@assemora/schema` alone, which is what keeps it
 * safe to put in a browser bundle.
 */

export {
  type Client,
  type ClientOptions,
  type Created,
  createClient,
  type ListQuery,
  type Page,
  type ResourceClient,
  SdkError,
} from './client.js'
export {
  type GenerateOptions,
  generateSdk,
  type RegistrySnapshot,
  toTypeScript,
} from './generate.js'
