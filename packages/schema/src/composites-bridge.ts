/** Re-exported so `blocks.ts` can compose primitives without a circular import. */
export { array, type ObjectSchema, object } from './composites.js'
export { boolean, enumOf, json, number, string } from './primitives.js'
