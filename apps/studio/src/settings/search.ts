/**
 * How the settings sidebar searches (`design_handoff_studio_redesign` §5).
 *
 * Every group, not the open one: a setting you cannot name the group of is exactly the
 * one you search for. The sidebar is rewritten to the groups that answer, each with a
 * count, and the open group shows only the rows that do.
 */

/** A row as the reader sees it: its label and help, in words. */
export type Spoken = { readonly label: string; readonly help: string }

/**
 * Whether a row is about what was typed.
 *
 * The label and the help together, because the help is where a setting says what it
 * does — "fall back", "upload", "agent" — and a person searching rarely knows the label
 * of the thing they cannot find.
 */
export const matches = (row: Spoken, query: string): boolean => {
  const wanted = query.trim().toLowerCase()

  if (wanted === '') return true

  return `${row.label} ${row.help}`.toLowerCase().includes(wanted)
}

/**
 * How many rows of each group answer the query.
 *
 * A group whose own name matches counts as a hit with no rows, so typing "media" finds
 * the group before it finds a row in it.
 */
export const hitsOf = (
  groups: readonly {
    readonly key: string
    readonly label: string
    readonly rows: readonly Spoken[]
  }[],
  query: string,
): ReadonlyMap<string, number> => {
  const hits = new Map<string, number>()
  const wanted = query.trim().toLowerCase()

  if (wanted === '') return hits

  for (const group of groups) {
    const found = group.rows.filter((row) => matches(row, query)).length

    if (found > 0 || group.label.toLowerCase().includes(wanted)) hits.set(group.key, found)
  }

  return hits
}
