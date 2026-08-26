/**
 * Whether the viewer may do a thing (SPEC.md §50).
 *
 * This decides what Studio *offers*, never what it is allowed: the server answers
 * that, on every command, and a mismatch here shows a button that returns 403 rather
 * than letting anything through. It matches `holds()` in `@assemora/auth`, and
 * `permissions.test.ts` is what keeps the two honest.
 */

export const WILDCARD = '*'

export const holds = (permissions: readonly string[], permission: string): boolean => {
  if (permissions.includes(WILDCARD) || permissions.includes(permission)) return true

  const segments = permission.split('.')

  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    if (permissions.includes(`${segments.slice(0, depth).join('.')}.*`)) return true
  }

  return false
}
