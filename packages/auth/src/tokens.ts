/**
 * API tokens and agent tokens (SPEC.md §49, §72).
 *
 * A token is shown once, at creation, and stored only as a digest. Nothing in the
 * system can recover it, which is the point: a database dump is not a set of keys.
 */
import type { Actor } from '@assemora/core'

import { hashToken, issueToken } from './credentials.js'
import { Agent, AgentToken, ApiToken } from './models.js'

export const API_TOKEN_PREFIX = 'ast'
export const AGENT_TOKEN_PREFIX = 'agt'

export type IssuedApiToken = {
  /** Shown once. Store it somewhere safe or issue another. */
  readonly token: string
  readonly id: string
}

export type ApiTokenDetails = {
  readonly name: string
  readonly permissions: readonly string[]
  readonly userId?: string
  readonly expiresAt?: Date
}

export const createApiToken = async (details: ApiTokenDetails): Promise<IssuedApiToken> => {
  const issued = issueToken(API_TOKEN_PREFIX)

  const stored = await ApiToken.create({
    name: details.name,
    tokenHash: issued.hash,
    userId: details.userId ?? null,
    permissions: details.permissions,
    expiresAt: details.expiresAt ?? null,
  })

  return { token: issued.token, id: stored.id }
}

export type AgentDetails = {
  readonly name: string
  readonly description?: string
  readonly permissions: readonly string[]
}

export type CreatedAgent = {
  readonly agentId: string
  readonly token: string
  readonly tokenId: string
}

/** An agent is an actor of its own, with a token of its own (SPEC.md §72). */
export const createAgent = async (details: AgentDetails): Promise<CreatedAgent> => {
  const agent = await Agent.create({
    name: details.name,
    description: details.description ?? null,
    permissions: details.permissions,
    enabled: true,
  })

  const issued = issueToken(AGENT_TOKEN_PREFIX)

  const token = await AgentToken.create({
    agentId: agent.id,
    name: `${details.name} default`,
    tokenHash: issued.hash,
    expiresAt: null,
  })

  return { agentId: agent.id, token: issued.token, tokenId: token.id }
}

const isLive = (expiresAt: Date | null): boolean =>
  expiresAt === null || expiresAt.getTime() > Date.now()

/** The actor a bearer token stands for, or nobody. */
export const tokenActor = async (token: string): Promise<Actor | undefined> => {
  const digest = hashToken(token)

  if (token.startsWith(`${AGENT_TOKEN_PREFIX}_`)) {
    const stored = await AgentToken.where('tokenHash', digest).first()

    if (stored === null || !isLive(stored.expiresAt)) return undefined

    const agent = await Agent.find(stored.agentId)

    if (agent === null || !agent.enabled) return undefined

    await stored.update({ lastUsedAt: new Date() })

    return { type: 'agent', id: agent.id }
  }

  const stored = await ApiToken.where('tokenHash', digest).first()

  if (stored === null || !isLive(stored.expiresAt)) return undefined

  await stored.update({ lastUsedAt: new Date() })

  return { type: 'api', id: stored.id }
}

export const revokeApiToken = async (id: string): Promise<void> => {
  await (await ApiToken.find(id))?.delete()
}

export const revokeAgentToken = async (id: string): Promise<void> => {
  await (await AgentToken.find(id))?.delete()
}
