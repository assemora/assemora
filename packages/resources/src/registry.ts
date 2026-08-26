/**
 * The resources an application knows about.
 *
 * Commands and MCP address a resource by name, so the lookup has to exist somewhere
 * that neither of them owns.
 */
import { AssemoraError } from '@assemora/core'

import type { AnyResource } from './resource.js'

const resources = new Map<string, AnyResource>()

export const registerResource = (resource: AnyResource): void => {
  if (resources.has(resource.name)) {
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `Resource "${resource.name}" is registered twice`,
      { status: 500 },
    )
  }

  resources.set(resource.name, resource)
}

export const resourceByName = (name: string): AnyResource => {
  const found = resources.get(name)

  if (found === undefined) {
    throw new AssemoraError('UNKNOWN_RESOURCE', `Resource "${name}" is not registered`, {
      status: 404,
    })
  }

  return found
}

export const registeredResources = (): readonly AnyResource[] => [...resources.values()]

export const hasResource = (name: string): boolean => resources.has(name)

export const clearResourceRegistry = (): void => {
  resources.clear()
}
