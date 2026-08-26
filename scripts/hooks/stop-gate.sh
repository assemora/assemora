#!/usr/bin/env bash
# Task-completion gate (SPEC.md §104): boundaries, lint, typecheck and tests.
#
# `pnpm verify` adds the build and is the milestone gate — Claude Code has no
# milestone event to hang a hook on, so that one stays a command (see ADR-0007).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

payload=$(cat)

# Never block twice in a row: a failure the model cannot fix would loop forever.
already_blocked=$(printf '%s' "$payload" | node -e '
  let raw = ""
  process.stdin.on("data", (chunk) => { raw += chunk })
  process.stdin.on("end", () => {
    try {
      const parsed = JSON.parse(raw)
      process.stdout.write(parsed?.stop_hook_active === true ? "true" : "false")
    } catch {
      process.stdout.write("false")
    }
  })
' 2>/dev/null)

[ "$already_blocked" = 'true' ] && exit 0

if output=$(pnpm boundaries 2>&1 && pnpm lint 2>&1 && pnpm typecheck 2>&1 && pnpm test 2>&1); then
  exit 0
fi

echo "$output" >&2
echo >&2
echo 'Task gate failed (SPEC.md §104). Milestone gate including build: pnpm verify' >&2
exit 2
