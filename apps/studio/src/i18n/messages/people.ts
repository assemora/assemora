/**
 * Users, roles, API tokens and agents.
 */
import type { Catalogue } from '../catalogue.ts'

export const PEOPLE = {
  // --- four views of one question --------------------------------------------------
  'people.tab.people': { en: 'People' },
  'people.tab.roles': { en: 'Roles' },
  'people.tab.tokens': { en: 'API tokens' },
  'people.tab.agents': { en: 'Agents' },
  'people.tabs': { en: 'Access views' },
  'people.lede': { en: 'Who may sign in, and what they may do' },

  // --- people -----------------------------------------------------------------------
  'people.newPerson': { en: 'New person' },
  'people.name': { en: 'Name' },
  'people.passwordHelp': { en: 'At least twelve characters' },
  'people.role': { en: 'Role' },
  'people.noRole': { en: 'No role' },
  'people.createFailed': { en: 'Could not create them' },
  'people.creating': { en: 'Creating…' },
  'people.searchPlaceholder': { en: 'Search by name or email…' },
  'people.noMatch': { en: 'Nobody matches that' },
  'people.takeRoleAway': { en: 'Take this role away' },
  'people.addRole': { en: 'Add role…' },
  'people.active': { en: 'active' },
  'people.blocked': { en: 'blocked' },
  'people.cannotBlockSelf': { en: 'You cannot block yourself' },
  'people.block': { en: 'Block' },
  'people.unblock': { en: 'Unblock' },

  // --- roles and permissions ----------------------------------------------------------
  'people.allPermissions': { en: 'Every permission this application has recorded' },
  'people.permissionsAreCommands': {
    en: 'A permission name is a command name. {example} grants everything under it.',
  },
  'people.permissions': { en: 'Permissions' },

  // --- API tokens ----------------------------------------------------------------------
  'people.issueToken': { en: 'Issue an API token' },
  'people.issueAToken': { en: 'Issue a token' },
  'people.tokenScope': {
    en: 'A token can do exactly what you give it, and no more than you hold yourself.',
  },
  'people.tokenPurpose': { en: 'What is it for?' },
  'people.tokenExample': { en: 'Analytics export' },
  'people.expires': { en: 'Expires' },
  'people.expiresHelp': { en: 'A token that never expires is one nobody remembers to revoke' },
  'people.expiry.30': { en: '30 days' },
  'people.expiry.90': { en: '90 days' },
  'people.expiry.year': { en: 'A year' },
  'people.chooseOne': { en: 'Choose at least one' },
  'people.issueFailed': { en: 'Could not issue it' },
  'people.issuing': { en: 'Issuing…' },
  'people.issue': { en: 'Issue' },
  'people.copyNow': { en: 'Copy this now. It is never shown again.' },
  'people.noTokens': { en: 'No API tokens' },
  'people.noTokensBody': { en: 'A token authenticates an integration, not a person.' },
  'people.lastUsed': { en: 'Last used' },
  'people.confirmRevoke': { en: 'Revoke “{name}”? It stops working at once.' },
  'people.revoke': { en: 'Revoke' },

  // --- agents ---------------------------------------------------------------------------
  'people.createAgent': { en: 'Create an agent' },
  'people.newAgent': { en: 'New agent' },
  'people.agentScope': {
    en: 'An agent reaches the tools this application generates, and only what you tick here.',
  },
  'people.agentName': { en: 'What is it called?' },
  'people.agentExample': { en: 'Content agent' },
  'people.agentPurpose': { en: 'What does it do?' },
  'people.agentPurposeHelp': { en: 'Read in the audit log beside everything it did.' },
  'people.agentFailed': { en: 'The agent was not created.' },
  'people.create': { en: 'Create' },
  'people.agentTokenIs': { en: 'This is the agent. Copy it now — it is never shown again.' },
  'people.connectTitle': { en: 'Connect it' },
  'people.connectClaudeCode': {
    en: 'Claude Code: paste this into a terminal, then start a new session.',
  },
  'people.connectOthers': {
    en: 'Claude Desktop, Cursor and the like: add this to their MCP configuration.',
  },
  'people.mcpOff': {
    en: 'This application mounts no MCP endpoint, so there is nothing to connect to. Set mcp: true.',
  },
  'people.copy': { en: 'Copy' },
  'people.copied': { en: 'Copied' },
  'people.noAgents': { en: 'No agents yet' },
  'people.noAgentsBody': {
    en: 'An agent is an identity with its own permissions, audited like anyone else.',
  },
  'people.enabled': { en: 'enabled' },
  'people.disabled': { en: 'disabled' },
  'people.enable': { en: 'Enable' },
  'people.disable': { en: 'Disable' },
} as const satisfies Catalogue
