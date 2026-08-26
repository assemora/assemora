/**
 * Structured logging (SPEC.md §87).
 *
 * Request id, actor and source are read from the ambient context, so a caller never
 * has to remember to attach them.
 */
import { currentContext } from './context.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Readonly<Record<string, unknown>>

export type LogRecord = {
  readonly level: LogLevel
  readonly message: string
  readonly requestId?: string
  readonly actorType?: string
  readonly actorId?: string
  readonly source?: string
} & LogFields

export type Logger = {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** A logger that adds `fields` to everything it writes. */
  child(fields: LogFields): Logger
}

export type LogWriter = (record: LogRecord) => void

export const writeToConsole: LogWriter = (record) => {
  const line = JSON.stringify(record)
  if (record.level === 'error' || record.level === 'warn') {
    console.error(line)
  } else {
    console.log(line)
  }
}

/** Drops everything. The default in tests, where log noise is not evidence. */
export const silentWriter: LogWriter = () => {}

export const createLogger = (write: LogWriter = writeToConsole, base: LogFields = {}): Logger => {
  const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    const context = currentContext()

    write({
      level,
      message,
      ...(context === undefined
        ? {}
        : {
            requestId: context.requestId,
            source: context.source,
            ...(context.actor === undefined
              ? {}
              : { actorType: context.actor.type, actorId: context.actor.id }),
          }),
      ...base,
      ...fields,
    })
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger(write, { ...base, ...fields }),
  }
}
