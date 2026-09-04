/**
 * What keeps a server from outliving the CLI that started it.
 *
 * `assemora dev` and `assemora start` preload this file into the server with
 * `--import`, naming the CLI's pid in the URL. It polls that pid, and when it is gone
 * it stops the process group it is in — the server, and under `--watch` the wrapper
 * above it. A signal the CLI forwards is the ordinary way down; this is for the CLI
 * dying with no chance to forward anything, which is a `kill -9`, a crash, or a tool
 * that kills the process group of the shell it started. The child runs detached in a
 * group of its own, so that last one reaches the CLI and nothing below it — and after
 * an afternoon of it, nineteen servers were listening with init for a parent (#27).
 *
 * The pid comes from the URL rather than the environment because the environment is
 * inherited whole by the server and by whatever the server starts, and a variable in
 * it is a fact the CLI would be leaking into an application. The import specifier is
 * the CLI's own, read by nobody else.
 *
 * It watches the CLI and not its parent, because under `--watch` its parent is Node's
 * wrapper, which outlives the CLI: Node runs a preload in the script's process and not
 * in the wrapper's, so the wrapper cannot watch anything for itself. It is instead
 * taken down with the group — signalling pid 0 addresses the caller's own group, and
 * the wrapper answers a SIGTERM by stopping its child and leaving.
 *
 * Nothing here may keep the event loop alive or throw: a server that has finished its
 * work has to be able to exit, and a preload that fails takes the server with it.
 */
const EVERY = 500
const GRACE = 5_000

const supervisor = Number(new URL(import.meta.url).searchParams.get('parent'))

/**
 * Whether a pid names nothing any more.
 *
 * `ESRCH` is that. `EPERM` is a live process belonging to somebody else, which after a
 * pid is reused is "not the CLI" too — but it cannot be told apart from the CLI
 * running under another user, so it counts as alive and the server stays.
 */
const gone = (pid: number): boolean => {
  try {
    process.kill(pid, 0)

    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * Signals this process and everything grouped with it.
 *
 * Windows has no process groups; there the process signals itself, and a `--watch`
 * wrapper stays waiting for a file change, holding nothing. That is the same limit
 * `run.ts` states for the signals it forwards.
 */
const everyone = (signal: NodeJS.Signals): void => {
  try {
    process.kill(process.platform === 'win32' ? process.pid : 0, signal)
  } catch {
    // The group has already gone, which is the outcome being asked for.
  }
}

if (Number.isInteger(supervisor) && supervisor > 0) {
  const timer = setInterval(() => {
    if (!gone(supervisor)) return

    clearInterval(timer)
    everyone('SIGTERM')

    // A server draining gracefully is the reason for the grace; a server that ignores
    // SIGTERM is the reason for what follows it.
    setTimeout(() => everyone('SIGKILL'), GRACE).unref()
  }, EVERY)

  timer.unref()
}
