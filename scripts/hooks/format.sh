#!/usr/bin/env bash
# Formats the single TypeScript file that was just edited (SPEC.md §104).
#
# Formatting only: no lint fixes, and never a repository-wide rewrite, so an
# unrelated file cannot drift into the current task's diff (SPEC.md §106).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

read_field() {
  node -e '
    let raw = ""
    process.stdin.on("data", (chunk) => { raw += chunk })
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw)
        process.stdout.write(String(payload?.tool_input?.file_path ?? ""))
      } catch {
        process.stdout.write("")
      }
    })
  ' 2>/dev/null
}

file=$(read_field)

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

pnpm exec biome format --write "$file" >/dev/null 2>&1 || true
exit 0
