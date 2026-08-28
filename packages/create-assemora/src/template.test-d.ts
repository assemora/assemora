/**
 * What a template says about itself, as a type (SPEC.md §78).
 *
 * `TemplateManifest` used to *be* the feature table. It now holds that table beside
 * the one line a template says about itself, and `listTemplates` hands back one
 * summary per template so that `--help` — and the failure for a name that is not one
 * of them — can print a choice rather than a bare list of names. All three are
 * exported, so all three are somebody else's compile error to get wrong.
 *
 * The two claims worth a type test are the ones a reader would otherwise have to take
 * on trust: a description is *stated* rather than omitted, and the feature table has
 * an entry for every question this scaffolder asks and for nothing else. Both are how
 * `readManifest` can be read without a second null check at every call site.
 */
import { expectTypeOf, test } from 'vitest'

import type { Feature } from './features.js'
import {
  type FeatureManifest,
  listTemplates,
  type ResolveTemplateOptions,
  readManifest,
  resolveTemplate,
  type TemplateManifest,
  type TemplateSummary,
} from './template.js'

/** A feature that contributes nothing, which is what most features are. */
const nothing: FeatureManifest = { files: [], dependencies: [], scripts: [] }

/** Checked where it is written, which is the only place a mistake in it is cheap. */
const manifest = (value: TemplateManifest): TemplateManifest => value

const summary = (value: TemplateSummary): TemplateSummary => value

test('a manifest holds what the template says beside what it declares', () => {
  expectTypeOf(readManifest).returns.resolves.toEqualTypeOf<TemplateManifest>()
  expectTypeOf<TemplateManifest['description']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<TemplateManifest['features']>().toEqualTypeOf<
    Readonly<Record<Feature, FeatureManifest>>
  >()
})

test('a description is stated, and sometimes what it states is nothing', () => {
  // Not optional. A template that says nothing about itself is an ordinary thing to
  // be, and it is a different fact from a field somebody forgot to fill in — making
  // it optional would let the second be read as the first at every call site.
  expectTypeOf(
    manifest({
      description: undefined,
      features: { studio: nothing, pages: nothing, mcp: nothing },
    }).description,
  ).toEqualTypeOf<string | undefined>()

  // @ts-expect-error so the field cannot simply be left out
  manifest({ features: { studio: nothing, pages: nothing, mcp: nothing } })
})

test('the feature table answers every question this scaffolder asks, and no others', () => {
  // @ts-expect-error one of the three is missing
  manifest({ description: undefined, features: { studio: nothing, pages: nothing } })

  manifest({
    description: 'a worked example',
    features: {
      studio: nothing,
      pages: nothing,
      mcp: nothing,
      // @ts-expect-error and a template cannot invent a fourth question nobody answers
      docker: nothing,
    },
  })
})

test('a listing is one summary per template, and nothing may be added to it', () => {
  expectTypeOf(listTemplates).returns.resolves.toEqualTypeOf<readonly TemplateSummary[]>()
  expectTypeOf(summary({ name: 'bare', description: undefined })).toEqualTypeOf<TemplateSummary>()

  const listed: readonly TemplateSummary[] = []

  // @ts-expect-error the listing describes a checkout; it is not somewhere to put one
  listed.push({ name: 'mine', description: undefined })

  const first = listed[0]

  // @ts-expect-error and a summary is what was found, not something to rename
  if (first !== undefined) first.name = 'other'
})

test('where the search starts is the only thing either caller may say', () => {
  expectTypeOf<ResolveTemplateOptions>().toEqualTypeOf<{ readonly from?: string }>()

  // @ts-expect-error a starting point is a path
  void listTemplates({ from: 3 })

  // @ts-expect-error and it is the only option there is
  void resolveTemplate('bare', { root: '/somewhere' })
})
