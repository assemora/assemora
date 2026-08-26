/**
 * CRUD commands (SPEC.md §14, §43, §111).
 *
 * One set of commands serves every resource, static and dynamic alike, and every
 * caller — Studio, REST, the SDK, the CLI and MCP — reaches content through them and
 * through nothing else (SPEC.md §2).
 */
import { command, ForbiddenError, NotFoundError } from '@assemora/core'
import { string, unknown as unknownSchema, uuid } from '@assemora/schema'

import { refuseUnwritableFields } from './agent-fields.js'
import { resourceByName } from './registry.js'
import { PERSISTENCE } from './resource.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'entry.created': { readonly resource: string; readonly id: unknown }
    'entry.updated': { readonly resource: string; readonly id: unknown }
    'entry.deleted': { readonly resource: string; readonly id: unknown }
  }
}

const refuseWhenDisabled = (
  resource: string,
  allowed: boolean,
  action: 'created' | 'updated' | 'deleted',
): void => {
  if (!allowed) {
    throw new ForbiddenError(`Entries of "${resource}" cannot be ${action}`)
  }
}

export const CreateEntry = command('entries.create', {
  description: 'Creates an entry in a resource',
  input: { resource: string(), data: unknownSchema() },
  handle: async ({ resource, data }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.create, 'created')

    const values = target.validate(data, 'create')

    // Between validation and the write: what an agent sent has to be legal for an
    // agent to send, and it must not reach the row before that is settled.
    refuseUnwritableFields(resource, target.writableFields, values, context.actor)

    const { id, after } = await target[PERSISTENCE].create(values)

    context.revise({
      entityType: resource,
      entityId: String(id),
      before: null,
      after,
    })
    context.emit('entry.created', { resource, id })

    return { id, entry: after }
  },
})

export const UpdateEntry = command('entries.update', {
  description: 'Updates an entry of a resource',
  input: { resource: string(), id: uuid(), data: unknownSchema() },
  handle: async ({ resource, id, data }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.update, 'updated')

    const values = target.validate(data, 'update')

    refuseUnwritableFields(resource, target.writableFields, values, context.actor)

    // The record itself decides, and it has to be read before it is written
    // (SPEC.md §51).
    await context.authorize(resource, 'update', await target[PERSISTENCE].load(id))

    const { before, after } = await target[PERSISTENCE].update(id, values)

    context.revise({ entityType: resource, entityId: id, before, after })
    context.emit('entry.updated', { resource, id })

    return { id, entry: after }
  },
})

export const DeleteEntry = command('entries.delete', {
  description: 'Deletes an entry of a resource',
  input: { resource: string(), id: uuid() },
  handle: async ({ resource, id }, context) => {
    const target = resourceByName(resource)

    refuseWhenDisabled(resource, target.descriptor.api.delete, 'deleted')

    await context.authorize(resource, 'delete', await target[PERSISTENCE].load(id))

    const { before } = await target[PERSISTENCE].remove(id)

    context.revise({ entityType: resource, entityId: id, before, after: null })
    context.emit('entry.deleted', { resource, id })

    return { id }
  },
})

/** Every command a resource needs. Registered together with the resources. */
export const entryCommands = [CreateEntry, UpdateEntry, DeleteEntry] as const

export { NotFoundError }
