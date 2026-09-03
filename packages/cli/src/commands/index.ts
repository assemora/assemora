/**
 * Where the groups reach the command table.
 *
 * `registry.ts` holds the table; a group only reaches it by being imported, and this
 * file is the one place that imports them. It is deliberately nothing else: a group
 * added here is a group in the help, and there is no second list to keep in step.
 *
 * A group that needs a heavy import — `@assemora/database-postgres` for `db:*`, the
 * SDK generator for `sdk:generate` — should reach for it inside its handler rather
 * than at the top of its module, so that `assemora --help` stays instant.
 */
import './new.js'
import './run.js'
import './db.js'
import './inspect.js'
import './artifacts.js'
import './console.js'
import './mcp.js'

import './make.js'
