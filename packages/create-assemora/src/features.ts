/**
 * The three answers of SPEC.md §78, and how one template becomes eight projects.
 *
 * There are two mechanisms and they divide along a line worth stating. A *file* that
 * only exists for a feature, and a *dependency* that only exists for it, are named in
 * the template's own `template.json` — a manifest, because a file cannot carry a
 * comment about whether it should exist and `package.json` cannot carry a comment at
 * all. Everything smaller than a file — an import, a line in a module list, a route —
 * is fenced in place with a marker comment, because moving those few lines into a
 * separate file purely so a manifest could name it would make the starter harder to
 * read than the thing it is being read to explain.
 *
 * A marker is recognised by its text rather than by its comment syntax, and the whole
 * line goes. That is what lets the same two words work in TypeScript, in Markdown, in
 * an `.env.example` and in YAML:
 *
 * ```ts
 * // assemora:if studio
 * import { studio } from './studio.js'
 * // assemora:end
 * ```
 *
 * ```html
 * <!-- assemora:if !pages -->
 * This project has no page builder.
 * <!-- assemora:end -->
 * ```
 *
 * Every mistake here is refused rather than guessed at. A misspelt feature name would
 * otherwise delete a region for ever, or keep one for ever, and nothing downstream
 * would notice: `assemora:if studios` is a failed scaffold with a line number.
 */
import { ScaffoldError } from './error.js'

/** In the order SPEC.md §78 asks about them. */
export const FEATURES = ['studio', 'pages', 'mcp'] as const

export type Feature = (typeof FEATURES)[number]

/** One answer per question. All three default to yes (SPEC.md §78). */
export type Features = Readonly<Record<Feature, boolean>>

export const isFeature = (name: string): name is Feature =>
  (FEATURES as readonly string[]).includes(name)

/** `!` is the other branch: what the project says when the feature is *not* there. */
const OPENS = /assemora:if\s+(!?)([A-Za-z][A-Za-z0-9-]*)/
/** Guarded so that a word merely beginning `assemora:end` does not close a region. */
const CLOSES = /assemora:end(?![A-Za-z0-9-])/

type Region = {
  readonly feature: Feature
  readonly negated: boolean
  /** One-based, so that a complaint reads like every other compiler's. */
  readonly line: number
}

/**
 * Two blank lines in a row, where a region used to be.
 *
 * A region with a blank line on each side of it leaves both behind when it goes, and
 * the project should read as though nobody had ever cut anything out of it. One blank
 * line is what the repository's own formatter would leave, so that is what is left.
 */
const HOLES = /\n{3,}/g

/**
 * The text with every region the answers exclude removed.
 *
 * `file` is only ever used to name the file in a complaint. Regions nest, because
 * "this line only exists when there are both pages and a studio" is a thing a starter
 * will want to say, and a mechanism that silently did the wrong thing there would be
 * worse than one that refused.
 */
export const applyFeatures = (text: string, features: Features, file: string): string => {
  const lines = text.split('\n')
  const kept: string[] = []
  const open: Region[] = []
  let removed = false

  const keeping = (): boolean => open.every((region) => features[region.feature] !== region.negated)

  lines.forEach((line, index) => {
    const opened = OPENS.exec(line)

    if (opened !== null) {
      const name = opened[2] ?? ''

      if (!isFeature(name)) {
        throw new ScaffoldError(
          `${file}:${index + 1}: "${name}" is not one of the questions a project is scaffolded ` +
            `with (${FEATURES.join(', ')}).`,
        )
      }

      open.push({ feature: name, negated: opened[1] === '!', line: index + 1 })
      return
    }

    if (CLOSES.test(line)) {
      if (open.pop() === undefined) {
        throw new ScaffoldError(
          `${file}:${index + 1}: this "assemora:end" closes a region that was never opened.`,
        )
      }

      return
    }

    if (keeping()) kept.push(line)
    else removed = true
  })

  const unclosed = open[0]

  if (unclosed !== undefined) {
    throw new ScaffoldError(
      `${file}: the "assemora:if ${unclosed.negated ? '!' : ''}${unclosed.feature}" on line ` +
        `${unclosed.line} is never closed with "assemora:end".`,
    )
  }

  const result = kept.join('\n')

  // Only when something was taken out: a file that was left alone is left alone,
  // including whatever spacing its author chose.
  return removed ? result.replace(HOLES, '\n\n') : result
}
