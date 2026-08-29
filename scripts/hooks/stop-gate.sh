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

# The Node this repository is written for, whatever the shell that launched the session
# happens to be on.
#
# `pnpm boundaries` runs `scripts/check-boundaries.ts` through `node` directly, and
# stripping the types out of a `.ts` file is a Node 24 feature. A session started from a
# shell pinned to something older therefore fails on the gate's *first* command with
# `ERR_UNKNOWN_FILE_EXTENSION` — a complaint about a file extension, for a version
# mismatch, on a gate that never reached lint, typecheck or the tests. Every turn then
# reports a failure that has nothing to do with the turn.
#
# A hook inherits the PATH of the process that launched Claude Code and cannot ask a
# shell to change it, so it looks for an installed version itself rather than asking the
# person to fix their shell between turns.
required=$(sed 's/^v//' .node-version 2>/dev/null | head -1)

version_of() {
  "$1" -v 2>/dev/null | sed 's/^v//'
}

# Whole version rather than the major: `.node-version` says 24.19.0 and `engines` says
# >= 24.11.0, so a 24.1.0 satisfies a major-only test and neither of the two declarations
# it is supposed to satisfy.
satisfies() {
  [ -n "$1" ] && [ "$(printf '%s\n%s\n' "$required" "$1" | sort -V | head -1)" = "$required" ]
}

if [ -n "$required" ]; then
  current=$(version_of node)

  if ! satisfies "$current"; then
    # Newest first, and every layout this has to work on: whichever version manager
    # installed one, the gate only needs its `bin` directory in front of PATH.
    for candidate in $(
      ls -d \
        "${FNM_DIR:-$HOME/.local/share/fnm}"/node-versions/*/installation/bin \
        "$HOME/Library/Application Support/fnm/node-versions"/*/installation/bin \
        "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin \
        /opt/homebrew/opt/node@*/bin \
        /usr/local/opt/node@*/bin \
        2>/dev/null | sort -Vr
    ); do
      found=$(version_of "$candidate/node")

      if satisfies "$found"; then
        export PATH="$candidate:$PATH"
        current=$found
        break
      fi
    done
  fi

  # Said plainly rather than left to fail as something else: this is the one gate
  # failure the model cannot fix by editing the repository.
  if ! satisfies "$current"; then
    echo "This repository needs Node ${required} or newer, and the gate found ${current:-none} on PATH with no newer version installed. Install one — fnm install ${required}, nvm install ${required}, or Homebrew — and the gate will find it." >&2
    exit 2
  fi
fi

if output=$(pnpm boundaries 2>&1 && pnpm lint 2>&1 && pnpm typecheck 2>&1 && pnpm test 2>&1); then
  exit 0
fi

echo "$output" >&2
echo >&2
echo 'Task gate failed (SPEC.md §104). Milestone gate including build: pnpm verify' >&2
exit 2
