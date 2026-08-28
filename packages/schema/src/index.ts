/**
 * `@assemora/schema` — the primitives every other layer is built on.
 *
 * A declaration made here is simultaneously a runtime parser, a compile-time type
 * and a JSON description, so validation, the database, Studio, OpenAPI, the SDK and
 * MCP all read one source (SPEC.md §3.4, §42).
 *
 * This package has no dependencies, external ones included, and never will —
 * `pnpm boundaries` enforces that.
 */

export {
  type BlockNode,
  type BlockTree,
  blockIds,
  blockTree,
  type ChangedBlock,
  diffTrees,
  emptyTree,
  findBlock,
  type TreeChange,
  walkBlocks,
} from './blocks.js'
export {
  type ArraySchema,
  array,
  type ObjectSchema,
  object,
} from './composites.js'
export {
  BLOCK_ALIGNMENTS,
  BLOCK_WIDTHS,
  type BlockAlignment,
  type BlockDesign,
  type BlockDesignPatch,
  type BlockWidth,
  blockDesign,
  blockDesignPatch,
  CONTAINER_WIDTHS,
  type ContainerWidth,
  hiddenOnViewport,
  isPlainDesign,
  RADIUS_SCALE,
  type RadiusScale,
  SPACING_SCALE,
  type SpacingScale,
  VIEWPORTS,
  type Viewport,
} from './design.js'
export { changedFields, diff, type Patch } from './patch.js'
export {
  type BigIntSchema,
  type BinarySchema,
  type BooleanSchema,
  bigint,
  binary,
  boolean,
  type EnumSchema,
  email,
  enumOf,
  integer,
  type JsonValueSchema,
  json,
  type NumberSchema,
  nullable,
  number,
  optional,
  type StringSchema,
  string,
  type TimestampSchema,
  timestamp,
  type UnknownSchema,
  unknown,
  uuid,
} from './primitives.js'
export {
  fail,
  failWith,
  type Infer,
  type InferShape,
  type Issue,
  type JsonSchema,
  nest,
  type OptionalSchema,
  ok,
  type ParseResult,
  type Schema,
  type SchemaKind,
  type Shape,
} from './types.js'
